/**
 * POST /api/orders/utr — submit a UPI transaction reference (UTR).
 *
 * This is the hinge of the whole manual-UPI design, so it is deliberately narrow.
 *
 * It requires the customer's own X-Order-Token, exactly like order lookup: order
 * ids are sequential, so possession of the id must never be enough to touch
 * somebody else's order.
 *
 * It validates the order, then moves it to PAYMENT_VERIFICATION_REQUIRED and
 * records the reference. It cannot mark an order PAID — there is no request
 * field, query parameter or code path here that produces PAID, and PAID is only
 * reachable through an authenticated admin verification or a verified gateway
 * signature. Submitting a UTR is a claim, and this endpoint stores a claim.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import { requireOwnedOrderId, orderIdFromBody } from "../_lib/orderToken.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { paymentViewFor } from "../_lib/payments.js";
import {
  normalisePaymentReference,
  UTR_MESSAGES,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  ORDER_STATUS,
  PAYMENT_PROVIDER,
} from "../../shared/ordering.js";
import { appendOrderEvent } from "../_lib/orderEvents.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `utr:${clientKey(req)}`, limit: 10, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many attempts. Please wait a moment.", "rate_limited");
    }

    const body = await readJson(req);
    const orderId = orderIdFromBody(body);

    const store = await getStore();

    // 404 unless the order exists *and* the caller owns it, proven by the
    // secret issued at creation. Order ids are sequential, so the id alone is
    // never sufficient.
    const row = await requireOwnedOrderId(req, store, orderId);

    if (row.payment_method !== PAYMENT_METHOD.UPI) {
      throw new ApiError(
        409,
        "This order is not a digital payment, so it has no transaction reference.",
        "payment_method_mismatch",
      );
    }
    if (row.order_status === ORDER_STATUS.CANCELLED) {
      throw new ApiError(409, "This order has been cancelled.", "order_cancelled");
    }
    if (row.payment_status === PAYMENT_STATUS.PAID) {
      throw new ApiError(409, "This order has already been paid.", "already_paid");
    }

    const { value: reference, error } = normalisePaymentReference(
      body?.paymentReference ?? body?.utr,
    );
    if (error) {
      throw new ApiError(422, error ?? UTR_MESSAGES.invalid, "invalid_payment_reference");
    }

    // A repeat submission of the same reference is a no-op, not an error, so a
    // double tap or a retry after a timeout is harmless.
    const previousReference = row.payment_reference;
    if (
      row.payment_status === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED &&
      previousReference === reference
    ) {
      return sendJson(res, 200, {
        order: toPublicOrder(row),
        payment: paymentViewFor(row),
        alreadySubmitted: true,
      });
    }

    const updated = await store.submitPaymentReference(
      orderId,
      reference,
      PAYMENT_PROVIDER.MANUAL_UPI,
    );
    if (!updated) {
      // The row changed underneath us (cancelled, or already paid).
      throw new ApiError(409, "This order can no longer accept a payment reference.", "order_state_changed");
    }

    await appendOrderEvent(store, updated, {
      eventType: "PAYMENT_REFERENCE_SUBMITTED",
      field: "payment_reference",
      oldValue: previousReference,
      newValue: reference,
      actor: "customer",
    });

    return sendJson(res, 200, {
      order: toPublicOrder(updated),
      payment: paymentViewFor(updated),
      alreadySubmitted: false,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
