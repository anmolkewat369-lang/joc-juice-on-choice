/**
 * GET /api/orders/:orderId — read one order.
 *
 * Order ids are sequential, so a guessable reference must not be enough to
 * reveal a customer's name, phone and address. The caller also has to present
 * the per-order secret issued at creation; the server compares it in constant
 * time against the stored hash. A wrong or missing secret returns 404, exactly
 * as an unknown order id does, so the endpoint cannot be used to probe.
 */

import {
  ApiError,
  methodGuard,
  sendError,
  sendJson,
  clientKey,
} from "../_lib/http.js";
import { getStore, toPublicOrder, hashAccessToken } from "../_lib/store.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { timingSafeEqual } from "node:crypto";

const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

function tokenMatches(storedHash, provided) {
  const a = Buffer.from(String(storedHash ?? ""));
  const b = Buffer.from(hashAccessToken(provided));
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `lookup:${clientKey(req)}`, limit: 30, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many requests. Please try again shortly.", "rate_limited");
    }

    const raw = req.query?.orderId ?? "";
    const orderId = Array.isArray(raw) ? raw[0] : String(raw);
    if (!ORDER_ID_RE.test(orderId)) throw notFound();

    // Preferred: X-Order-Token header (keeps the secret out of access logs).
    // Fallback: ?token= for deep links that were deliberately shared.
    const token = req.headers?.["x-order-token"] || req.headers?.["X-Order-Token"];
    const queryToken = req.query?.token;
    const provided = typeof token === "string" && token.length > 0 ? token : queryToken;
    if (typeof provided !== "string" || provided.length < 16) throw notFound();

    const store = await getStore();
    const row = await store.getOrder(orderId.toUpperCase());
    if (!row || !tokenMatches(row.access_hash, provided)) throw notFound();

    return sendJson(res, 200, { order: toPublicOrder(row) });
  } catch (error) {
    return sendError(res, error);
  }
}

const notFound = () =>
  new ApiError(404, "We could not find that order on this device.", "order_not_found");
