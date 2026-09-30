/**
 * The delivery decision.
 *
 * This module is the only place in the codebase that answers "can JOC deliver to
 * this address?", and it answers it exactly one way:
 *
 *     geocode the address  ->  measure the DRIVING distance from the store  ->
 *     compare that distance against the radius in shared/delivery.js
 *
 * The radius comparison lives in shared/delivery.js so the customer-facing
 * wording, the checkout preview and this server-side gate can never disagree.
 * The measuring happens in api/_lib/googleMaps.js. Nothing here computes a
 * distance from coordinates, because a straight-line figure is not the rule.
 *
 * FAIL CLOSED. An address whose distance could not be established is reported as
 * not deliverable, never as deliverable. The failure modes are deliberately kept
 * distinct in the outcome — "we could not locate your address" and "we are too
 * far away" call for completely different customer behaviour — but they all end
 * in the same place: no order. An error that resolves to "allowed" would make the
 * delivery limit something a customer can switch off by making the provider
 * unreachable.
 */

import { createHash, randomBytes } from "node:crypto";

import {
  DELIVERY_OUTCOME,
  DELIVERABLE_OUTCOMES,
  DELIVERY_MESSAGES,
  isWithinDeliveryRadius,
  normaliseDeliveryRadiusKm,
  radiusMeters,
} from "../../shared/delivery.js";
import {
  GoogleMapsError,
  GOOGLE_MAPS_REASONS,
  drivingDistanceMeters,
  geocodeAddress,
  googleMapsConfigStatus,
  storeLocation,
} from "./googleMaps.js";

/* ------------------------------ configuration ---------------------------- */

/**
 * The configured radius, in km and in metres.
 *
 * Read per call rather than captured at import: a long-lived serverless
 * instance must pick up a corrected value without a redeploy, and a test must be
 * able to change it between cases.
 */
export const deliveryRadiusKm = () =>
  normaliseDeliveryRadiusKm(process.env.JOC_DELIVERY_RADIUS_KM);

export const deliveryRadiusMeters = () => radiusMeters(deliveryRadiusKm());

/**
 * Reported by GET /api/delivery/config so the client can tell the customer the
 * rule, and so an operator can confirm what production actually thinks it is.
 */
export function deliveryConfig() {
  const km = deliveryRadiusKm();
  return {
    radiusKm: km,
    radiusMeters: radiusMeters(km),
    configured: googleMapsConfigStatus().apiKey && storeLocation() !== null,
  };
}

/**
 * Configuration problems, described in the operator's language.
 *
 * This exists so "the site says delivery is unavailable" can be diagnosed in one
 * place. The customer never sees it — it is logged, and `configError` on the
 * result is server-side detail only.
 */
function configProblem() {
  const status = googleMapsConfigStatus();
  if (!status.apiKey && !status.storeLocation) return "GOOGLE_MAPS_API_KEY and the store coordinates are not set.";
  if (!status.apiKey) return "GOOGLE_MAPS_API_KEY is not set.";
  if (!status.storeLocation) return "JOC_STORE_LATITUDE / JOC_STORE_LONGITUDE are not set.";
  return null;
}

/* ---------------------------------- cache --------------------------------- */

/**
 * A short-lived cache in front of the two Google calls.
 *
 * It exists to stop the customer paying for the same measurement twice: checkout
 * previews the address, then the order re-verifies it, and both happen within a
 * minute of each other. It is deliberately tiny and per-instance — a cache
 * wide enough to be useful across regions would be a cache of customer addresses
 * on a disk, which is exactly the kind of copy of personal data nobody means to
 * create. Losing it on a cold start is correct, not a bug.
 *
 * Only DETERMINATE answers are cached. A timeout or a quota error is not an
 * answer about the address, and caching one would make a transient outage look
 * like a permanent refusal for as long as the entry lived.
 */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map();

/**
 * Per-process salt for cache keys.
 *
 * Random per instance on purpose: the cache never leaves the process, so the salt
 * has no need to be stable across instances, and a random one means a heap dump
 * from one instance cannot be used to confirm addresses typed against another.
 */
const CACHE_SALT = randomBytes(16);

/**
 * Cache key for an address + landmark pair.
 *
 * Hashed rather than used verbatim: the cache is process memory, but a raw key
 * would still mean every address anyone ever typed is sitting in a heap dump or a
 * crash report, and the comment above this cache claims otherwise. Salting also
 * stops a leaked digest from being reversed with a dictionary of flat numbers.
 */
const cacheKey = (address, landmark) =>
  createHash("sha256")
    .update(CACHE_SALT)
    .update("\u0000")
    .update(String(address ?? "").trim().toLowerCase())
    .update("\u0000")
    .update(String(landmark ?? "").trim().toLowerCase())
    .digest("hex");

