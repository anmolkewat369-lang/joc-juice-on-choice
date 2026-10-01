/**
 * Admin authentication.
 *
 * Identity comes from Supabase Auth — the password is checked by Supabase, over
 * TLS, and never touches this codebase. There is no second password database,
 * no password hash stored here, and no admin password in any environment
 * variable.
 *
 * What this module owns is the *session*: after Supabase authenticates the
 * user, the API issues an opaque, signed, httpOnly cookie. The signature is
 * HMAC-SHA256 over the session payload using JOC_ADMIN_SESSION_SECRET, which
 * lives only in the server environment. The browser receives a cookie it cannot
 * read or forge, and every admin route re-verifies that signature server-side.
 * A role, an email or an "isAdmin" flag sent by the browser is ignored, because
 * the browser is never asked.
 *
 * Fail-closed: if the session secret is missing or too short, every admin route
 * refuses. It never falls back to a default secret and never degrades to "allow".
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http.js";
import {
  supabaseUrl,
  supabaseAnonKey,
  isSupabaseConfigured,
  passwordGrant,
} from "./supabaseAuth.js";

export const SESSION_COOKIE = "joc_admin_session";

/** 12 hours. Long enough for a shift, short enough to matter if a laptop is left open. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** Minimum acceptable secret length, in characters of entropy. */
const MIN_SECRET_LENGTH = 32;

/* ------------------------------ configuration ---------------------------- */

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

// `supabaseUrl`, `supabaseAnonKey` and `isSupabaseConfigured` are re-exported so
// the rest of the admin code keeps its existing import surface while the actual
// transport lives in one shared module (supabaseAuth.js).
export { supabaseUrl, supabaseAnonKey, isSupabaseConfigured };

/**
 * Optional allow-list of admin email addresses. When set, an authenticated
 * Supabase user outside the list is rejected even with a valid session —
 * defence in depth for a project that ever gains a second account.
 */
function allowedEmails() {
  return env("JOC_ADMIN_EMAILS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const isEmailAllowed = (email) => {
  const list = allowedEmails();
  if (list.length === 0) return true; // no allow-list configured
  return list.includes(String(email ?? "").toLowerCase());
};

/* -------------------------------- sessions ------------------------------- */

function sessionSecret() {
  return env("JOC_ADMIN_SESSION_SECRET");
}

/** The secret is present and long enough to be worth having. */
export const hasSessionSecret = () => sessionSecret().length >= MIN_SECRET_LENGTH;

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

const sign = (payload, secret) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/** Constant-time comparison of two same-length strings. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Mint a session token. The payload is readable (it is base64url, not encrypted)
 * but unforgeable: only the server holds the key, and it is integrity-protected
 * rather than confidential, because it contains nothing secret — an id, an
 * email and two timestamps.
 */
export function createSessionToken({ id, email }, { now = Date.now() } = {}) {
  const secret = sessionSecret();
  if (!hasSessionSecret()) {
    throw new ApiError(
      503,
      "The admin dashboard is not configured on this server.",
      "admin_not_configured",
    );
  }
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    sub: String(id),
    email: String(email ?? ""),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  };
  const encoded = b64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded, secret)}`, payload, maxAge: SESSION_TTL_SECONDS };
}

/**
 * Verify a session token. Returns the identity or null — never throws, so a
 * malformed cookie is simply "not signed in".
 */
export function verifySessionToken(token, { now = Date.now() } = {}) {
  if (!hasSessionSecret()) return null;
  if (typeof token !== "string") return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  if (!safeEqual(signature, sign(encoded, sessionSecret()))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.sub || !payload?.exp) return null;
  if (payload.exp <= Math.floor(now / 1000)) return null;
  if (!isEmailAllowed(payload.email)) return null;
  return { id: payload.sub, email: payload.email, expiresAt: payload.exp };
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
 * httpOnly + SameSite=Strict so the session is unreadable from JavaScript and is
 * not sent on any cross-site request. `Path=/` because the admin API lives under
 * /api. Secure is set whenever the request actually arrived over TLS.
 */
export function setSessionCookie(res, req, token, maxAge) {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export function clearSessionCookie(res, req) {
  setSessionCookie(res, req, "", 0);
}

/** Read the session token from the request cookies, if present. */
export function readSessionCookie(req) {
  const header = req?.headers?.cookie;
  if (typeof header !== "string" || header.length === 0) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/* ------------------------------ Supabase Auth ---------------------------- */

/** The one place an admin password is ever handled: forwarded to Supabase. */
export async function signInWithPassword({ email, password }) {
  if (!isSupabaseConfigured()) {
    throw new ApiError(
      503,
      "The admin dashboard is not configured on this server.",
      "admin_not_configured",
    );
  }

  // The password is forwarded to Supabase and dropped. `passwordGrant` throws
  // auth_unavailable on an outage and invalid_credentials on a refusal, both
  // with messages that are already safe to show an admin.
  const { id, email: address } = await passwordGrant({ email, password });

  if (!isEmailAllowed(address)) {
    throw new ApiError(403, "This account is not allowed to use the admin dashboard.", "not_allowed");
  }
  return { id, email: address };
}

/* --------------------------------- guards -------------------------------- */

/**
 * Require an authenticated admin. Throws 401 when there is no valid session and
 * 503 when the server has no session secret configured, so a misconfigured
 * deployment reports itself instead of looking like an auth problem.
 */
export function requireAdmin(req) {
  if (!hasSessionSecret()) {
    throw new ApiError(
      503,
      "The admin dashboard is not configured on this server.",
      "admin_not_configured",
    );
  }
  const admin = verifySessionToken(readSessionCookie(req));
  if (!admin) {
    throw new ApiError(401, "Please sign in to the admin dashboard.", "admin_unauthenticated");
  }
  return admin;
}

/** Never log a secret. Presence and length only. */
export function authConfigStatus() {
  return {
    supabase: isSupabaseConfigured(),
    sessionSecret: hasSessionSecret(),
    emailAllowList: allowedEmails().length > 0,
  };
}
