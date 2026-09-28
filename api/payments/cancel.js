/**
 * POST /api/payments/cancel — record that a payment did not complete.
 *
 * Covers both Razorpay dismissal and a hard failure. Also handles the
 * "change to Cash on Delivery" path so a customer who cannot pay online is not
 * stuck: the same order record is converted in place, never duplicated.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "../../shared/ordering.js";

const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `cancel:${clientKey(req)}`, limit: 20, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many requests. Please try again shortly.", "rate_limited");
    }

    const body = await readJson(req);
    const orderId = typeof body?.orderId === "string" ? body.orderId.toUpperCase() : "";
    if (!ORDER_ID_RE.test(orderId)) {
      throw new ApiError(400, "That order reference is not valid.", "invalid_order_id");
    }

    const toCod = body?.paymentMethod === PAYMENT_METHOD.COD;

    const store = await getStore();
    const order = await store.getOrder(orderId);
    if (!order) throw new ApiError(404, "We could not find that order.", "order_not_found");

    // A completed payment is never downgraded by this endpoint.
    if (order.payment_status === PAYMENT_STATUS.PAID) {
      return sendJson(res, 200, { order: toPublicOrder(order), changed: false });
    }

    const updated = toCod
      ? await store.setPaymentMethod(orderId, PAYMENT_METHOD.COD)
      : await store.updatePayment(orderId, { paymentStatus: PAYMENT_STATUS.FAILED });

    return sendJson(res, 200, { order: toPublicOrder(updated), changed: true });
  } catch (error) {
    return sendError(res, error);
  }
}