function cacheRead(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  // Re-insert to make iteration order a recency order for the eviction below.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function cacheWrite(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test seam: a case must not inherit the previous case's measurement. */
export function clearDeliveryCache() {
  cache.clear();
}

/* ------------------------------ the results ------------------------------ */

/**
 * Build a result. `message` is the customer-facing sentence from the shared
 * contract, so the checkout preview, the order rejection and any later review
 * all show the same words for the same outcome.
 */
function result(outcome, { distanceMeters = null, reason = null, configError = null } = {}) {
  const km = deliveryRadiusKm();
  const meters = distanceMeters;
  const eligible = DELIVERABLE_OUTCOMES.has(outcome);

  let message;
  if (outcome === DELIVERY_OUTCOME.AVAILABLE || outcome === DELIVERY_OUTCOME.OUT_OF_RANGE) {
    const shown = `${(Math.round(meters) / 1000).toFixed(1)} km`;
    message =
      outcome === DELIVERY_OUTCOME.AVAILABLE
        ? DELIVERY_MESSAGES.available(shown)
        : DELIVERY_MESSAGES.outOfRange(shown, km);
  } else if (outcome === DELIVERY_OUTCOME.ADDRESS_NOT_FOUND) {
    message = DELIVERY_MESSAGES.addressNotFound;
  } else if (outcome === DELIVERY_OUTCOME.ADDRESS_AMBIGUOUS) {
    message = DELIVERY_MESSAGES.addressAmbiguous;
  } else {
    message = DELIVERY_MESSAGES.checkUnavailable;
  }

  return {
    outcome,
    eligible,
    distanceMeters: Number.isFinite(meters) ? Math.round(meters) : null,
    distanceKm: Number.isFinite(meters) ? Math.round(meters) / 1000 : null,
    radiusKm: km,
    radiusMeters: radiusMeters(km),
    message,
    /** Server-side only. Never serialise this to a browser response. */
    reason,
    configError,
  };
}

/** Map a provider failure onto the outcome a customer can act on. */
function outcomeForError(error) {
  if (!(error instanceof GoogleMapsError)) {
    return { outcome: DELIVERY_OUTCOME.CHECK_UNAVAILABLE, reason: "unexpected_error" };
  }
  switch (error.reason) {
    case GOOGLE_MAPS_REASONS.NOT_CONFIGURED:
      return { outcome: DELIVERY_OUTCOME.NOT_CONFIGURED, reason: error.reason };
    case GOOGLE_MAPS_REASONS.NOT_FOUND:
      return { outcome: DELIVERY_OUTCOME.ADDRESS_NOT_FOUND, reason: error.reason };
    case GOOGLE_MAPS_REASONS.AMBIGUOUS:
      return { outcome: DELIVERY_OUTCOME.ADDRESS_AMBIGUOUS, reason: error.reason };
    default:
      // Network, timeout, quota, denied, no_route, anything unrecognised. All of
      // these mean the same thing to a customer: we could not check right now.
      return { outcome: DELIVERY_OUTCOME.CHECK_UNAVAILABLE, reason: error.reason };
  }
}

/* ------------------------------- the check ------------------------------- */

/**
 * Verify that JOC can deliver to an address.
 *
 * Returns the same shape for every outcome, including the refusals, so no caller
 * has to handle a thrown error from the ordinary "we don't deliver there" case.
 * `eligible` is the answer; the order route refuses to create anything when it is
 * false, and re-runs this itself rather than trusting what the client was told.
 */
export async function checkDelivery({ address, landmark } = {}) {
  const missing = configProblem();
  if (missing) {
    // Fail closed, and say so in the log. A site with no maps key must not start
    // accepting orders it cannot verify.
    console.error("[joc-delivery] configuration incomplete:", missing);
    return result(DELIVERY_OUTCOME.NOT_CONFIGURED, {
      reason: GOOGLE_MAPS_REASONS.NOT_CONFIGURED,
      configError: missing,
    });
  }

  const origin = storeLocation();
  const key = cacheKey(address, landmark);
  const cached = cacheRead(key);
  if (cached) return cached;

  let value;
  try {
    const destination = await geocodeAddress({ address, landmark, origin });
    const distanceMeters = await drivingDistanceMeters(origin, destination);
    value = result(
      isWithinDeliveryRadius(distanceMeters, deliveryRadiusKm())
        ? DELIVERY_OUTCOME.AVAILABLE
        : DELIVERY_OUTCOME.OUT_OF_RANGE,
      { distanceMeters },
    );
  } catch (error) {
    const mapped = outcomeForError(error);
    if (mapped.outcome === DELIVERY_OUTCOME.CHECK_UNAVAILABLE) {
      console.error("[joc-delivery] provider failure:", error?.reason ?? error?.message);
    }
    value = result(mapped.outcome, { reason: mapped.reason });
  }

  if (
    value.outcome === DELIVERY_OUTCOME.AVAILABLE ||
    value.outcome === DELIVERY_OUTCOME.OUT_OF_RANGE ||
    value.outcome === DELIVERY_OUTCOME.ADDRESS_NOT_FOUND ||
    value.outcome === DELIVERY_OUTCOME.ADDRESS_AMBIGUOUS
  ) {
    cacheWrite(key, value);
  }

  return value;
}

/** The same check, minus the parts a browser must never see. */
export function toPublicDeliveryCheck(checked) {
  return {
    outcome: checked.outcome,
    eligible: checked.eligible,
    distanceMeters: checked.distanceMeters,
    distanceKm: checked.distanceKm,
    radiusKm: checked.radiusKm,
    radiusMeters: checked.radiusMeters,
    message: checked.message,
  };
}
