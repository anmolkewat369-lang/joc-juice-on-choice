/**
 * Customer authentication.
 *
 * Identity comes from Supabase Auth (see supabaseAuth.js) — the password is
 * checked by Supabase over TLS and never touches this codebase. What this module
 * owns is the customer *session*: after Supabase authenticates the user, the API
 * issues an opaque, signed, httpOnly cookie carrying that user's Supabase id.
 *
 * Customer sessions are kept strictly separate from admin sessions:
 *
 *   * a different cookie name (`joc_customer_session` vs `joc_admin_session`),
 *     so neither can be replayed as the other even by accident;
 *   * a domain-separated signing key derived from the base secret, so a forged
 *     token signed with one key is meaningless to the other; and
 *   * an explicit `typ: "customer"` claim that is checked on verify.
 *
 * The user id from that cookie is the ONLY thing an order-ownership check may
 * use. A `customer_user_id`, a role or a user object sent by the browser is
 * ignored, because the browser is never asked.
 *
 * Fail-closed: with no session secret every customer route refuses. It never
 * falls back to a default secret and never degrades to "allow".
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http.js";
import { isSupabaseConfigured } from "./supabaseAuth.js";

export const SESSION_COOKIE = "joc_customer_session";

/**
 * 30 days. A customer who checked "remember me" by logging in should not be
 * asked again every time they open the site to track an order.
 */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Minimum acceptable base secret length, in characters of entropy. */
const MIN_SECRET_LENGTH = 32;

const TOKEN_TYPE = "customer";

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * The customer signing secret.
 *
 * A dedicated secret is preferred, but falling back to the admin secret means a
 * deployment that already has admin auth configured gets customer auth with no
 * new variable to set. Whichever is present, customer and admin keys are still
 * domain-separated below, so they can never be used interchangeably.
 */
const baseSecret = () =>
  env("JOC_CUSTOMER_SESSION_SECRET") || env("JOC_ADMIN_SESSION_SECRET");

/** The secret is present and long enough to be worth having. */
export const hasSessionSecret = () => baseSecret().length >= MIN_SECRET_LENGTH;

/** The customer API is usable only with a session secret and Supabase Auth. */
export const isCustomerAuthConfigured = () =>
  hasSessionSecret() && isSupabaseConfigured();

/** Derived, so a token signed for customers is invalid everywhere else. */
const sessionKey = () =>
  createHash("sha256").update(`joc-customer-session-v1:${baseSecret()}`).digest();

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

const sign = (payload, key) =>
  createHmac("sha256", key).update(payload).digest("base64url");

/** Constant-time comparison of two same-length strings. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

const notConfigured = () =>
  new ApiError(
    503,
    "Sign-in is not configured on this server.",
    "auth_not_configured",
  );

/* -------------------------------- sessions ------------------------------- */

/**
 * Mint a customer session token. The payload is readable (base64url, not
 * encrypted) but unforgeable: only the server holds the key, and it carries
 * nothing secret — a Supabase user id, an email and two timestamps.
 */
export function createCustomerSession({ id, email }, { now = Date.now() } = {}) {
  if (!hasSessionSecret()) throw notConfigured();
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    sub: String(id),
    email: String(email ?? ""),
    typ: TOKEN_TYPE,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
  const encoded = b64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded, sessionKey())}`, payload, maxAge: SESSION_TTL_SECONDS };
}

/**
 * Verify a customer session token. Returns the identity or null — never throws,
 * so a malformed cookie is simply "not signed in".
 */
export function verifyCustomerSession(token, { now = Date.now() } = {}) {
  if (!hasSessionSecret()) return null;
  if (typeof token !== "string") return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  if (!safeEqual(signature, sign(encoded, sessionKey()))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload?.typ !== TOKEN_TYPE) return null;
  if (!payload?.sub || !payload?.exp) return null;
  if (payload.exp <= Math.floor(now / 1000)) return null;
  return {
    id: payload.sub,
    email: payload.email,
    expiresAt: payload.exp,
  };
}

/* --------------------------------- cookies ------------------------------- */

const isSecureRequest = (req) => {
  if (String(process.env.VERCEL_ENV ?? "") === "production") return true;
  const proto = String(req?.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim();
  if (proto) return proto === "https";
  const encrypted = req?.headers?.["x-forwarded-ssl"];
  return String(encrypted ?? "").toLowerCase() === "on";
};

/**
 * httpOnly so JavaScript cannot read it, SameSite=Lax so it is sent on a
 * top-level navigation back into the site (an email link) but not on a
 * cross-site POST, and `Path=/` so it reaches both /api and the pages. Secure is
 * set whenever the request actually arrived over TLS.
 */
export function setCustomerSessionCookie(res, req, token, maxAge) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function clearCustomerSessionCookie(res, req) {
  setCustomerSessionCookie(res, req, "", 0);
}

/** Read the session token from the request cookies, if present. */
export function readCustomerSessionCookie(req) {
  const header = req?.headers?.cookie;
  if (typeof header !== "string" || header.length === 0) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/* --------------------------------- guards -------------------------------- */

/** The authenticated customer, or null. Never throws. */
export function customerFrom(req) {
  if (!hasSessionSecret()) return null;
  return verifyCustomerSession(readCustomerSessionCookie(req));
}

/**
 * Require an authenticated customer. Throws 401 when there is no valid session
 * and 503 when the server has no session secret configured, so a misconfigured
 * deployment reports itself instead of looking like a wrong password.
 */
export function requireCustomer(req) {
  if (!hasSessionSecret()) throw notConfigured();
  const customer = customerFrom(req);
  if (!customer) {
    throw new ApiError(401, "Please log in to continue.", "customer_unauthenticated");
  }
  return customer;
}

/** Never log a secret. Presence and length only. */
export function customerAuthStatus() {
  return {
    supabase: isSupabaseConfigured(),
    sessionSecret: hasSessionSecret(),
    dedicatedSecret: Boolean(env("JOC_CUSTOMER_SESSION_SECRET")),
  };
}
