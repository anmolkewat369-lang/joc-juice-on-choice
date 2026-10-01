/**
 * Web Push subscription bookkeeping — SERVER ONLY.
 *
 *   GET    /api/push/subscribe   the VAPID public key + this caller's role
 *   POST   /api/push/subscribe   save/refresh this browser's subscription
 *   DELETE /api/push/subscribe   remove this browser's subscription
 *
 * The caller must be signed in — as a customer OR as an admin. Which one they
 * are is decided HERE, server-side, from the signed httpOnly cookie, and that
 * role is what gets stored. The browser never sends a role or a user id, so it
 * can never subscribe itself to another account's notifications.
 *
 * The stored `endpoint` is unique, so the same browser signing in as someone
 * else simply reassigns its single row rather than accumulating subscriptions.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { getStore } from "../_lib/store.js";
import { verifySessionToken, readSessionCookie } from "../_lib/adminAuth.js";
import { customerFrom } from "../_lib/customerAuth.js";
import { isPushConfigured, pushPublicKey } from "../_lib/push.js";

/** Endpoint URLs are long but not unbounded; a real FCM/APNs endpoint fits easily. */
const MAX_ENDPOINT = 4096;
const MAX_KEY = 256;

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST", "DELETE"])) return;

  try {
    sweepRateLimits();

    // Authentication first, for every method. The 401 here is the guarantee
    // that an anonymous visitor cannot create unlimited subscription rows.
    const subject = identify(req);
    if (!subject) {
      throw new ApiError(401, "Please log in to manage notifications.", "unauthenticated");
    }

    if (req.method === "GET") {
      const store = await getStore();
      const existing = await store.listPushSubscriptions({
        role: subject.role,
        userId: subject.id,
      });
      return sendJson(res, 200, {
        configured: isPushConfigured(),
        publicKey: pushPublicKey(),
        role: subject.role,
        subscriptions: existing.length,
      });
    }

    if (!isPushConfigured()) {
      throw new ApiError(
        503,
        "Notifications are not configured on this server.",
        "push_not_configured",
      );
    }

    const allowed = rateLimit({
      key: `push-subscribe:${clientKey(req)}`,
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (!allowed.allowed) {
      throw new ApiError(429, "Too many requests. Please try again shortly.", "rate_limited");
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const { endpoint, p256dh, auth } = readSubscription(body);
      const store = await getStore();
      await store.upsertPushSubscription({
        userId: subject.id,
        role: subject.role,
        endpoint,
        p256dh,
        auth,
        userAgent: String(req.headers?.["user-agent"] ?? "").slice(0, 300) || null,
      });
      return sendJson(res, 201, { subscribed: true, role: subject.role });
    }

    // DELETE — remove only THIS caller's subscription. The endpoint is matched
    // against their own rows first, so one account can never unsubscribe another.
    const body = await readJson(req);
    const endpoint = String(body?.endpoint ?? "").trim();
    if (!endpoint) {
      throw new ApiError(400, "A subscription endpoint is required.", "endpoint_required");
    }
    const store = await getStore();
    const owned = await store.listPushSubscriptions({ role: subject.role, userId: subject.id });
    const match = owned.find((row) => row.endpoint === endpoint);
    if (match) await store.deletePushSubscription(match.id);
    // Idempotent: unsubscribing something already gone is a success.
    return sendJson(res, 200, { unsubscribed: true });
  } catch (error) {
    return sendError(res, error);
  }
}

/** Admin identity wins if both cookies are somehow present; otherwise customer. */
function identify(req) {
  const admin = verifySessionToken(readSessionCookie(req));
  if (admin) return { role: "admin", id: admin.id, email: admin.email };
  const customer = customerFrom(req);
  if (customer) return { role: "customer", id: customer.id, email: customer.email };
  return null;
}

/** Accept both the PushSubscription JSON shape and a flat one. */
function readSubscription(body) {
  const source = body?.subscription ?? body ?? {};
  const keys = source?.keys ?? {};
  const endpoint = String(source?.endpoint ?? "").trim();
  const p256dh = String(keys?.p256dh ?? source?.p256dh ?? "").trim();
  const auth = String(keys?.auth ?? source?.auth ?? "").trim();

  if (!/^https:\/\//i.test(endpoint) || endpoint.length > MAX_ENDPOINT) {
    throw new ApiError(422, "That notification subscription is not valid.", "invalid_subscription");
  }
  if (!p256dh || p256dh.length > MAX_KEY || !auth || auth.length > MAX_KEY) {
    throw new ApiError(422, "That notification subscription is not valid.", "invalid_subscription");
  }
  return { endpoint, p256dh, auth };
}
