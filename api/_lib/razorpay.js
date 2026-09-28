/**
 * Razorpay integration — server side only.
 *
 * RAZORPAY_KEY_SECRET is read from the environment and never leaves this
 * process. There is no gateway SDK dependency: the API is plain HTTPS + a
 * documented HMAC signature, which keeps the bundle small and the surface
 * obvious.
 *
 * Official reference: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./http.js";
import { BRAND } from "../../src/data/business.js";

const API_BASE = "https://api.razorpay.com/v1";

/**
 * Test mode is the default and is a deliberate safety rail: live payments are
 * only possible when the key id itself is a live key. See `paymentConfig()`.
 */
export const isTestMode = () =>
  String(process.env.RAZORPAY_TEST_MODE ?? "true").toLowerCase() !== "false";

export function hasRazorpayCredentials() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/** Values the browser needs. The secret is not, and cannot, be in here. */
export function paymentConfig() {
  if (!hasRazorpayCredentials()) {
    throw new ApiError(
      503,
      "Online payment is not available yet. Please choose Cash on Delivery.",
      "payments_unavailable",
    );
  }
  return { keyId: process.env.RAZORPAY_KEY_ID, testMode: isTestMode() };
}

const authHeader = () =>
  `Basic ${Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64")}`;

async function razorpayRequest(path, { method = "POST", body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Never surface the gateway's raw error to the customer.
    throw new ApiError(
      502,
      "The payment service could not be reached. Please try again.",
      "payment_gateway_unreachable",
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const description = payload?.error?.description ?? "Payment could not be started.";
    console.error(
      "[joc-api] razorpay",
      method,
      path,
      response.status,
      description,
    );
    throw new ApiError(502, description, "payment_gateway_error");
  }

  return payload;
}

/**
 * Create the gateway order. `receipt` is our own order id, which is how a
 * webhook or a support query can be traced back without storing card data.
 */
export async function createGatewayOrder({ amount, currency, receipt, notes }) {
  const payload = await razorpayRequest("/orders", {
    body: {
      amount,
      currency,
      receipt,
      notes,
      payment_capture: 1,
    },
  });

  return {
    id: payload.id,
    amount: payload.amount,
    currency: payload.currency,
    status: payload.status,
  };
}

export async function fetchGatewayOrder(razorpayOrderId) {
  const payload = await razorpayRequest(`/orders/${encodeURIComponent(razorpayOrderId)}`, {
    method: "GET",
  });
  return { id: payload.id, status: payload.status, amount: payload.amount, paid: payload.paid };
}

/**
 * Verify the checkout response signature: HMAC-SHA256(razorpay_order_id + "|"
 * razorpay_payment_id, key_secret) must equal razorpay_signature.
 *
 * This is the step that makes `paymentStatus: PAID` trustworthy — the browser's
 * own success callback proves nothing on its own.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;

  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The amount Razorpay actually charged, in the smallest unit it reports back.
 * Compared against our own total so a mismatch can never mark an order paid.
 */
export function paiseToRupees(paise) {
  return Math.round(Number(paise) / 100);
}

export const merchantProfile = () => ({
  name: BRAND.name,
  description: `${BRAND.name} order`,
});
