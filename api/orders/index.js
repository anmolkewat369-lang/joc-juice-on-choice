/**
 * POST /api/orders — create an order (Cash on Delivery or UPI).
 *
 * Guest checkout: no account, no session, just an Idempotency-Key so a
 * double-clicked button, a refresh or a network retry cannot create two orders.
 *
 * The response also carries the authoritative `payment` view for a digital
 * order — the UPI ID, an intent URI and a QR, all built from the total priced
 * here. The customer never composes a payment string from their own copy of the
 * number, so a tampered or stale client cannot redirect the payment or change
 * the amount.
 *
 * THE ORDER OF OPERATIONS IS THE POINT
 *
 *   1. replay check   — has this idempotency key already created an order?
 *   2. validate       — shared contract, server-prices the menu
 *   3. verify delivery — Google geocode + driving distance, fail closed
 *   4. persist        — only now does an order, an ID, or a payment view exist
 *
 * Steps 1 and 3 are the two ends of this handler's whole character. Step 1 means
 * a retry never pays twice for a check it has already had, and — more important —
 * that a customer's already-placed order is never retracted because their address
 * has since drifted out of range. Step 3 means the delivery rule is enforced here,
 * by us, from the address in this request, and not by anything the client was
 * previously told. /api/delivery/check is a preview for the customer's benefit and
 * carries no authority whatsoever.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import {
  readIdempotencyKey,
  buildOrderRecord,
  withDeliveryVerification,
} from "../_lib/orderRequest.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { paymentViewFor } from "../_lib/payments.js";
import { orderCreatedEvent, recordEventQuietly } from "../_lib/orderEvents.js";
import { checkDelivery } from "../_lib/delivery.js";
import { notifyNewOrder, notifyOrderReceived } from "../_lib/notify.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    // Generous enough for a shared campus/office IP, tight enough to stop a flood.
    const gate = rateLimit({ key: `order:${clientKey(req)}`, limit: 20, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(
        429,
        "Too many order attempts. Please wait a moment and try again.",
        "rate_limited",
      );
    }

    const body = await readJson(req);
    const idempotencyKey = readIdempotencyKey(req);
    const store = await getStore();

    // (1) REPLAY FIRST, before anything expensive or anything that can refuse.
    //
    // Reading this before the delivery check is the difference between "your order
    // is safe" and "your order evaporated". A customer whose network dropped the
    // response retries with the same key; if we re-verified their address first
    // and the answer came back OUT_OF_RANGE — or the provider was briefly down —
    // we would tell a customer with a real, already-accepted order that we could
    // not take it. Their order exists. We return it.
    const replay = await store.findByIdempotencyKey(idempotencyKey);
    if (replay) {
      return sendJson(res, 200, {
        order: toPublicOrder(replay),
        payment: paymentViewFor(replay),
        created: false,
        // The secret travels once, on creation only. A replay gets the order back
        // but is never handed the token again — otherwise a captured replay
        // response would be a permanent, portable key to this order.
        accessToken: null,
        storage: storageInfo(store),
      });
    }

    // (2) Validate and price from the trusted menu.
    const record = buildOrderRecord(body);

    // (3) Verify the delivery address ourselves, and fail closed.
    const checked = await checkDelivery({
      address: record.address,
      landmark: record.landmark,
    });
    if (!checked.eligible) {
      throw deliveryRefusal(checked);
    }

    const verified = withDeliveryVerification(record, checked);

    // (4) Persist. The first thing that exists as a consequence of this request.
    const { order, created } = await store.createOrder(verified, idempotencyKey);

    if (created) {
      // A new order is the one thing worth interrupting an admin for. The audit
      // row is written quietly so a logging failure cannot lose the order; the
      // emails are awaited but are themselves incapable of failing the request.
      //
      // They are not fire-and-forget. An unawaited promise in a serverless
      // function is a promise the platform is free to abandon the instant it
      // responds — which on a fast Resend call is most of the time. Awaiting
      // keeps the work inside the invocation, and the notification layer is
      // already incapable of throwing, so this costs correctness nothing.
      await recordEventQuietly(store, order, orderCreatedEvent(order, { provider: record.paymentProvider }));
      await notifyNewOrder(store, order);
      await notifyOrderReceived(store, order);
    }

    // The access secret proves ownership on later lookups. It is returned once,
    // on creation, and the database only ever keeps its hash.
    return sendJson(res, created ? 201 : 200, {
      order: toPublicOrder(order),
      payment: paymentViewFor(order),
      created,
      accessToken: created ? record.accessToken : null,
      delivery: {
        outcome: checked.outcome,
        eligible: true,
        distanceMeters: checked.distanceMeters,
        radiusKm: checked.radiusKm,
        radiusMeters: checked.radiusMeters,
        message: checked.message,
      },
      storage: storageInfo(store),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

/**
 * Turn a refusal into a 422 the checkout can act on.
 *
 * 422, not 500: the request was understood and the answer is a considered no.
 * A 5xx would tell the customer (and any monitoring) that JOC had a fault, and
 * the retry button our own error copy would suggest is exactly the wrong advice
 * for "we do not deliver that far".
 */
function deliveryRefusal(checked) {
  // The customer sees the shared contract's sentence for this outcome and nothing
  // else. `reason` and `configError` stay server-side.
  return new ApiError(422, checked.message, "delivery_unavailable", {
    outcome: checked.outcome,
    distanceMeters: checked.distanceMeters,
    radiusKm: checked.radiusKm,
    radiusMeters: checked.radiusMeters,
  });
}

const storageInfo = (store) => ({
  driver: store.driver,
  durable: store.durable,
  notice: store.durable
    ? null
    : "Demo mode: this order is not being saved to a database.",
});
