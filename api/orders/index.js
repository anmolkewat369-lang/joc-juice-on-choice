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
 *   1. replay check — has this idempotency key already created an order?
 *   2. validate     — shared contract: area, address, confirmation, server-priced
 *   3. persist      — only now does an order, an ID, or a payment view exist
 *
 * Step 1 is what stops a retry from becoming a second order, and — more important —
 * stops a customer's already-placed order from being retracted because their address
 * has since drifted out of range. Step 2 is where the delivery rules live: the
 * customer's chosen area is checked against the configured list and their explicit
 * confirmation is required. Nothing is measured, located or geocoded here.
 *
 * There is no longer an outbound provider call in this handler. A placed order
 * arrives as RECEIVED and waits for JOC to confirm delivery availability, which is
 * what the admin Confirm action does.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import { readIdempotencyKey, buildOrderRecord } from "../_lib/orderRequest.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { paymentViewFor } from "../_lib/payments.js";
import { orderCreatedEvent, recordEventQuietly } from "../_lib/orderEvents.js";
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

    // (1) REPLAY FIRST, before anything that can refuse the request.
    //
    // Reading this first is the difference between "your order is safe" and "your
    // order evaporated". A customer whose network dropped the response retries with
    // the same key; if we re-validated their address first and something had since
    // changed — they corrected a typo, or the area list was edited — we would tell a
    // customer with a real, already-accepted order that we could not take it. Their
    // order exists. We return it.
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
    //
    // This is where the delivery rules are enforced. The area is checked against
    // the configured list and the explicit confirmation is required, so a payload
    // that skips either never reaches persistence. Everything the record carries
    // about delivery comes from here, already checked.
    const record = buildOrderRecord(body);

    // (3) Persist. The first thing that exists as a consequence of this request.
    const { order, created } = await store.createOrder(record, idempotencyKey);

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
      // Echoes what was accepted, and nothing more. No distance is known and no
      // availability is claimed: the area was the customer's choice and the
      // confirmation was their statement. JOC confirms the address before
      // preparing the order.
      delivery: {
        area: record.deliveryArea,
        areaName: record.deliveryAreaName,
        areaConfirmed: record.deliveryAreaConfirmed,
      },
      storage: storageInfo(store),
    });
  } catch (error) {
    return sendError(res, error);
  }
}

const storageInfo = (store) => ({
  driver: store.driver,
  durable: store.durable,
  notice: store.durable
    ? null
    : "Demo mode: this order is not being saved to a database.",
});
