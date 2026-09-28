/**
 * POST /api/orders — create an order (Cash on Delivery or Pay Now).
 *
 * Guest checkout: no account, no session, just an Idempotency-Key so a
 * double-clicked button, a refresh or a network retry cannot create two orders.
 */

import { ApiError, methodGuard, readJson, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import { readIdempotencyKey, buildOrderRecord } from "../_lib/orderRequest.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `order:${clientKey(req)}`, limit: 12, windowMs: 60_000 });
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

    // The access secret proves ownership on later lookups. It is returned once,
    // on creation, and the database only ever keeps its hash. A replay of an
    // already-fulfilled request gets the order back but never the secret again.
    return sendJson(res, created ? 201 : 200, {
      order: toPublicOrder(order),
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
