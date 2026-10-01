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
 * What the UI needs to decide between "Enable", "Enabled", "Blocked" and
 * "Unsupported". Never throws: any failure degrades to a described state.
 */
export async function loadPushStatus({ signal } = {}) {
  if (!pushSupported()) {
    return { supported: false, configured: false, permission: "unsupported", subscribed: false };
  }

  let registration = null;
  try {
    registration = await serviceWorkerRegistration();
  } catch {
    return { supported: false, configured: false, permission: "unsupported", subscribed: false };
  }

  let config = { configured: false, role: null };
  try {
    config = await getPushConfig({ signal });
  } catch {
    /* offline or unauthenticated — the toggle simply reports not-configured */
  }

  let subscribed = false;
  try {
    subscribed = Boolean(await registration.pushManager.getSubscription());
  } catch {
    subscribed = false;
  }

  return {
    supported: true,
    configured: Boolean(config?.configured),
    role: config?.role ?? null,
    permission: notificationPermission(),
    subscribed: subscribed && notificationPermission() === "granted",
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
  if (!pushSupported()) return { ok: false, reason: "unsupported" };

  const config = await getPushConfig();
  if (!config?.configured || !config.publicKey) {
    return { ok: false, reason: "not_configured" };
  }

  // Permission must be requested from a user gesture — this function is only
  // ever called from the toggle's click handler.
  const permission =
    Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission().catch(() => "denied");
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const registration = await serviceWorkerRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));

  try {
    await savePushSubscription(subscription);
  } catch (error) {
    // The browser subscription exists but the server did not accept it. Drop it
    // so a retry starts clean rather than reusing an unregistered subscription.
    await subscription.unsubscribe().catch(() => {});
    throw error;
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
