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
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder, toAdminOrder } from "../_lib/store.js";
import { readIdempotencyKey, buildOrderRecord } from "../_lib/orderRequest.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { paymentViewFor } from "../_lib/payments.js";
import { orderCreatedEvent, recordEventQuietly } from "../_lib/orderEvents.js";
import { notifyNewOrder } from "../_lib/notify.js";

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
    const record = buildOrderRecord(body);

    const store = await getStore();
    const { order, created } = await store.createOrder(record, idempotencyKey);

    if (created) {
      // A new order is the one thing worth interrupting an admin for. The audit
      // row is written quietly so a logging failure cannot lose the order; the
      // email is awaited but is itself incapable of failing the request.
      await recordEventQuietly(store, order, orderCreatedEvent(order, { provider: record.paymentProvider }));
      void notifyNewOrder(toAdminOrder(order));
    }

    // The access secret proves ownership on later lookups. It is returned once,
    // on creation, and the database only ever keeps its hash. A replay of an
    // already-fulfilled request gets the order back but never the secret again.
    return sendJson(res, created ? 201 : 200, {
      order: toPublicOrder(order),
      payment: paymentViewFor(order),
      created,
      accessToken: created ? record.accessToken : null,
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
