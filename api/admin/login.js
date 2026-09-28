/**
 * POST   /api/admin/login  — sign in with Supabase Auth
 * DELETE /api/admin/login  — sign out
 *
 * The password is forwarded to Supabase over TLS and is never stored, logged or
 * held in an environment variable here. On success the API sets a signed,
 * httpOnly, SameSite=Strict cookie and returns the identity; the browser never
 * sees a token it could read, replay from another site, or forge.
 *
 * Rate limited per IP *and* per email, because a shared office IP should not let
 * one attacker brute-force an account, and a single attacker should not be able
 * to lock a real admin out by spraying from many addresses.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import {
  signInWithPassword,
  createSessionToken,
  clearSessionCookie,
  setSessionCookie,
  hasSessionSecret,
  isSupabaseConfigured,
} from "../_lib/adminAuth.js";

/** Generous for a human who mistypes, tight enough to make guessing pointless. */
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["POST", "DELETE"])) return;

  try {
    sweepRateLimits();

    if (req.method === "DELETE") {
      clearSessionCookie(res, req);
      return sendJson(res, 200, { signedOut: true });
    }

    // Report an unconfigured server honestly rather than as "wrong password".
    if (!hasSessionSecret() || !isSupabaseConfigured()) {
      throw new ApiError(
        503,
        "The admin dashboard is not configured on this server.",
        "admin_not_configured",
      );
    }

    const body = await readJson(req);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || !password) {
      throw new ApiError(400, "Enter your email address and password.", "credentials_required");
    }

    const gate = rateLimit({
      key: `admin-login-ip:${clientKey(req)}`,
      limit: 20,
      windowMs: ATTEMPT_WINDOW_MS,
    });
    const perAccount = rateLimit({
      key: `admin-login-acct:${email}`,
      limit: ATTEMPT_LIMIT,
      windowMs: ATTEMPT_WINDOW_MS,
    });
    if (!gate.allowed || !perAccount.allowed) {
      throw new ApiError(
        429,
        "Too many sign-in attempts. Please wait a few minutes and try again.",
        "rate_limited",
      );
    }

    const user = await signInWithPassword({ email, password });
    const session = createSessionToken(user);
    setSessionCookie(res, req, session.token, session.maxAge);

    return sendJson(res, 200, {
      admin: { id: session.payload.sub, email: session.payload.email },
      expiresAt: new Date(session.payload.exp * 1000).toISOString(),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
