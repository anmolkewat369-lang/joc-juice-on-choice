/**
 * New-order notifications.
 *
 * Four channels, none of which may ever affect whether an order succeeds:
 *
 *   dashboard  browser notification + sound + badge, from the dashboard's own
 *              polling of /api/admin/orders — no server involvement
 *   whatsapp   a wa.me deep link the admin taps; this is NOT automated
 *              messaging, because a personal WhatsApp number has no business
 *              API attached to it
 *   email      Resend, optional and entirely absent-by-default
 *
 * The rule that matters: nothing in this file can make order creation fail, and
 * nothing here can make a customer see or pay an amount that the server did not
 * price. `notifyNewOrder` therefore never throws.
 */

import { CURRENCY, PAYMENT_STATUS } from "../../shared/ordering.js";

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/** The configured WhatsApp number in international digits, or null. */
export function whatsappNumber() {
  const raw = env("JOC_WHATSAPP_NUMBER").replace(/[^\d]/g, "");
  return raw.length >= 8 && raw.length <= 15 ? raw : null;
}

/** Email is optional. Missing configuration is reported once, plainly, and skipped. */
export function emailConfig() {
  const apiKey = env("RESEND_API_KEY");
  const from = env("JOC_NOTIFY_FROM");
  const to = env("JOC_NOTIFY_EMAIL");
  return {
    apiKey: apiKey || null,
    from: from || null,
    to: to || null,
    enabled: Boolean(apiKey && from && to),
  };
}

let missingEmailLogged = false;

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
  return lines.join("\n");
}

/**
 * A wa.me deep link with the summary URL-encoded.
 *
 * encodeURIComponent is applied to the whole message, so a name containing `&`,
 * `?` or a newline cannot break out of the query string and inject parameters.
 * A personal number simply opens the chat with the text pre-filled — the admin
 * presses send.
 */
export function whatsappLink(order) {
  const number = whatsappNumber();
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(orderSummaryText(order))}`;
}

/** Plain-text + HTML bodies for the Resend message. No secrets, no payment data. */
function emailContent(order) {
  const text = [
    `New JOC order ${order.orderId}`,
    "",
    `Received: ${order.createdAt}`,
    `Name: ${order.customerName}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}`,
    order.landmark ? `Landmark: ${order.landmark}` : null,
    order.specialInstructions ? `Special instructions: ${order.specialInstructions}` : null,
    "",
    "Items:",
    itemLines(order),
    "",
    `Subtotal: ${rupees(order.subtotal)}`,
    `Delivery charge: ${rupees(order.deliveryCharge)}`,
    `Total: ${rupees(order.total)} ${order.currency ?? CURRENCY}`,
    "",
    `Payment method: ${order.paymentMethod}`,
    `Payment provider: ${order.paymentProvider ?? "—"}`,
    `Payment status: ${order.paymentStatus}`,
    order.paymentReference ? `UTR / reference: ${order.paymentReference}` : null,
    `Order status: ${order.orderStatus}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 0">${escapeHtml(String(value ?? "—"))}</td></tr>`;

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
  <h2 style="margin:0 0 12px">New order — ${escapeHtml(order.orderId)}</h2>
  <table style="border-collapse:collapse">${[
    row("Received", order.createdAt),
    row("Name", order.customerName),
    row("Phone", order.phone),
    row("Address", order.address),
    row("Landmark", order.landmark || "—"),
    row("Special instructions", order.specialInstructions || "—"),
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
    row("Delivery charge", rupees(order.deliveryCharge)),
    row("Total", `${rupees(order.total)} ${order.currency ?? CURRENCY}`),
    row("Payment method", order.paymentMethod),
    row("Payment provider", order.paymentProvider ?? "—"),
    row("Payment status", order.paymentStatus),
    row("UTR / reference", order.paymentReference ?? "—"),
    row("Order status", order.orderStatus),
  ].join("")}</table>
  <p style="margin-top:16px;color:#666">
    ${order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED
      ? "This order is waiting for manual UPI payment verification."
      : "Open the admin dashboard to act on this order."}
  </p>
</div>`;

  return { text, html };
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** POST the Resend message. Returns true only if the provider accepted it. */
async function sendEmail(config, order) {
  const { text, html } = emailContent(order);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [config.to],
      subject: `New JOC order ${order.orderId} — ${rupees(order.total)} (${order.paymentStatus})`,
      text,
      html,
    }),
  });

  if (!response.ok) {
    // Log the provider's status, never the API key.
    const detail = await response.text().catch(() => "");
    console.error(
      "[joc-notify] resend rejected the notification:",
      response.status,
      detail.slice(0, 200),
    );
    return false;
  }
  return true;
}

/**
 * Fire the optional email. Safe to await in the background; never throws.
 *
 * When email is not configured this logs one plain configuration line — naming
 * the variables to set, not their values — and returns false. The order is
 * unaffected and nothing pretends an email was sent.
 */
export async function notifyNewOrder(order) {
  const config = emailConfig();

  if (!config.enabled) {
    if (!missingEmailLogged) {
      missingEmailLogged = true;
      const missing = [];
      if (!config.apiKey) missing.push("RESEND_API_KEY");
      if (!config.from) missing.push("JOC_NOTIFY_FROM");
      if (!config.to) missing.push("JOC_NOTIFY_EMAIL");
      console.warn(
        `[joc-notify] email notifications are off. Set ${missing.join(", ")} to enable them. ` +
          "Dashboard, browser notification, sound and WhatsApp are unaffected.",
      );
    }
    return { emailed: false, reason: "email_not_configured" };
  }

  try {
    const emailed = await sendEmail(config, order);
    return { emailed, reason: emailed ? null : "email_rejected" };
  } catch (error) {
    console.error("[joc-notify] email notification failed:", error?.message ?? error);
    return { emailed: false, reason: "email_failed" };
  }
}

/** Everything the dashboard needs to build its own notification affordances. */
export function notifyConfig() {
  return {
    whatsappNumber: whatsappNumber(),
    email: emailConfig().enabled,
  };
}
