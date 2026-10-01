/**
 * Browser side of Web Push.
 *
 * The real work — VAPID signing, encryption, exactly-once delivery — is the
 * server's (api/_lib/push.js). This module only:
 *
 *   1. registers the service worker that receives the push,
 *   2. asks the browser for notification permission when, and only when, the
 *      person asks to be notified,
 *   3. subscribes through the browser's PushManager and hands the resulting
 *      subscription to the authenticated server, which decides the role.
 *
 * It never asks for permission on page load. A permission prompt nobody asked
 * for is the fastest way to get permanently blocked, and a blocked site cannot
 * ask again.
 */

import {
  getPushConfig,
  savePushSubscription,
  removePushSubscription,
} from "./api.js";

export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const notificationPermission = () =>
  pushSupported() ? Notification.permission : "unsupported";

/** The service worker is scoped to the site root so it can open any JOC page. */
let registrationPromise = null;
function serviceWorkerRegistration() {
  if (!pushSupported()) return Promise.reject(new Error("unsupported"));
  registrationPromise ??= navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return registrationPromise;
}

/** Chrome requires the key as raw bytes, not the base64url string. */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

/**
 * Every distinct reason the toggle may need to explain. Keeping them as named
 * strings (not booleans) is what lets the UI say *why* notifications are
 * unavailable instead of a single vague sentence that hides a misconfigured
 * server behind "not available right now".
 */
export const PUSH_REASON = {
  UNSUPPORTED: "unsupported",
  SERVICE_WORKER: "service_worker_unavailable",
  AUTH: "auth_required",
  SERVER: "server_error",
  NOT_CONFIGURED: "not_configured",
  DENIED: "permission_denied",
  SUBSCRIPTION_FAILED: "subscription_failed",
};

/**
 * What the UI needs to decide between "Enable", "Enabled", "Blocked",
 * "Unsupported" and "Server not configured". Never throws: any failure degrades
 * to a described state with a `reason`.
 */
export async function loadPushStatus({ signal } = {}) {
  if (!pushSupported()) {
    return {
      supported: false,
      configured: false,
      permission: "unsupported",
      subscribed: false,
      reason: PUSH_REASON.UNSUPPORTED,
    };
  }

  // A browser can support PushManager but fail to register the worker (private
  // mode, a blocked scope, a stale broken registration). That is a distinct
  // state from "this browser has no push", so it gets its own reason.
  let registration = null;
  try {
    registration = await serviceWorkerRegistration();
  } catch {
    return {
      supported: true,
      configured: false,
      permission: notificationPermission(),
      subscribed: false,
      reason: PUSH_REASON.SERVICE_WORKER,
    };
  }

  let config = null;
  let configError = null;
  try {
    config = await getPushConfig({ signal });
  } catch (error) {
    configError = error;
  }

  let subscribed = false;
  try {
    subscribed = Boolean(await registration.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }

  const permission = notificationPermission();

  // Precedence: a failed server call is the most actionable (and, for a signed-in
  // admin, almost always a dead session); then a server that answered but has no
  // VAPID keys; then a blocked permission; otherwise everything is fine.
  let reason = null;
  if (configError) {
    reason = configError.status === 401 ? PUSH_REASON.AUTH : PUSH_REASON.SERVER;
  } else if (!config?.configured) {
    reason = PUSH_REASON.NOT_CONFIGURED;
  } else if (permission === "denied") {
    reason = PUSH_REASON.DENIED;
  }

  return {
    supported: true,
    configured: Boolean(config?.configured),
    role: config?.role ?? null,
    permission,
    subscribed: subscribed && permission === "granted",
    reason,
  };
}

/**
 * Ask permission, subscribe, and register the subscription with the server.
 *
 * Resolves to the same shape `loadPushStatus` returns, so the caller can set its
 * state from one object. A denial is a normal outcome; the caller shows the
 * "blocked" copy rather than an error.
 */
export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: PUSH_REASON.UNSUPPORTED };

  let config;
  try {
    config = await getPushConfig();
  } catch (error) {
    // A 401 here means the session the endpoint needs is gone; anything else is
    // the server being unreachable. Neither should ever reach the caller as an
    // exception — the toggle has copy for both.
    return {
      ok: false,
      reason: error?.status === 401 ? PUSH_REASON.AUTH : PUSH_REASON.SERVER,
      error,
    };
  }
  if (!config?.configured || !config.publicKey) {
    return { ok: false, reason: PUSH_REASON.NOT_CONFIGURED };
  }

  // Permission must be requested from a user gesture — this function is only
  // ever called from the toggle's click handler.
  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission().catch(() => "denied");
  if (permission !== "granted") return { ok: false, reason: PUSH_REASON.DENIED };

  let registration;
  try {
    registration = await serviceWorkerRegistration();
  } catch (error) {
    return { ok: false, reason: PUSH_REASON.SERVICE_WORKER, error };
  }

  let subscription;
  try {
    const existing = await registration.pushManager.getSubscription();
    subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      }));
  } catch (error) {
    // The browser refused to create the subscription — most often a malformed
    // applicationServerKey or a browser/OS policy. Distinct from the server
    // rejecting a valid subscription below.
    return { ok: false, reason: PUSH_REASON.SUBSCRIPTION_FAILED, error };
  }

  try {
    await savePushSubscription(subscription);
  } catch (error) {
    // The browser subscription exists but the server did not accept it. Drop it
    // so a retry starts clean rather than reusing an unregistered subscription.
    await subscription.unsubscribe().catch(() => {});
    return { ok: false, reason: PUSH_REASON.SERVER, error };
  }
  return { ok: true, reason: null };
}

/** Unsubscribe locally and on the server. Idempotent. */
export async function disablePush() {
  if (!pushSupported()) return { ok: true };
  try {
    const registration = await serviceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await removePushSubscription(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    }
  } catch {
    /* nothing to remove */
  }
  return { ok: true };
}
