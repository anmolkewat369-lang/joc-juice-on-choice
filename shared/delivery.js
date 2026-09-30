/**
 * Shared delivery contract.
 *
 * JOC delivers only within a fixed DRIVING (road) distance of the store. That is
 * not a straight-line radius, so nothing in this file or in the API may be used
 * as the delivery decision by measuring latitude/longitude directly. The decision
 * is always the road distance returned by the Google Routes API
 * (api/_lib/googleMaps.js), compared here against a radius in metres.
 *
 * Imported by BOTH the React frontend and the Vercel serverless functions, so the
 * wording a customer reads and the wording the server enforces are the same
 * strings, and so both agree on how a distance is displayed and rounded.
 *
 * There is deliberately no great-circle / Haversine helper here. A distance
 * computed from two coordinates is a lower bound, not the road distance, and
 * shipping one next to the real rule is how a straight-line radius silently
 * becomes the delivery rule.
 */

/** Used when JOC_DELIVERY_RADIUS_KM is unset. The current JOC business rule. */
export const DELIVERY_RADIUS_FALLBACK_KM = 4;

/** Guard rails on the configured radius, so a typo cannot open or close the area. */
export const DELIVERY_RADIUS_MIN_KM = 0.5;
export const DELIVERY_RADIUS_MAX_KM = 50;

/**
 * The measured outcomes of a delivery check.
 *
 * OUT_OF_RANGE is a determinate answer and is *not* an error. CHECK_UNAVAILABLE
 * and NOT_CONFIGURED mean the answer is unknown, and an unknown answer is never
 * treated as "inside the area" — that would make the restriction bypassable by
 * simply making the provider unreachable.
 */
export const DELIVERY_OUTCOME = {
  AVAILABLE: "AVAILABLE",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  ADDRESS_NOT_FOUND: "ADDRESS_NOT_FOUND",
  ADDRESS_AMBIGUOUS: "ADDRESS_AMBIGUOUS",
  CHECK_UNAVAILABLE: "CHECK_UNAVAILABLE",
  NOT_CONFIGURED: "NOT_CONFIGURED",
};

/** Outcomes that permit an order to exist. Everything else blocks it. */
export const DELIVERABLE_OUTCOMES = new Set([DELIVERY_OUTCOME.AVAILABLE]);

/**
 * The exact customer-facing sentences.
 *
 * `km` is already formatted by the caller, so the frontend and the server cannot
 * render the same number two different ways. Only `outOfRange` needs the radius —
 * inside the area, the rule is redundant with the distance the
 * customer was just shown.
 */
export const DELIVERY_MESSAGES = {
  available: (km) =>
    `Delivery available. Your address is about ${km} from JOC by road.`,
  outOfRange: (km, radiusKm) =>
    `Delivery unavailable. Your address is about ${km} from JOC by road. ` +
    `JOC currently delivers only within ${radiusKm} km of the store.`,
  addressNotFound:
    "We couldn't locate this address. Please enter a more complete address or add a nearby landmark.",
  addressAmbiguous:
    "We couldn't accurately locate this address. Please enter a more complete address or add a nearby landmark.",
  checkUnavailable:
    "We couldn't verify delivery availability right now. Please try again in a moment.",
  notConfigured:
    "We couldn't verify delivery availability right now. Please try again in a moment.",
};

/** One line above the address fields, so the rule is stated before it is tested. */
export const DELIVERY_RULE_NOTE = (radiusKm = DELIVERY_RADIUS_FALLBACK_KM) =>
  `JOC currently delivers within ${radiusKm} km driving distance of the store. We check the actual road distance to your address before you order.`;

/** The delivery-area rule as the admin sees it on an order. */
export const DELIVERY_RULE_LABEL = (radiusKm) => `Within ${radiusKm} km by road`;

/* ------------------------------- The rule -------------------------------- */

/**
 * The configured radius, clamped to a sane range.
 *
 * Values arrive from an environment variable that an operator types by hand, so
 * "4 km", "4km" and " 4 " all have to work and "0" or "-3" must not silently
 * become a rule that rejects every order or a rule that accepts everywhere.
 */
export function normaliseDeliveryRadiusKm(raw) {
  const value = Number.parseFloat(String(raw ?? "").trim());
  if (!Number.isFinite(value)) return DELIVERY_RADIUS_FALLBACK_KM;
  if (value < DELIVERY_RADIUS_MIN_KM) return DELIVERY_RADIUS_MIN_KM;
  if (value > DELIVERY_RADIUS_MAX_KM) return DELIVERY_RADIUS_MAX_KM;
  return value;
}

/**
 * The radius in METRES — the unit the whole comparison happens in.
 *
 * Metres rather than kilometres because the Routes API returns metres, and
 * converting twice (metres -> km -> metres) is how a 4000 m boundary ends up
 * being compared as 4999.9997 and rejects a customer standing exactly on it.
 */
export const radiusMeters = (radiusKm) =>
  Math.round(normaliseDeliveryRadiusKm(radiusKm) * 1000);

/**
 * The single delivery decision.
 *
 * `distanceMeters` is the road distance. `<=` is inclusive on purpose: an
 * address exactly at the limit is deliverable.
 *
 * Anything that is not a real measurement is refused. `Number(null)`,
 * `Number("")` and `Number([])` are all `0`, which would quietly make a missing
 * distance the *closest possible* address and approve the order — so the
 * emptiness is rejected before any arithmetic happens. "Unknown" must never read
 * as "close enough".
 */
export function isWithinDeliveryRadius(distanceMeters, radiusKm) {
  if (distanceMeters === null || distanceMeters === undefined || distanceMeters === "") return false;
  const meters = Math.round(Number(distanceMeters));
  if (!Number.isFinite(meters) || meters < 0) return false;
  return meters <= radiusMeters(radiusKm);
}

/* ----------------------------- Presentation ------------------------------ */

/**
 * One decimal place, which is the precision a customer can act on.
 *
 * An absent distance renders as a dash and never as `0.0 km`: a missing
 * measurement and a measurement of zero are completely different facts, and
 * showing the second one would be a lie about the delivery.
 */
export function formatDistanceKm(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined || distanceMeters === "") return "—";
  const meters = Number(distanceMeters);
  if (!Number.isFinite(meters) || meters < 0) return "—";
  return `${(meters / 1000).toFixed(1)} km`;
}

/** How the admin dashboard labels a stored, already-verified distance. */
export function deliveryStatusLabel(order) {
  const delivery = order?.delivery ?? {};
  if (delivery.distanceMeters == null) return "Not verified";
  if (delivery.eligible === false) return "Outside delivery area";
  return "Eligible";
}
