/**
 * Order notifications.
 *
 * Four channels, none of which may ever affect whether an order succeeds:
 *
 *   dashboard  browser notification + sound + badge, from the dashboard's own
 *              polling of /api/admin/orders — no server involvement
 *   whatsapp   a wa.me deep link the ADMIN taps. This is NOT automated
 *              messaging: a personal WhatsApp number has no business API
 *              attached to it, and JOC has none configured. Nothing here sends
 *              anything to a customer's phone number.
 *   email      Resend — the admin's new-order alert, and the customer's order
 *              updates and tracking link when they gave an address.
 *
 * THE RULE: nothing in this file can make an order fail, and nothing here can
 * show a customer an amount the server did not price. Every exported function
 * returns a result object and never throws.
 *
 * EXACTLY ONCE
 *   A duplicated order request, a second serverless instance, an admin page
 *   refresh and a retried email must not produce two copies of the same message.
 *   Idempotency is enforced by the `joc_notifications` ledger (see
 *   db/migrations/004), not by remembering what this instance already did — an
 *   in-memory "already sent" set would forget the moment the instance is recycled
 *   and would send the message again. The ledger is shared, and the unique
 *   constraint on (order_uuid, notification_type, dedupe_key) makes exactly one
 *   caller win.
 */

import {
  CURRENCY,
  DELIVERY_PENDING_LABEL,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
} from "../../shared/ordering.js";
import { DELIVERY_AREA_PENDING_LABEL, deliveryAreaSummary } from "../../shared/delivery.js";

import {
  NOTIFICATION_LEASE_SECONDS,
  readTrackingToken,
  toAdminOrder,
} from "./store.js";
import { emailConfig, logEmailConfigurationOnce, sendEmail, siteBaseUrl } from "./email.js";

/**
 * Notification types. These strings are CHECKed by the database, so they are
 * written out rather than derived — a rename here would be a constraint violation
 * on the next insert, which is the correct place to discover that.
 */
export const NOTIFICATION_TYPE = {
  ADMIN_NEW_ORDER: "admin_new_order",
  CUSTOMER_ORDER_RECEIVED: "customer_order_received",
  CUSTOMER_STATUS: "customer_status",
  CUSTOMER_PAYMENT_VERIFIED: "customer_payment_verified",
};

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/* --------------------------- WhatsApp (manual only) ----------------------- */

/** The configured WhatsApp number in international digits, or null. */
export function whatsappNumber() {
  const raw = env("JOC_WHATSAPP_NUMBER").replace(/[^\d]/g, "");
  return raw.length >= 8 && raw.length <= 15 ? raw : null;
}

const rupees = (amount) => `₹${Number(amount ?? 0).toLocaleString("en-IN")}`;

const itemLines = (order) =>
  (order.items ?? [])
    .map((item) => `• ${item.name} x${item.qty} — ${rupees(item.lineTotal)}`)
    .join("\n");

/**
 * A short, plain summary. Kept to a length a WhatsApp preview shows in full, and
 * built only from values the server stored.
 */
export function orderSummaryText(order) {
  const lines = [
    `New JOC order ${order.orderId}`,
    `Name: ${order.customerName}`,
    `Phone: ${order.phone}`,
    `Total: ${rupees(order.total)}`,
    `Payment: ${order.paymentMethod} (${order.paymentStatus})`,
    `Status: ${order.orderStatus}`,
  ];
if (order.paymentReference) lines.push(`UTR: ${order.paymentReference}`);
  if (order.landmark) lines.push(`Landmark: ${order.landmark}`);
  // Always present, including when there is no area. An order the admin cannot see
  // a delivery area for is exactly the one where they most need to be told to check
  // the address themselves, so the line is omitted-never rather than
  // omitted-quietly.
  lines.push(`Delivery: ${deliveryLine(order)}`);
  return lines.join("\n");
}

/**
 * A wa.me deep link with the summary URL-encoded.
 *
 * encodeURIComponent is applied to the whole message, so a name containing `&`,
 * `?` or a newline cannot break out of the query string and inject parameters.
 * A personal number simply opens the chat with the text pre-filled — the admin
 * presses send. Nothing is sent automatically, and the customer's own number is
 * never used as a target.
 */
