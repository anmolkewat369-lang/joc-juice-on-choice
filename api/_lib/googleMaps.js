/**
 * Google Maps Platform client — SERVER ONLY.
 *
 * Two calls, both made from the server and neither ever reachable from a browser:
 *
 *   Geocoding API  turns the customer's typed address into coordinates.
 *   Routes API     turns the store -> customer pair into an actual DRIVING
 *                  distance in metres. This is the only distance that decides
 *                  whether JOC delivers.
 *
 * The key is read from GOOGLE_MAPS_API_KEY, a plain server environment variable.
 * It is never prefixed with VITE_, never placed in a `?key=` on a URL the browser
 * can see, and never returned by any API route. This module must only ever be
 * imported from `api/**`; it is server-side by construction, and `assertServerOnly`
 * below makes an accidental browser import loud rather than silent.
 *
 * Nothing here decides whether an order is deliverable — that is
 * api/_lib/delivery.js, which owns the radius. This module only answers two
 * factual questions: where is this address, and how far is it by road?
 */

import { LIMITS } from "../../shared/ordering.js";

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/**
 * Hard ceiling on a single Google call.
 *
 * The order route awaits this, so an unbounded request would leave a customer
 * staring at a spinner. On timeout we fail closed — the delivery restriction
 * cannot be verified, so the order is refused rather than accepted unverified.
 */
const REQUEST_TIMEOUT_MS = 8_000;

/** Rejected readings of the key, and why each is a problem. */
export const GOOGLE_MAPS_REASONS = {
  NOT_CONFIGURED: "not_configured",
  NETWORK: "network",
  TIMEOUT: "timeout",
  UNKNOWN_ERROR: "unknown_error",
  QUOTA: "quota",
  DENIED: "denied",
  INVALID_RESPONSE: "invalid_response",
  NOT_FOUND: "not_found",
  AMBIGUOUS: "ambiguous",
  NO_ROUTE: "no_route",
};

/** Provider-side failure. Never carries a key, a URL with a key, or raw PII. */
export class GoogleMapsError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "GoogleMapsError";
    this.reason = reason;
  }
}

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

export const googleMapsApiKey = () => env("GOOGLE_MAPS_API_KEY") || null;
export const isGoogleMapsConfigured = () => Boolean(googleMapsApiKey());

/** Loud in development, harmless in production. */
function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error(
      "api/_lib/googleMaps.js was imported in a browser context. The Maps key is a server secret.",
    );
  }
}

/* --------------------------------- config -------------------------------- */

/** A coordinate is only usable if it is a finite number inside the valid range. */
export function parseCoordinate(raw, limit) {
  const value = Number.parseFloat(String(raw ?? "").trim());
  if (!Number.isFinite(value)) return null;
  if (value < -limit || value > limit) return null;
  return value;
}

