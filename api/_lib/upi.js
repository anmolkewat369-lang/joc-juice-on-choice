/**
 * Manual UPI payment intent.
 *
 * A UPI order is settled outside the website: the customer pays JOC's UPI ID
 * from their own UPI app, then comes back and submits the transaction reference
 * (UTR) so JOC can match it. The server builds the intent from the order's own
 * total — the amount is never accepted from, or hard-coded for, the browser.
 *
 * Nothing here marks a payment as received. Building a payment intent and
 * confirming money arrived are two different acts, performed in two different
 * places by two different parties.
 */

import { qrSvg, canEncode, QR_MAX_BYTES } from "./qr.js";
import { BRAND } from "../../src/data/business.js";

/**
 * The UPI ID is operator@bank. Kept permissive on the handle because banks use
 * many formats, but strict on the shape, so a misconfigured value fails at
 * startup instead of rendering an unpayable QR to a customer.
 */
const UPI_ID_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9._-]{2,64}$/;

/**
 * Normalise a UPI ID read from configuration.
 *
 * A value pasted into a dashboard or a .env file arrives with whatever
 * whitespace and quoting the operator's tooling added, and an untrimmed
 * " 9630194023@pthdfc " or a quoted "9630194023@pthdfc" is silently not a UPI ID
 * at all. That would present as "online payment unavailable" with nothing wrong
 * in the dashboard, so both are stripped before the value is judged. Nothing
 * inside the ID is altered.
 */
export function normaliseUpiId(raw) {
  const text = String(raw ?? "").trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(text);
  return quoted ? quoted[2].trim() : text;
}

/**
 * The payment note the customer reads in their own UPI app, and which lands in
 * JOC's bank statement as the payment remark.
 *
 * It takes the order id directly. It used to take a whole order object and read
 * `order.order_id`, but every caller passed `{ orderId }` — so the note was
 * literally "JOC undefined" in the customer's app and in the bank statement. An
 * unreadable remark makes a customer distrust a payment they can otherwise see
 * is going to the right UPI ID.
 */
const noteFor = (orderId) => `JOC ${orderId ?? ""}`.trim().slice(0, 48);

/**
 * Payee name shown in the customer's UPI app.
 *
 * The name is intentionally the JOC brand, not the name of whoever's personal
 * UPI ID is currently configured, so a customer sees "JOC Juice and Cafe" rather
 * than a stranger's name. Swapping the account is a one-variable change.
 */
const payeeName = () => BRAND.name;

/**
 * Build the `upi://pay` intent for an order.
 *
 * Fields are added in priority order and dropped from the least important end
 * if the result would exceed what the QR encoder supports — a truncated URI is
 * worse than one without a merchant category code, because a truncated amount
 * is a wrong amount. `pa` (the UPI ID) and `am` (the amount) are never dropped.
 */
export function buildUpiIntent({ upiId, payeeName: payee, amount, orderId, currency = "INR" }) {
  const payeeUpiId = normaliseUpiId(upiId);
  if (!UPI_ID_RE.test(payeeUpiId)) {
    throw new Error("JOC_UPI_ID is not a valid UPI ID. Payments cannot be offered.");
  }
  const total = Math.round(Number(amount));
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("A UPI payment intent needs a positive order total.");
  }

  const name = String(payee ?? payeeName()).slice(0, 50);
  const optional = [
    ["cu", currency],
    ["pn", name],
    ["tn", noteFor(orderId)],
    ["tr", String(orderId ?? "").slice(0, 40)],
  ].filter(([, value]) => value);

  const required = [
    ["pa", payeeUpiId],
    ["am", total.toFixed(2)],
  ];

  let chosen = [...required, ...optional];
  while (Buffer.byteLength(buildUri(chosen), "utf8") > QR_MAX_BYTES && optional.length > 0) {
    optional.pop();
    chosen = [...required, ...optional];
  }

  const uri = buildUri(chosen);
  if (!canEncode(uri)) {
    throw new Error("The UPI payment intent is too long to encode reliably.");
  }

  return {
    vpa: payeeUpiId,
    payeeName: name,
    amount: total,
    currency,
    orderId: orderId ?? null,
    note: noteFor(orderId),
    reference: orderId ?? null,
    uri,
    /** Inline SVG — no third-party image request carries the payment address. */
    qrSvg: qrSvg(uri, { title: `UPI payment QR for JOC order ${orderId ?? ""}`.trim() }),
  };
}

const buildUri = (pairs) => `upi://pay?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;

/** Is a UPI ID configured well enough to offer manual UPI at all? */
export const isUpiConfigured = (upiId) => UPI_ID_RE.test(normaliseUpiId(upiId));
