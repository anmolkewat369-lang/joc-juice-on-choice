/**
 * Web Push delivery — SERVER ONLY.
 *
 * This is a SECOND, independent notification channel alongside api/_lib/notify.js
 * (email/WhatsApp/dashboard). It uses the real Web Push protocol: a VAPID-signed
 * request to the browser's push service, carrying an encrypted `aes128gcm`
 * payload that only the subscribed browser can read. `web-push` owns the crypto;
 * this module owns the recipient rules and the exactly-once bookkeeping.
 *
 * THE RECIPIENT RULES (enforced here, never in the browser):
 *
 *   * an admin new-order push fans out to every subscription whose stored role
 *     is 'admin' — a role the server derived when the subscription was created;
 *   * a customer order push goes ONLY to subscriptions owned by the order's
 *     `customer_user_id`, which itself was derived from a validated session. A
 *     customer can therefore never receive another customer's order.
 *
 * THE ONE RULE: nothing here throws, and nothing here can fail an order. A push
 * service being down, a subscription having expired, or VAPID not being
 * configured all degrade to a returned result object, exactly like the email
 * layer.
 *
 * EXACTLY ONCE
 *   Duplicate pushes are prevented by the `joc_push_deliveries` ledger, keyed on
 *   (order_uuid, event, subscription_id). Saving CONFIRMED twice is already a
 *   no-op in changeOrderStatus; the ledger is the second guarantee, and the one
 *   that survives a retried request across serverless instances.
 */

import webpush from "web-push";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "../../shared/ordering.js";
import { readTrackingToken } from "./store.js";

/** Stable event names. Stored in the ledger, so they are written out, not derived. */
export const PUSH_EVENT = {
  ADMIN_NEW_ORDER: "admin_new_order",
  CUSTOMER_ORDER_CONFIRMED: "customer_order_confirmed",
};

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * VAPID configuration.
 *
 * The public key is safe to hand to the browser; the private key is never
 * returned by any API and never logged. `subject` must be a mailto: or https:
 * URL that identifies the sender to the push service.
 */
export function vapidConfig() {
  const publicKey = env("VAPID_PUBLIC_KEY");
  const privateKey = env("VAPID_PRIVATE_KEY");
  const subject = env("VAPID_SUBJECT") || "mailto:anmolkewat369@gmail.com";
  return {
    publicKey,
    privateKey,
    subject,
    configured: Boolean(publicKey && privateKey && /^(mailto:|https:)/.test(subject)),
  };
}

export const isPushConfigured = () => vapidConfig().configured;

/** The only VAPID value a browser is ever given. Null when push is off. */
export const pushPublicKey = () => (isPushConfigured() ? vapidConfig().publicKey : null);

const rupees = (amount) => `₹${Number(amount ?? 0).toLocaleString("en-IN")}`;
const label = (table, value) => table[value] ?? String(value ?? "—");

/* -------------------------------- payloads -------------------------------- */

/**
 * The customer's tracking page, as a RELATIVE url.
 *
 * The token goes in the fragment (`#t=`), which is never sent to a server, and
 * the service worker additionally refuses anything that is not same-origin. A
 * relative url keeps a locally-served site working, where an absolute
 * JOC_SITE_URL would point at production.
 */
function customerOrderPath(row) {
  const token = readTrackingToken(row);
  if (row?.order_id && token) {
    return `/#/order/${encodeURIComponent(row.order_id)}?t=${encodeURIComponent(token)}`;
  }
  // No secret to build a tracking link with — send the customer somewhere safe
  // they can sign in and see the order, rather than a route that would fail.
  return "/my-orders";
}

function adminPayload(row) {
  const orderId = row?.order_id ?? "—";
  return {
    title: "New JOC Order",
    body: [
      orderId,
      row?.customer_name ?? "Customer",
      rupees(row?.total),
      label(PAYMENT_METHOD_LABELS, row?.payment_method),
      label(PAYMENT_STATUS_LABELS, row?.payment_status),
      label(ORDER_STATUS_LABELS, row?.order_status),
    ].join(" · "),
    url: "/admin/orders",
    tag: `joc-admin-order-${orderId}`,
    data: { kind: "admin_new_order", orderId },
  };
}

function customerConfirmedPayload(row) {
  const orderId = row?.order_id ?? "—";
  return {
    title: "JOC Order Confirmed",
    body: `Your order ${orderId} has been confirmed.`,
    url: customerOrderPath(row),
    tag: `joc-customer-order-${orderId}`,
    data: {
      kind: "customer_order_confirmed",
      orderId,
      orderStatus: row?.order_status ?? null,
    },
  };
}