export function whatsappLink(order) {
  const number = whatsappNumber();
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(orderSummaryText(order))}`;
}

/* ----------------------------- Tracking links ----------------------------- */

/**
 * The customer's secure tracking link.
 *
 * The token travels in the URL FRAGMENT (`#t=`), not the query string. That is a
 * deliberate choice, not a stylistic one:
 *
 *   * a fragment is not sent in the request line, so it never lands in Vercel
 *     access logs, a CDN log, or a Referer header;
 *   * it is not sent to any analytics or error-reporting script;
 *   * it is still readable by our own client-side router, which is all we need.
 *
 * The token is the same per-order secret the customer already receives at order
 * time, and every lookup still authenticates against `access_hash` in constant
 * time. Nothing about this link is a weaker path into the order — it is the same
 * proof, carried somewhere that will not be logged.
 */
export function trackingLink(orderId, trackingToken) {
  if (!orderId || !trackingToken) return null;
  const base = siteBaseUrl().replace(/\/+$/, "");
  // encodeURIComponent on both halves: the id is server-generated but the token is
  // a hex secret, and neither is worth trusting to not need escaping.
  return `${base}/#/order/${encodeURIComponent(orderId)}?t=${encodeURIComponent(trackingToken)}`;
}

/* ------------------------------ Shared content ---------------------------- */

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const row = (label, value) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(label)}</td>` +
  `<td style="padding:4px 0">${escapeHtml(String(value ?? "—"))}</td></tr>`;

const statusLabel = (value) => ORDER_STATUS_LABELS[value] ?? String(value ?? "—");
const paymentLabel = (value) => PAYMENT_STATUS_LABELS[value] ?? String(value ?? "—");
const methodLabel = (value) => PAYMENT_METHOD_LABELS[value] ?? String(value ?? "—");
const providerLabel = (value) => PAYMENT_PROVIDER_LABELS[value] ?? (value ?? "—");

/**
 * The delivery line, honest about what is and is not known.
 *
 * An order carries the area the customer chose and their confirmation of the
 * address. It does NOT carry a verified distance, because nothing measured one —
 * so this line must never imply that JOC has confirmed the address is deliverable.
 * `deliveryAreaSummary` gives the area and the confirmation state; the pending
 * label is appended when the confirmation is absent, which is what an order placed
 * before the area list looks like.
 */
function deliveryLine(order) {
  if (!order.deliveryArea) return "No area recorded — confirm the address before preparing";
  const summary = deliveryAreaSummary(order);
  return order.deliveryAreaConfirmed === true
    ? summary
    : `${summary} · ${DELIVERY_AREA_PENDING_LABEL}`;
}

/** The money block, identical in admin and customer mail. Server-priced only. */
function totalsLines(order) {
  return [
    `Subtotal: ${rupees(order.subtotal)}`,
    // A zero charge is undecided, not free. Saying "₹0" to a customer would be a
    // claim JOC has not made.
    `Delivery charge: ${order.deliveryCharge > 0 ? rupees(order.deliveryCharge) : DELIVERY_PENDING_LABEL}`,
    `Total: ${rupees(order.total)} ${order.currency ?? CURRENCY}`,
  ];
}

/** A consistent, inline-only email frame. No remote images, no tracking pixels. */
const emailShell = (heading, bodyHtml) => `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.5">
  <h2 style="margin:0 0 12px">${escapeHtml(heading)}</h2>
  ${bodyHtml}
  <p style="margin-top:24px;color:#888;font-size:12px">
    Sent by JOC — Juice On Choice. This message is about your own order.
  </p>