/** The fixed JOC origin, or null when it has not been configured. */
export function storeLocation() {
  const latitude = parseCoordinate(env("JOC_STORE_LATITUDE"), 90);
  const longitude = parseCoordinate(env("JOC_STORE_LONGITUDE"), 180);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

/**
 * The address the store coordinates are expected to be, kept beside them for
 * operator reference. It is documentation, not input: the coordinates are the
 * authority, and a mismatch is a configuration mistake rather than something to
 * silently resolve at runtime.
 */
export const STORE_ADDRESS_REFERENCE = {
  line1: "Plot No. 207",
  line2: "near Shri Ram Engineering College, Dixit Colony, Rajeev Gandhi Nagar",
  line3: "Marhatal, Jabalpur, Madhya Pradesh 482002",
  plusCode: "6W25+66 Jabalpur, Madhya Pradesh",
  full: [
    "Plot No. 207",
    "near Shri Ram Engineering College",
    "Dixit Colony, Rajeev Gandhi Nagar, Marhatal",
    "Jabalpur, Madhya Pradesh 482002",
  ].join(", "),
};

/** Configuration status, reported honestly rather than assumed. */
export function googleMapsConfigStatus() {
  return {
    apiKey: isGoogleMapsConfigured(),
    storeLocation: storeLocation() !== null,
  };
}

/* -------------------------------- transport ------------------------------ */

/**
 * A JSON request with a hard timeout, normalising every failure mode into a
 * GoogleMapsError. The key is only ever placed in a header (Routes) or a
 * server-side query string (Geocoding) that is never surfaced to a client.
 */
async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new GoogleMapsError(GOOGLE_MAPS_REASONS.TIMEOUT, "The maps service timed out.");
    }
    throw new GoogleMapsError(GOOGLE_MAPS_REASONS.NETWORK, "The maps service could not be reached.");
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new GoogleMapsError(
      GOOGLE_MAPS_REASONS.INVALID_RESPONSE,
      "The maps service returned an unreadable response.",
    );
  }

  if (!response.ok) {
    // Google returns the actionable detail in `error.message`; the key is never
    // part of it, but the payload is not logged verbatim regardless.
    const detail = String(payload?.error?.message ?? "").toLowerCase();
    const reason = /api project not authorized|forbidden|api key not valid|referer/.test(detail)
      ? GOOGLE_MAPS_REASONS.DENIED
      : /quota|rate limit|over.?daily|exceeded/.test(detail)
        ? GOOGLE_MAPS_REASONS.QUOTA
        : GOOGLE_MAPS_REASONS.UNKNOWN_ERROR;
    throw new GoogleMapsError(reason, "The maps service rejected the request.");
  }

  return payload;
}

/* -------------------------------- geocoding ------------------------------ */

/** Google's own preference order, most precise first. */
const LOCATION_TYPE_RANK = { ROOFTOP: 0, RANGE_INTERPOLATED: 1, GEOMETRIC_CENTER: 2 };

/**
 * The biasing box, in degrees, centred on the store.
 *
 * This is a RANKING bias, not a filter. A customer who types an address in
 * another city still gets that address back rather than a Jabalpur impostor, and
 * the road distance computed from it correctly rejects the order. Filtering with a
 * hard `bounds` instead would turn every out-of-area address into "we could not
 * locate this address", which is the wrong explanation and sends the customer
 * off rewriting an address that is perfectly clear.
 */
const BIAS_DEGREES = 0.4;

function biasRectangle(origin) {
  const pad = Math.min(
    BIAS_DEGREES,
    Math.max(0.02, Math.min(90 - Math.abs(origin.latitude), 180 - Math.abs(origin.longitude))),
  );
  return (
    `${(origin.latitude - pad).toFixed(6)},${(origin.longitude - pad).toFixed(6)}|` +
    `${(origin.latitude + pad).toFixed(6)},${(origin.longitude + pad).toFixed(6)}`
  );
}

/**
 * Turn a typed address into a point.
 *
 * Failure is reported, never guessed:
 *   * ZERO_RESULTS / no usable geometry -> NOT_FOUND, "enter a more complete
 *     address";
 *   * Google's own `partial_match` flag -> AMBIGUOUS, "we couldn't accurately
 *     locate this address". Google sets that flag precisely when it matched only
 *     part of what was typed, and an order placed against a guess is an order
 *     that cannot be delivered. Neither outcome is ever treated as "close
 *     enough" — an address we could not place is refused, not waved through.
 *
 * The landmark is appended to the query rather than geocoded separately, because
 * it is context for the same place, not a second place.
 */
