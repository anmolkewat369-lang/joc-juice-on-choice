/**
 * The payment routes, served from one function.
 *
 *   POST /api/payments/create   open a Razorpay checkout for an existing order
 *   GET  /api/payments/methods  what the customer can actually pay with
 *
 * They share a file because the Vercel Hobby plan caps a deployment at 12
 * functions. Neither lost its URL: vercel.json rewrites /api/payments/methods
 * onto this function, and `servesAlias` tells the two requests apart. The two
 * halves share nothing: the GET is the same public capability read as before,
 * with no token and no rate limit, and the POST keeps its authentication,
 * rate limit and Razorpay behaviour exactly as they were.
 */

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

/**
 * GET /api/payments/methods — what the customer can actually pay with.
 *
 * A public, unauthenticated read of *capability*, not of configuration: it says
 * whether a digital payment is offered and which rail settles it, and it never
 * returns a UPI ID, a gateway key, or anything else sensitive. The checkout
 * renders its options from this response so the UI can never offer a method the
 * server would then refuse.
 *
 * The amount, intent URI and QR are deliberately absent here. Those are only
 * returned with an order the caller owns, because the amount must come from the
 * priced order rather than from anything the browser supplies.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey, servesAlias } from "../_lib/http.js";
import { getStore } from "../_lib/store.js";
import {
  createGatewayOrder,
  merchantProfile,
  paymentConfig,
  isTestMode,
} from "../_lib/razorpay.js";
import { activeProvider, availableMethods } from "../_lib/payments.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { requireOwnedOrderId, orderIdFromBody, isOrderId } from "../_lib/orderToken.js";
import { PAYMENT_METHOD, PAYMENT_STATUS, PAYMENT_PROVIDER } from "../../shared/ordering.js";

async function paymentMethods(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  return sendJson(res, 200, {
    methods: availableMethods(),
    provider: activeProvider(),
  });
}

async function createPayment(req, res) {
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

export default async function handler(req, res) {
  // The rewritten /api/payments/methods is a capability read; the create route it
  // was merged with is a POST that authenticates the order's own token. The GET
  // half is reached only by its own method guard, so the merge cannot offer a
  // tokenless path into Razorpay.
  if (servesAlias(req, { primary: "/api/payments/create", alias: "/api/payments/methods" })) {
    return paymentMethods(req, res);
  }
  return createPayment(req, res);
}