</div>`;

/** A single prominent button plus the raw URL, so it works with images off. */
function trackingLinkBlock(link, label = "Track your order") {
  if (!link) return "";
  return `
    <p style="margin:20px 0 8px">
      <a href="${escapeHtml(link)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a>
    </p>
    <p style="margin:0;color:#888;font-size:12px;word-break:break-all">
      Or paste this link into your browser:<br>${escapeHtml(link)}
    </p>`;
}

/* --------------------------- Admin: new order ----------------------------- */

function adminNewOrderContent(order) {
  const text = [
    `New JOC order ${order.orderId}`,
    "",
    `Received: ${order.createdAt}`,
    `Name: ${order.customerName}`,
    `Phone: ${order.phone}`,
    `Email: ${order.customerEmail ?? "not provided"}`,
    `Address: ${order.address}`,
    order.landmark ? `Landmark: ${order.landmark}` : null,
order.specialInstructions ? `Special instructions: ${order.specialInstructions}` : null,
    `Delivery area: ${deliveryLine(order)}`,
    "",
    "Items:",
    itemLines(order),
    "",
    ...totalsLines(order),
    "",
    `Payment method: ${methodLabel(order.paymentMethod)}`,
    `Payment provider: ${providerLabel(order.paymentProvider)}`,
    `Payment status: ${paymentLabel(order.paymentStatus)}`,
    order.paymentReference ? `UTR / reference: ${order.paymentReference}` : null,
    `Order status: ${statusLabel(order.orderStatus)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = emailShell(
    `New order — ${order.orderId}`,
    `<table style="border-collapse:collapse">${[
      row("Received", order.createdAt),
      row("Name", order.customerName),
      row("Phone", order.phone),
      row("Email", order.customerEmail ?? "not provided"),
      row("Address", order.address),
      row("Landmark", order.landmark),
row("Special instructions", order.specialInstructions),
      row("Delivery area", deliveryLine(order)),
    ].join("")}</table>
    <h3 style="margin:16px 0 8px">Items</h3>
    <ul style="margin:0;padding-left:20px">${(order.items ?? [])
      .map(
        (item) =>
          `<li>${escapeHtml(item.name)} &times; ${item.qty} — ${rupees(item.lineTotal)}</li>`,
      )
      .join("")}</ul>
    <table style="border-collapse:collapse;margin-top:12px">${[
      row("Subtotal", rupees(order.subtotal)),
      row(
        "Delivery charge",
        order.deliveryCharge > 0 ? rupees(order.deliveryCharge) : DELIVERY_PENDING_LABEL,
      ),
      row("Total", `${rupees(order.total)} ${order.currency ?? CURRENCY}`),
      row("Payment method", methodLabel(order.paymentMethod)),
      row("Payment provider", providerLabel(order.paymentProvider)),
      row("Payment status", paymentLabel(order.paymentStatus)),
      row("UTR / reference", order.paymentReference ?? "—"),
      row("Order status", statusLabel(order.orderStatus)),
    ].join("")}</table>
    <p style="margin-top:16px;color:#666">
      ${
        order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED
          ? "This order is waiting for manual UPI payment verification."
          : "Open the admin dashboard to act on this order."
      }
    </p>`,
  );

  return {
    subject: `New JOC order ${order.orderId} — ${rupees(order.total)} (${paymentLabel(order.paymentStatus)})`,
    text,
    html,
  };
}

/* ------------------------ Customer: order received ------------------------ */

function customerOrderReceivedContent(order, link) {
  const text = [
    `We have your JOC order ${order.orderId}.`,
    "",
    `Name: ${order.customerName}`,
    `Items:`,
    itemLines(order),
    "",
    ...totalsLines(order),
    `Paying by: ${methodLabel(order.paymentMethod)}`,
    order.paymentMethod === "UPI" && order.paymentStatus === PAYMENT_STATUS.PENDING
      ? "Open your tracking link to pay by UPI and submit your UTR."
      : null,
    "",
    `Track your order: ${link ?? "(use the link on the JOC site)"}`,
    "",
`Delivery area: ${order.deliveryAreaName ?? order.deliveryArea ?? "not recorded"}`,
    `Delivery address: ${order.address}${order.landmark ? ` (near ${order.landmark})` : ""}`,
    "",
    "JOC will confirm delivery availability before preparing your order.",
    "",
    "Thank you for ordering from JOC.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = emailShell(
    `Order received — ${order.orderId}`,
    `<p>Thank you for ordering from JOC. We have your order and will start preparing it shortly.</p>
    <h3 style="margin:16px 0 8px">Items</h3>
    <ul style="margin:0;padding-left:20px">${(order.items ?? [])
      .map(
        (item) =>
          `<li>${escapeHtml(item.name)} &times; ${item.qty} — ${rupees(item.lineTotal)}</li>`,
      )
      .join("")}</ul>
    <table style="border-collapse:collapse;margin-top:12px">${[
      row("Subtotal", rupees(order.subtotal)),
      row(
        "Delivery charge",
        order.deliveryCharge > 0 ? rupees(order.deliveryCharge) : DELIVERY_PENDING_LABEL,
      ),
      row("Total", `${rupees(order.total)} ${order.currency ?? CURRENCY}`),
      row("Paying by", methodLabel(order.paymentMethod)),
    ].join("")}</table>
    ${trackingLinkBlock(link)}`,
  );

  return {
    subject: `We have your JOC order ${order.orderId}`,
    text,
    html,
  };
}

/* ------------------------- Customer: status change ------------------------ */

