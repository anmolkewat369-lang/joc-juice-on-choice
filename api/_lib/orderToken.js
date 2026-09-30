/**
 * Order ownership token.
 *
 * Every route that reads or changes an order needs the per-order secret issued
 * at creation, not just the order id. Order ids are sequential and therefore
 * guessable, so an id alone must never be enough to see a customer's name,
 * phone and address, or to move their order.
 *
 * The secret travels only in the `X-Order-Token` header. Query-string tokens are
 * never accepted because URLs can land in access logs, browser history and
 * referrers.
 *
 * Comparison is constant-time, and a wrong token is indistinguishable from an
 * unknown order: both are 404.
 */

import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./http.js";
import { hashAccessToken } from "./store.js";

export const ORDER_TOKEN_HEADER = "x-order-token";

/** The real JOC order reference, e.g. JOC-20260928-0001. */
export const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

/**
 * Whether a string is shaped like an order reference.
 *
 * Defined here, once, next to the gate that enforces it — the customer routes,
 * the payment routes and the admin routes all use this one definition rather
 * than each carrying a copy of the regex.
 */
export const isOrderId = (value) => ORDER_ID_RE.test(String(value ?? ""));

const notFound = () =>
  new ApiError(404, "We could not find that order on this device.", "order_not_found");

/** Accepts either casing; Vercel lower-cases incoming header names. */
function headerToken(req) {
  const raw = req?.headers?.[ORDER_TOKEN_HEADER] ?? req?.headers?.["X-Order-Token"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** The secret this request presents, or null. */
export function presentedToken(req) {
  return headerToken(req);
}

/** Length-safe constant-time comparison against the stored SHA-256 hash. */
export function tokenMatches(storedHash, provided) {
  if (typeof provided !== "string" || provided.length < 16) return false;
  const a = Buffer.from(String(storedHash ?? ""), "utf8");
  const b = Buffer.from(hashAccessToken(provided), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read and normalise an order id from the route params. */
export function orderIdFrom(req, param = "orderId") {
  const raw = req?.query?.[param];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const orderId = typeof value === "string" ? value.toUpperCase() : "";
  if (!ORDER_ID_RE.test(orderId)) throw notFound();
  return orderId;
}

/** Same for a JSON body, where a malformed value is a 400 rather than a 404. */
export function orderIdFromBody(body, { param = "orderId" } = {}) {
  const value = body?.[param];
  const orderId = typeof value === "string" ? value.toUpperCase() : "";
  if (!ORDER_ID_RE.test(orderId)) {
    throw new ApiError(400, "That order reference is not valid.", "invalid_order_id");
  }
  return orderId;
}

/**
 * The single ownership gate.
 *
 * Resolves to the order row, or throws 404. A missing token, a short token and
 * a wrong token all produce the same 404 as an unknown order id, so this
 * endpoint cannot be used to discover which order ids exist.
 */
export async function requireOwnedOrderId(req, store, orderId) {
  const provided = presentedToken(req);
  if (!provided) throw notFound();

  const row = await store.getOrder(orderId);
  if (!row || !tokenMatches(row.access_hash, provided)) throw notFound();
  return row;
}

/** As above, taking the order id from a dynamic route parameter. */
export async function requireOwnedOrder(req, store, { param = "orderId" } = {}) {
  return requireOwnedOrderId(req, store, orderIdFrom(req, param));
}