export async function geocodeAddress({ address, landmark, origin }) {
  assertServerOnly();
  const key = googleMapsApiKey();
  if (!key) {
    throw new GoogleMapsError(
      GOOGLE_MAPS_REASONS.NOT_CONFIGURED,
      "GOOGLE_MAPS_API_KEY is not set.",
    );
  }

  const text = String(address ?? "").trim();
  if (text.length < 8 || text.length > LIMITS.address) {
    throw new GoogleMapsError(GOOGLE_MAPS_REASONS.NOT_FOUND, "The address is too short or too long.");
  }
  const extra = String(landmark ?? "").trim().slice(0, LIMITS.landmark);
  const query = extra ? `${text}, ${extra}` : text;

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", query);
  url.searchParams.set("region", "in");
  url.searchParams.set("components", "country:IN");
  url.searchParams.set("key", key);
  if (origin) url.searchParams.set("location_bias", `rectangle:${biasRectangle(origin)}`);

  const payload = await requestJson(url);

  const status = String(payload.status ?? "");
  if (status !== "OK") {
    if (status === "ZERO_RESULTS") {
      throw new GoogleMapsError(GOOGLE_MAPS_REASONS.NOT_FOUND, "No match for this address.");
    }
    if (status === "OVER_QUERY_LIMIT") {
      throw new GoogleMapsError(GOOGLE_MAPS_REASONS.QUOTA, "The geocoding quota is exhausted.");
    }
    if (status === "REQUEST_DENIED") {
      throw new GoogleMapsError(GOOGLE_MAPS_REASONS.DENIED, "The geocoding request was denied.");
    }
    throw new GoogleMapsError(
      GOOGLE_MAPS_REASONS.UNKNOWN_ERROR,
      `The geocoding service returned ${status || "an unknown status"}.`,
    );
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  const usable = results
    .map((result) => ({
      partialMatch: result.partial_match === true,
      locationType: String(result.geometry?.location_type ?? "GEOMETRIC_CENTER"),
      latitude: Number(result.geometry?.location?.lat),
      longitude: Number(result.geometry?.location?.lng),
      formattedAddress: String(result.formatted_address ?? ""),
    }))
    .filter(
      (candidate) =>
        Number.isFinite(candidate.latitude) &&
        Number.isFinite(candidate.longitude) &&
        Math.abs(candidate.latitude) <= 90 &&
        Math.abs(candidate.longitude) <= 180,
    )
    .sort(
      (a, b) =>
        (LOCATION_TYPE_RANK[a.locationType] ?? 9) - (LOCATION_TYPE_RANK[b.locationType] ?? 9),
    );

  const best = usable[0];
  if (!best) {
    throw new GoogleMapsError(
      GOOGLE_MAPS_REASONS.NOT_FOUND,
      "The address matched nothing with a usable location.",
    );
  }
  if (best.partialMatch) {
    throw new GoogleMapsError(
      GOOGLE_MAPS_REASONS.AMBIGUOUS,
      "Google matched only part of the address.",
    );
  }

  return {
    latitude: best.latitude,
    longitude: best.longitude,
    locationType: best.locationType,
    formattedAddress: best.formattedAddress,
  };
}

/* ---------------------------------- routes ------------------------------- */

/**
 * The actual driving distance, in metres, from `origin` to `destination`.
 *
 * `TRAFFIC_UNAWARE` is chosen deliberately. The delivery rule is about the road
 * distance to a place, not about the traffic on it right now, and the canonical
 * road distance is both stable (the same address always measures the same, so an
 * admin can reason about a borderline order) and cheaper to compute. A
 * traffic-aware route would move the number with the time of day and could
 * reject a customer whose address sits right on the boundary.
 *
 * The response is read with an explicit field mask, so a future Google default
 * change cannot quietly alter the payload this reads.
 */
export async function drivingDistanceMeters(origin, destination) {
  assertServerOnly();
  const key = googleMapsApiKey();
  if (!key) {
    throw new GoogleMapsError(
      GOOGLE_MAPS_REASONS.NOT_CONFIGURED,
      "GOOGLE_MAPS_API_KEY is not set.",
    );
  }

  const payload = await requestJson(ROUTES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.status",
    },
    body: {
      origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
      destination: {
        location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } },
      },
      travelMode: "DRIVE",
      // The rule is a road distance, not a live ETA. See the note above.
      routingPreference: "TRAFFIC_UNAWARE",
      units: "METRIC",
      languageCode: "en",
    },
  });

  const route = Array.isArray(payload.routes) ? payload.routes[0] : null;
  const meters = Number(route?.distanceMeters);
  if (!Number.isFinite(meters) || meters < 0) {
    // `routingError` is Google's own explanation; it is logged, not returned.
    const detail = String(payload?.routingError?.message ?? "no route");
    throw new GoogleMapsError(GOOGLE_MAPS_REASONS.NO_ROUTE, `No drivable route (${detail}).`);
  }

  return Math.round(meters);
}
