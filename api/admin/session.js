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

  return sendJson(res, 200, {
    configured: true,
    signedIn: true,
    admin: { id: session.payload.sub, email: session.payload.email },
    expiresAt: new Date(session.payload.exp * 1000).toISOString(),
  });
}
