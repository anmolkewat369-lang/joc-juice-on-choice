/**
 * GET /api/admin/session — "am I signed in, and as whom?"
 *
 * Called on every admin page load and on every dashboard poll, so it does the
 * minimum: verify the cookie signature, and report the identity. No database
 * round trip, because the cookie's own expiry is the authority; when an admin
 * is deleted in Supabase the short session lifetime (see adminAuth.js) means the
 * dashboard stops accepting them without any extra work here.
 */

import { methodGuard, sendJson } from "../_lib/http.js";
import {
  readSessionCookie,
  verifySessionToken,
  hasSessionSecret,
  isSupabaseConfigured,
} from "../_lib/adminAuth.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  const configured = hasSessionSecret() && isSupabaseConfigured();
  if (!configured) {
    return sendJson(res, 200, {
      configured: false,
      signedIn: false,
      admin: null,
      reason: "admin_not_configured",
    });
  }

  const session = verifySessionToken(readSessionCookie(req));
  if (!session) {
    return sendJson(res, 200, { configured: true, signedIn: false, admin: null });
  }

  // `verifySessionToken` returns a flat identity ({ id, email, expiresAt }),
  // unlike `createSessionToken`, which returns `{ token, payload, maxAge }`.
  // Reading `session.payload` here threw a TypeError on every refresh, so this
  // route answered 500 and the client treated the admin as signed out. Read the
  // flat shape the verifier actually returns.
  return sendJson(res, 200, {
    configured: true,
    signedIn: true,
    admin: { id: session.id, email: session.email },
    expiresAt: new Date(session.expiresAt * 1000).toISOString(),
  });
}