/* ------------------------------- transport -------------------------------- */

/** Send to one subscription. Never throws; classifies a permanent failure. */
async function sendOne(subscription, payload) {
  const config = vapidConfig();
  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    return { sent: true, permanent: false, reason: null };
  } catch (error) {
    const status = Number(error?.statusCode ?? error?.status ?? 0);
    return {
      sent: false,
      // 404 / 410 mean the subscription is gone for good (browser uninstalled,
      // permission revoked). Retrying it forever would be a waste and a lie.
      permanent: status === 404 || status === 410,
      status,
      reason: error?.message ?? "push_failed",
    };
  }
}

/**
 * Claim, send and resolve for each subscription.
 *
 * A subscription is only contacted when this caller wins the ledger claim, so a
 * repeated event sends nothing. A permanent failure deletes the subscription;
 * a transient one is left for a bounded retry.
 */
async function dispatch({ store, row, event, subscriptions, payload }) {
  if (typeof row?.id !== "string" && typeof row?.id !== "number") {
    return { sent: 0, failed: 0, skipped: 0, reason: "no_order_row" };
  }
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const subscription of subscriptions) {
    let claim;
    try {
      claim = await store.claimPushDelivery({
        orderUuid: row.id,
        orderRef: row.order_id ?? String(row.id),
        event,
        subscriptionId: subscription.id,
      });
    } catch (error) {
      console.error("[joc-push] could not claim a delivery:", error?.message ?? error);
      continue;
    }
    if (!claim?.claimed) {
      skipped += 1;
      continue;
    }

    const result = await sendOne(subscription, payload);
    try {
      await store.completePushDelivery(
        claim.delivery.id,
        result.sent ? "sent" : "failed",
        result.reason,
      );
    } catch (error) {
      console.error("[joc-push] could not record the delivery result:", error?.message ?? error);
    }

    if (result.sent) {
      sent += 1;
      try {
        await store.markPushSubscriptionUsed(subscription.id);
      } catch {
        /* best effort */
      }
    } else {
      failed += 1;
      if (result.permanent) {
        // Expired beyond recovery. Removing it keeps future fan-outs cheap.
        try {
          await store.deletePushSubscription(subscription.id);
        } catch {
          /* best effort */
        }
      }
    }
  }

  return { sent, failed, skipped };
}

/* ------------------------------ public surface ---------------------------- */

/**
 * The admin's new-order push.
 *
 * Called with the RAW order row immediately after it is persisted. The admin
 * fan-out deliberately includes every stored admin subscription, because the
 * shop wants any signed-in operator to hear about a new order.
 */
export async function notifyAdminNewOrderPush(store, row) {
  if (!isPushConfigured()) return { sent: 0, failed: 0, skipped: 0, reason: "not_configured" };
  try {
    const subscriptions = await store.listPushSubscriptionsByRole("admin");
    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, skipped: 0, reason: "no_subscriptions" };
    }
    return await dispatch({
      store,
      row,
      event: PUSH_EVENT.ADMIN_NEW_ORDER,
      subscriptions,
      payload: adminPayload(row),
    });
  } catch (error) {
    console.error("[joc-push] admin new-order push failed:", error?.message ?? error);
    return { sent: 0, failed: 0, skipped: 0, reason: "push_error" };
  }
}

/**
 * The customer's "your order is confirmed" push.
 *
 * Only ever sent to the subscriptions of the order's own `customer_user_id`. An
 * order with no owner (anonymous/legacy) resolves to nobody and sends nothing.
 */
export async function notifyCustomerOrderConfirmedPush(store, row) {
  if (!isPushConfigured()) return { sent: 0, failed: 0, skipped: 0, reason: "not_configured" };
  if (!row?.customer_user_id) {
    return { sent: 0, failed: 0, skipped: 0, reason: "no_recipient" };
  }
  try {
    const subscriptions = await store.listPushSubscriptions({
      role: "customer",
      userId: row.customer_user_id,
    });
    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, skipped: 0, reason: "no_subscriptions" };
    }
    return await dispatch({
      store,
      row,
      event: PUSH_EVENT.CUSTOMER_ORDER_CONFIRMED,
      subscriptions,
      payload: customerConfirmedPayload(row),
    });
  } catch (error) {
    console.error("[joc-push] customer confirmation push failed:", error?.message ?? error);
    return { sent: 0, failed: 0, skipped: 0, reason: "push_error" };
  }
}
