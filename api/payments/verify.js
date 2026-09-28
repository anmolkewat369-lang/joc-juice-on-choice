/**
 * POST /api/payments/verify — the only route that can set paymentStatus = PAID.
 *
 * The browser's success callback is treated as a claim, not a fact. Three
 * independent checks must pass before an order is marked paid:
 *
 *   1. the HMAC signature over `orderId|paymentId` matches the key secret;
 *   2. the gateway order id matches the one we created for this order;
 *   3. the amount Razorpay recorded matches the amount we priced.
 *
 * Replaying a verification that already succeeded is a no-op, not a new state.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import {
  verifyPaymentSignature,
  fetchGatewayOrder,
  paiseToRupees,
  hasRazorpayCredentials,
  isTestMode,
} from "../_lib/razorpay.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { PAYMENT_METHOD, PAYMENT_STATUS, ORDER_STATUS } from "../../shared/ordering.js";

const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `verify:${clientKey(req)}`, limit: 20, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many requests. Please try again shortly.", "rate_limited");
    }

    // Without a key secret nothing can be verified, so refuse up front rather
    // than reporting a payment as unverified when the real cause is a
    // half-configured deployment.
    if (!hasRazorpayCredentials()) {
      throw new ApiError(
        503,
        "Online payment is not available yet. Please choose Cash on Delivery.",
        "payments_unavailable",
      );
    }

    const body = await readJson(req);
    const orderId = typeof body?.orderId === "string" ? body.orderId.toUpperCase() : "";
    if (!ORDER_ID_RE.test(orderId)) {
      throw new ApiError(400, "That order reference is not valid.", "invalid_order_id");
    }

    const store = await getStore();
    const order = await store.getOrder(orderId);
    if (!order) throw new ApiError(404, "We could not find that order.", "order_not_found");

    // Idempotent: verifying twice is harmless.
    if (order.payment_status === PAYMENT_STATUS.PAID) {
      return sendJson(res, 200, { order: toPublicOrder(order), verified: true });
    }
    if (order.payment_method !== PAYMENT_METHOD.ONLINE) {
      throw new ApiError(409, "This order is not an online payment.", "payment_method_mismatch");
    }

    const gatewayOrderId = String(body?.gatewayOrderId ?? "");
    const paymentId = String(body?.paymentId ?? "");
    const signature = String(body?.signature ?? "");

    const signatureOk = verifyPaymentSignature({
      orderId: gatewayOrderId,
      paymentId,
      signature,
    });
    if (!signatureOk) {
      // Signature did not come from Razorpay with our secret. Refuse, and say so
      // as a failed payment rather than a server error.
      await store.updatePayment(orderId, { paymentStatus: PAYMENT_STATUS.FAILED });
      throw new ApiError(400, "Payment could not be verified.", "payment_verification_failed");
    }

    if (order.razorpay_order_id && order.razorpay_order_id !== gatewayOrderId) {
      throw new ApiError(400, "Payment does not match this order.", "payment_mismatch");
    }

    // Confirm with the gateway itself rather than trusting the callback payload.
    const gatewayOrder = await fetchGatewayOrder(gatewayOrderId);
    if (!gatewayOrder.paid || gatewayOrder.status !== "paid") {
      // The signature and amount are consistent, but Razorpay has not actually
      // captured money for this order. That can never be recorded as PAID.
      await store.updatePayment(orderId, { paymentStatus: PAYMENT_STATUS.FAILED });
      throw new ApiError(
        400,
        "The payment has not completed at the payment provider.",
        "payment_not_completed",
      );
    }
    if (paiseToRupees(gatewayOrder.amount) !== order.total) {
      await store.updatePayment(orderId, { paymentStatus: PAYMENT_STATUS.FAILED });
      throw new ApiError(400, "The paid amount did not match the order total.", "amount_mismatch");
    }

    const updated = await store.updatePayment(orderId, {
      paymentStatus: PAYMENT_STATUS.PAID,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
      // The order records whether the money actually moved: a test gateway
      // payment is labeled as such at the source, not guessed at display time.
      paymentMethodUsed: isTestMode() ? "razorpay_test" : "razorpay",
      orderStatus: order.order_status || ORDER_STATUS.RECEIVED,
    });

    return sendJson(res, 200, { order: toPublicOrder(updated), verified: true });
  } catch (error) {
    return sendError(res, error);
  }
}
