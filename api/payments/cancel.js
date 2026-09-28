/**
 * POST /api/payments/cancel — record that a payment did not complete.
 *
 * Covers both Razorpay dismissal and a hard failure. Also handles the
 * "change to Cash on Delivery" path so a customer who cannot pay online is not
 * stuck: the same order record is converted in place, never duplicated.
 *
 * Authorisation: requires the order's own X-Order-Token, in constant time. This
 * endpoint previously trusted the order id alone, which let anyone who guessed a
 * sequential order id downgrade it to COD or mark it failed.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { requireOwnedOrderId, orderIdFromBody, isOrderId } from "../_lib/orderToken.js";
import { appendOrderEvent } from "../_lib/orderEvents.js";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "../../shared/ordering.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `cancel:${clientKey(req)}`, limit: 20, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many requests. Please try again shortly.", "rate_limited");
    }

    const body = await readJson(req);
    const orderId = orderIdFromBody(body);
    if (!isOrderId(orderId)) {
      throw new ApiError(400, "That order reference is not valid.", "invalid_order_id");
    }

    const toCod = body?.paymentMethod === PAYMENT_METHOD.COD;

    const store = await getStore();
    const order = await requireOwnedOrderId(req, store, orderId);

    // A completed payment is never downgraded by this endpoint.
    if (order.payment_status === PAYMENT_STATUS.PAID) {
      return sendJson(res, 200, { order: toPublicOrder(order), changed: false });
    }

    const previousStatus = order.payment_status;
    const previousMethod = order.payment_method;
    const updated = toCod
      ? await store.setPaymentMethod(orderId, PAYMENT_METHOD.COD)
      : await store.updatePayment(orderId, { paymentStatus: PAYMENT_STATUS.FAILED });

    await appendOrderEvent(store, order, {
      eventType: toCod ? "PAYMENT_METHOD_CHANGED" : "PAYMENT_STATUS_CHANGED",
      field: toCod ? "payment_method" : "payment_status",
      oldValue: toCod ? previousMethod : previousStatus,
      newValue: toCod ? PAYMENT_METHOD.COD : PAYMENT_STATUS.FAILED,
      actor: "customer",
      note: toCod ? "Customer switched to Cash on Delivery" : "Customer reported the payment failed",
    });

    return sendJson(res, 200, { order: toPublicOrder(updated), changed: true });
  } catch (error) {
    return sendError(res, error);
  }
}
