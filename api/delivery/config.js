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

import { methodGuard, sendJson } from "../_lib/http.js";
import { deliveryConfig } from "../_lib/delivery.js";
import { DELIVERY_RULE_NOTE } from "../../shared/delivery.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  const config = deliveryConfig();
  return sendJson(res, 200, {
    radiusKm: config.radiusKm,
    radiusMeters: config.radiusMeters,
    configured: config.configured,
    rule: DELIVERY_RULE_NOTE,
  });
}
