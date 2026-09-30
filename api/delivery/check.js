/**
 * POST /api/delivery/check — can JOC deliver to this address?
 *
 * The checkout preview only. It exists so the customer learns whether their
 * address is in range while they are still editing the form, instead of after
 * they have committed to an order.
 *
 * It is NOT a gate. Nothing here grants permission to order: POST /api/orders
 * re-runs the identical check itself, against the address in the request body,
 * before it creates anything. A caller cannot pass this endpoint a friendly
 * result and then post something else. The only trust this endpoint can grant is
 * "don't bother filling the form in".
 *
 * An out-of-area address is a valid, successful answer (200), not an error — the
 * request worked, the customer is simply too far away. A 4xx/5xx here means the
 * question could not be answered at all, and the UI treats that as "try again",
 * never as "that address is fine".
 */

import { ApiError, clientKey, methodGuard, readJson, sendError, sendJson } from "../_lib/http.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { checkDelivery, deliveryConfig, toPublicDeliveryCheck } from "../_lib/delivery.js";
import { LIMITS } from "../../shared/ordering.js";

/** A preview should be cheap, but each miss costs two Google calls. */
const RATE_LIMIT = { limit: 15, windowMs: 60_000 };

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  try {
    sweepRateLimits();
    const gate = rateLimit({ key: `delivery:${clientKey(req)}`, ...RATE_LIMIT });
    if (!gate.allowed) {
      throw new ApiError(
        429,
        "Too many checks. Please wait a moment and try again.",
        "rate_limited",
      );
    }

    const body = await readJson(req);
    const address = String(body?.address ?? "").trim();
    const landmark = String(body?.landmark ?? "").trim().slice(0, LIMITS.landmark);

    if (address.length < 8 || address.length > LIMITS.address) {
      throw new ApiError(
        400,
        "Please enter a more complete delivery address.",
        "invalid_address",
      );
    }

    const checked = await checkDelivery({ address, landmark });
    return sendJson(res, 200, {
      delivery: toPublicDeliveryCheck(checked),
      rule: { radiusKm: deliveryConfig().radiusKm },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
