/**
 * POST /api/payments/create — open a Razorpay checkout for an existing order.
 *
 * The order is already stored by this point; this endpoint only attaches a
 * gateway order id to it. Retrying after a cancelled or failed payment reuses
 * the same order record, so a customer never ends up with two orders.
 *
 * Authorisation: the caller must present the order's own X-Order-Token. Order ids
 * are sequential and therefore guessable, so without this any visitor could open
 * a Razorpay checkout against somebody else's order and, more seriously, walk
 * the confirm/cancel endpoints below. The token is compared in constant time and
 * a wrong token is indistinguishable from an unknown order.
 *
 * Provider: this route only ever applies to orders whose payment_provider is
 * `razorpay`. While JOC is on manual UPI, an order stamped `manual_upi` is
 * refused here and is paid through /api/orders/utr instead.
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
import { requireOwnedOrderId, orderIdFromBody, isOrderId } from "../_lib/orderToken.js";
import { PAYMENT_METHOD, PAYMENT_STATUS, PAYMENT_PROVIDER } from "../../shared/ordering.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `pay:${clientKey(req)}`, limit: 15, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many payment attempts. Please wait a moment.", "rate_limited");
    }

    const body = await readJson(req);
    const orderId = orderIdFromBody(body);
    if (!isOrderId(orderId)) {
      throw new ApiError(400, "That order reference is not valid.", "invalid_order_id");
    }

    const store = await getStore();
    // Authorisation first, capability second. Checking the order token before
    // reading gateway configuration means an unauthenticated caller cannot learn
    // anything about how this deployment is configured.
    const order = await requireOwnedOrderId(req, store, orderId);

    if (order.payment_method !== PAYMENT_METHOD.UPI) {
      throw new ApiError(
        409,
        "This order is not set up for online payment.",
        "payment_method_mismatch",
      );
    }
    if (order.payment_provider !== PAYMENT_PROVIDER.RAZORPAY) {
      throw new ApiError(
        409,
        "This order is paid by UPI. Please submit your UTR instead.",
        "provider_mismatch",
      );
    }
    if (order.payment_status === PAYMENT_STATUS.PAID) {
      throw new ApiError(409, "This order has already been paid.", "already_paid");
    }

    // Read the key only once the caller is known to own this order.
    const { keyId } = paymentConfig();

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
