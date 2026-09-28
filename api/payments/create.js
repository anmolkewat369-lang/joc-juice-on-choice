/**
 * POST /api/payments/create — open a Razorpay checkout for an existing order.
 *
 * The order is already stored by this point; this endpoint only attaches a
 * gateway order id to it. Retrying after a cancelled or failed payment reuses
 * the same order record, so a customer never ends up with two orders.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore } from "../_lib/store.js";
import {
  createGatewayOrder,
  merchantProfile,
  paymentConfig,
  isTestMode,
} from "../_lib/razorpay.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { PAYMENT_METHOD, PAYMENT_STATUS } from "../../shared/ordering.js";

const ORDER_ID_RE = /^JOC-\d{8}-\d{4,}$/i;

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `pay:${clientKey(req)}`, limit: 15, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many payment attempts. Please wait a moment.", "rate_limited");
    }

    const { keyId } = paymentConfig();
    const body = await readJson(req);
    const raw = body?.orderId;
    const orderId = typeof raw === "string" ? raw.toUpperCase() : "";
    if (!ORDER_ID_RE.test(orderId)) {
      throw new ApiError(400, "That order reference is not valid.", "invalid_order_id");
    }

    const store = await getStore();
    const order = await store.getOrder(orderId);
    if (!order) {
      throw new ApiError(404, "We could not find that order.", "order_not_found");
    }
    if (order.payment_method !== PAYMENT_METHOD.ONLINE) {
      throw new ApiError(
        409,
        "This order is not set up for online payment.",
        "payment_method_mismatch",
      );
    }
    if (order.payment_status === PAYMENT_STATUS.PAID) {
      throw new ApiError(409, "This order has already been paid.", "already_paid");
    }

    const profile = merchantProfile();
    const gatewayOrder = await createGatewayOrder({
      amount: order.total * 100, // Razorpay works in the smallest unit.
      currency: order.currency,
      receipt: order.order_id,
      notes: { jocOrderId: order.order_id, phone: order.phone },
    });

    await store.setRazorpayOrderId(orderId, gatewayOrder.id);

    return sendJson(res, 200, {
      keyId,
      testMode: isTestMode(),
      gatewayOrderId: gatewayOrder.id,
      amount: order.total * 100,
      currency: order.currency,
      orderId: order.order_id,
      profile,
      customer: { name: order.customer_name, contact: order.phone },
      // The secret key is never included in this response.
    });
  } catch (error) {
    return sendError(res, error);
  }
}
