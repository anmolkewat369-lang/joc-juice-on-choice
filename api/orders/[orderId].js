/**
 * GET /api/orders/:orderId — read one order.
 *
 * Order ids are sequential, so a guessable reference must not be enough to
 * reveal a customer's name, phone and address. The caller also has to present
 * the per-order secret issued at creation; the server compares it in constant
 * time against the stored hash. A wrong or missing secret returns 404, exactly
 * as an unknown order id does, so the endpoint cannot be used to probe.
 *
 * The token gate now lives in one place, _lib/orderToken.js, shared with the
 * payment routes — a second copy of this comparison is a second chance to get
 * it subtly wrong.
 *
 * Query-string tokens (`?token=`) are off by default. A URL ends up in browser
 * history, in `Referer` headers and in proxy logs, and an order URL is often
 * shared. Set JOC_ALLOW_TOKEN_QUERY=true only if a deep link genuinely needs it.
 */

import { ApiError, methodGuard, sendError, sendJson, clientKey } from "../_lib/http.js";
import { getStore, toPublicOrder } from "../_lib/store.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { requireOwnedOrder } from "../_lib/orderToken.js";
import { paymentViewFor } from "../_lib/payments.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `lookup:${clientKey(req)}`, limit: 30, windowMs: 60_000 });
    if (!gate.allowed) {
      throw new ApiError(429, "Too many requests. Please try again shortly.", "rate_limited");
    }

    const store = await getStore();
    const row = await requireOwnedOrder(req, store, { param: "orderId" });

    // The payment view is rebuilt on every read from the server's stored total,
    // so the confirmation screen always shows the amount the server priced —
    // including after the order has been switched to Cash on Delivery.
    return sendJson(res, 200, {
      order: toPublicOrder(row),
      payment: paymentViewFor(row),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