/**
 * What the customer is actually told at each step.
 *
 * A status label on its own ("PREPARING") is not information. Each state carries
 * the sentence that tells the customer whether there is anything left for them to
 * do, which is the only reason they need the message at all.
 */
const STATUS_COPY = {
  CONFIRMED: "We have confirmed your order.",
  PREPARING: "We are preparing your order now.",
  READY: "Your order is packed and ready.",
  OUT_FOR_DELIVERY: "Your order is on the way to you.",
  DELIVERED: "Your order has been delivered. Thank you for ordering from JOC.",
  CANCELLED: "Your order has been cancelled. If this was not expected, please contact JOC.",
};

function customerStatusContent(order, link) {
  const headline = STATUS_COPY[order.orderStatus] ?? `Your order is now: ${statusLabel(order.orderStatus)}.`;

  const text = [
    `${headline}`,
    "",
    `Order ${order.orderId}`,
    `Status: ${statusLabel(order.orderStatus)}`,
    link ? `Track your order: ${link}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = emailShell(
    `Order ${order.orderId} — ${statusLabel(order.orderStatus)}`,
    `<p style="font-size:15px">${escapeHtml(headline)}</p>
    ${trackingLinkBlock(link, "View order status")}`,
  );

  return {
    subject: `Order ${order.orderId} — ${statusLabel(order.orderStatus)}`,
    text,
    html,
  };
}

/* ---------------------- Customer: payment verified ------------------------ */

function customerPaymentVerifiedContent(order, link) {
  const text = [
    "Your JOC payment has been confirmed.",
    "",
    `Order ${order.orderId}`,
    `Amount: ${rupees(order.total)} ${order.currency ?? CURRENCY}`,
    `Paid by: ${methodLabel(order.paymentMethod)}`,
    link ? `Track your order: ${link}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = emailShell(
    `Payment confirmed — ${order.orderId}`,
    `<p>JOC has confirmed your payment. We are preparing your order now.</p>
    <table style="border-collapse:collapse">${[
      row("Order", order.orderId),
      row("Amount", `${rupees(order.total)} ${order.currency ?? CURRENCY}`),
      row("Paid by", methodLabel(order.paymentMethod)),
    ].join("")}</table>
    ${trackingLinkBlock(link, "View order status")}`,
  );

  return {
    subject: `Payment confirmed — order ${order.orderId}`,
    text,
    html,
  };
}

/* ------------------------------ The dispatcher ---------------------------- */

/**
 * Claim, send, resolve. The whole idempotency contract lives here.
 *
 * `skipWhen` doubles as the recipient resolver: it returns the address to send
 * to, or null for "there is nobody to send this to" (email unconfigured, or the
 * customer gave no address). One function decides it, so the address recorded in
 * the ledger is provably the address the message actually went to.
 *
 * A suppressed notification is recorded as 'skipped' rather than left unclaimed,
 * so a later status change does not re-decide the same question and does not
 * produce a surprise send the moment someone fixes a setting.
 */
async function dispatch({ store, row, type, dedupeKey, skipWhen, build }) {
  if (typeof row?.id !== "string" && typeof row?.id !== "number") {
    return { sent: false, reason: "no_order_row" };
  }

  const order = toAdminOrder(row);
  if (!order) return { sent: false, reason: "no_order_row" };

  const to = skipWhen?.(order);
  if (to === null) {
    // A deliberate "there is nobody to send this to". Record it once.
    const claim = await safeClaim(store, {
      orderUuid: row.id,
      orderRef: order.orderId,
      type,
      dedupeKey,
      recipient: "none",
    });
    if (claim.claimed) await safeComplete(store, claim.notification.id, "skipped");
    return { sent: false, reason: "no_recipient", skipped: true };
  }

  const claim = await safeClaim(store, {
    orderUuid: row.id,
    orderRef: order.orderId,
    type,
    dedupeKey,
    recipient: to,
  });
  if (!claim.claimed) return { sent: false, reason: "duplicate", status: claim.status };

  // The resolved recipient is attached HERE rather than inside each `build`, so
  // the address written to the ledger and the address the provider is handed are
  // the same value by construction — one resolver, two uses, no chance of drift.
  const result = await safeSend({ ...build(order), to });
  await safeComplete(store, claim.notification.id, result.sent ? "sent" : "failed", result.reason);
  return result;
}


/**
 * The claim and the completion are themselves wrapped, because a notification
 * must not be able to fail an order even when the DATABASE is unhappy. If the
 * ledger is unavailable the send still happens — losing the exactly-once
 * guarantee is strictly better than losing the customer's order, and the next
 * successful request will re-claim and re-evaluate normally.
 */
async function safeClaim(store, args) {
  try {
    return await store.claimNotification({
      ...args,
      leaseSeconds: NOTIFICATION_LEASE_SECONDS,
    });
  } catch (error) {
    console.error("[joc-notify] could not claim the notification:", error?.message ?? error);
    // Treated as claimed so the send proceeds. Idempotency degrades; delivery does not.
    return { claimed: true, notification: { id: null } };
  }
}

async function safeComplete(store, id, status, reason) {
  if (id === null || id === undefined) return;
  try {
    await store.completeNotification(id, status, reason);
  } catch (error) {
    console.error("[joc-notify] could not record the notification result:", error?.message ?? error);
  }
}

const safeSend = async (content) => {
  logEmailConfigurationOnce();
  const result = await sendEmail(content);
  return { sent: result.sent, reason: result.reason, id: result.id };
};

/**
 * The recipient of a customer message, or null for "send nothing".
 *
 * Two things have to be true before a customer mail is worth attempting: the
 * customer left an address, and the server has somewhere to send it from. Both are
 * checked here rather than inside `sendEmail`, because a delivery that cannot even
 * be attempted should be recorded as a deliberate skip — not attempted, failed,
 * and retried on every subsequent status change for the life of the order.
 */
const customerRecipient = (order) =>
  emailConfig().configured ? order.customerEmail || null : null;


/* ------------------------------ Public surface ---------------------------- */

/**
 * The admin's new-order alert.
 *
 * Called with the RAW row, not the mapped order, because the tracking token is
 * read from the row and must not be part of any shape that could be serialised.
 */
export async function notifyNewOrder(store, row) {
  const config = emailConfig();
  return dispatch({
    store,
    row,
    type: NOTIFICATION_TYPE.ADMIN_NEW_ORDER,
    dedupeKey: "created",

    // Unconfigured mail is a decision, not an error: recorded once, never retried.
    skipWhen: () => (config.configured ? config.adminTo : null),
    build: (order) => adminNewOrderContent(order),
  });
}

/**
 * The customer's "we have your order" message, with their tracking link.
 *
 * No email address on the order means no message — and that is recorded as
 * 'skipped', so an order with no address does not accumulate rows on every status
 * change for the rest of its life.
 */
export async function notifyOrderReceived(store, row) {
  return dispatch({
    store,
    row,
    type: NOTIFICATION_TYPE.CUSTOMER_ORDER_RECEIVED,
    dedupeKey: "received",

    skipWhen: customerRecipient,
    build: (order) =>
      customerOrderReceivedContent(order, trackingLink(order.orderId, readTrackingToken(row))),
  });
}


/**
 * A status change.
 *
 * The dedupe key is the NEW STATUS VALUE, which is what makes re-saving the same
 * status free (the key collides, the claim is lost, nothing is sent) while a real
 * transition always notifies. An admin who sets PREPARING by mistake and corrects
 * it to PREPARING again sends nothing extra; an order that goes PREPARING ->
 * READY -> PREPARING does notify twice, because the customer genuinely saw three
 * different states and should not be left with a stale one.
 */
export async function notifyOrderStatus(store, row) {
  return dispatch({
    store,
    row,
    type: NOTIFICATION_TYPE.CUSTOMER_STATUS,
    dedupeKey: String(row?.order_status ?? "unknown"),

    skipWhen: customerRecipient,
    build: (order) =>
      customerStatusContent(order, trackingLink(order.orderId, readTrackingToken(row))),

  });
}

/** Sent once, when a payment actually becomes PAID. */
export async function notifyPaymentVerified(store, row) {
  return dispatch({
    store,
    row,
    type: NOTIFICATION_TYPE.CUSTOMER_PAYMENT_VERIFIED,
    dedupeKey: "verified",

    skipWhen: customerRecipient,
    build: (order) =>
      customerPaymentVerifiedContent(order, trackingLink(order.orderId, readTrackingToken(row))),

  });
}

/** Everything the dashboard needs to build its own notification affordances. */
export function notifyConfig() {
  return {
    whatsappNumber: whatsappNumber(),
    email: emailConfig().configured,
    /** Customer email is per-order, so this is a capability, not a setting. */
    customerEmailSupported: true,
  };
}
