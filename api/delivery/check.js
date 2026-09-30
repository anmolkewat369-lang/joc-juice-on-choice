/**
 * Both delivery questions the checkout asks, served from one function.
 *
 *   POST /api/delivery/check   can JOC deliver to this address?
 *   GET  /api/delivery/config  what is the rule, before any address is typed?
 *
 * They share a file because the Vercel Hobby plan caps a deployment at 12
 * functions. Neither lost its URL: vercel.json rewrites /api/delivery/config onto
 * this function, and `servesAlias` tells the two requests apart. The answers are
 * byte-for-byte what the two functions returned before.
 */

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

/**
 * GET /api/delivery/config — the delivery rule, without checking any address.
 *
 * The checkout needs to state the rule ("we deliver within N km by road") before
 * the customer has typed anything, and re-reading that from a bundle is how the
 * advertised radius drifts away from the enforced one. This returns the same
 * `normaliseDeliveryRadiusKm` value the gate itself uses, so the sentence on the
 * form and the sentence in the refusal come from one number.
 *
 * No key, no coordinates, no provider detail — only the radius. Whether the
 * provider is configured is exposed as a plain boolean: the customer needs to be
 * told when a check cannot run, and an operator needs to see it on the site, but
 * neither needs to know which secret is missing.
 */

import {
  ApiError,
  clientKey,
  methodGuard,
  readJson,
  sendError,
  sendJson,
  servesAlias,
} from "../_lib/http.js";
import { rateLimit, sweepRateLimits } from "../_lib/rateLimit.js";
import { checkDelivery, deliveryConfig, toPublicDeliveryCheck } from "../_lib/delivery.js";
import { DELIVERY_RULE_NOTE } from "../../shared/delivery.js";
import { LIMITS } from "../../shared/ordering.js";

/** A preview should be cheap, but each miss costs two Google calls. */
const RATE_LIMIT = { limit: 15, windowMs: 60_000 };

async function deliveryPreview(req, res) {
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

async function deliveryRule(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  const config = deliveryConfig();
  return sendJson(res, 200, {
    radiusKm: config.radiusKm,
    radiusMeters: config.radiusMeters,
    configured: config.configured,
    rule: DELIVERY_RULE_NOTE,
  });
}

export default async function handler(req, res) {
  // The rewritten /api/delivery/config is a read; the preview it was merged with
  // is a POST. Each half keeps its own method guard, so the merge cannot turn one
  // into an entry point for the other.
  if (servesAlias(req, { primary: "/api/delivery/check", alias: "/api/delivery/config" })) {
    return deliveryRule(req, res);
  }
  return deliveryPreview(req, res);
}
