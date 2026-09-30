/**
 * Delivery-rule checks.
 *
 * The delivery limit is the one rule in JOC that a customer can argue with, and
 * the one that must not be approximated: it is decided by the DRIVING distance
 * Google returns, compared against a radius in whole metres, and it fails closed
 * whenever the answer is unknown.
 *
 * Every case here stubs `fetch` rather than the module that calls it, so the code
 * under test is the real `checkDelivery` — the request it builds, the fields it
 * reads, the integer comparison it applies. Only the network is replaced, and
 * non-Google URLs are passed through untouched.
 */

import assert from "node:assert/strict";

import { checkDelivery, clearDeliveryCache, deliveryConfig } from "../api/_lib/delivery.js";
import {
  DELIVERY_OUTCOME,
  DELIVERY_RADIUS_FALLBACK_KM,
  DELIVERY_RADIUS_MAX_KM,
  DELIVERY_RADIUS_MIN_KM,
  formatDistanceKm,
  isWithinDeliveryRadius,
  normaliseDeliveryRadiusKm,
  radiusMeters,
} from "../shared/delivery.js";
import { _resetStoreCache, getStore } from "../api/_lib/store.js";
import { PAYMENT_METHOD } from "../shared/ordering.js";

process.env.JOC_ALLOW_MEMORY_STORE = "true";
delete process.env.DATABASE_URL;
process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
process.env.JOC_STORE_LATITUDE = "23.1815";
process.env.JOC_STORE_LONGITUDE = "79.9864";

/* ------------------------------ provider stub ------------------------------ */

const maps = {
  distanceMeters: 3200,
  geocodeStatus: "OK",
  geocodeResults: null,
  routesResponse: null,
  httpStatus: 200,
  calls: [],
};

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url ?? input);
  const isGeocode = url.includes("/maps/api/geocode/json");
  const isRoute = url.includes("routes.googleapis.com");
  if (!isGeocode && !isRoute) return realFetch(input, init);

  maps.calls.push({ url, init });

  const payload = isGeocode
    ? maps.geocodeStatus === "OK"
      ? {
          status: "OK",
          results:
            maps.geocodeResults ?? [
              {
                formatted_address: "Civil Lines, Jabalpur, Madhya Pradesh",
                geometry: { location: { lat: 23.1905, lng: 79.9855 } },
              },
            ],
        }
      : { status: maps.geocodeStatus }
    : maps.routesResponse ?? {
        routes: [{ distanceMeters: maps.distanceMeters, duration: "600s", status: "OK" }],
      };

  return {
    ok: maps.httpStatus >= 200 && maps.httpStatus < 300,
    status: maps.httpStatus,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
};

const ADDRESS = "Civil Lines, Jabalpur";

/** Run `fn` against a specific provider answer, then put the stub back. */
const withMaps = (over, fn) => async () => {
  const before = { ...maps };
  Object.assign(maps, { distanceMeters: 3200, geocodeStatus: "OK", routesResponse: null, httpStatus: 200 }, over);
  // The cache is keyed by address, so a case that changes the provider answer
  // would otherwise be served the previous case's cached result.
  clearDeliveryCache();
  try {
    return await fn();
  } finally {
    Object.assign(maps, before);
    clearDeliveryCache();
  }
};

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/* -------------------------------- the rule --------------------------------- */

check("the radius comparison is inclusive and works in whole metres", () => {
  assert.equal(radiusMeters(4), 4000, "km to metres must not accumulate float error");
  assert.equal(isWithinDeliveryRadius(3999, 4), true);
  assert.equal(isWithinDeliveryRadius(4000, 4), true, "exactly on the limit is inside");
  assert.equal(isWithinDeliveryRadius(4001, 4), false);
  // The rounding is in whole metres on purpose, so a boundary address cannot be
  // rejected by a fraction of a metre of floating-point noise.
  assert.equal(isWithinDeliveryRadius(4999.6, 5), true);
});

check("an unknown or nonsensical distance is never 'inside the radius'", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, null, undefined, "abc"]) {
    assert.equal(
      isWithinDeliveryRadius(bad, 4),
      false,
      `${String(bad)} must not pass the delivery rule`,
    );
  }
});

check("a mistyped radius is clamped rather than obeyed", () => {
  assert.equal(normaliseDeliveryRadiusKm(undefined), DELIVERY_RADIUS_FALLBACK_KM);
  assert.equal(normaliseDeliveryRadiusKm(""), DELIVERY_RADIUS_FALLBACK_KM);
  assert.equal(normaliseDeliveryRadiusKm("not a number"), DELIVERY_RADIUS_FALLBACK_KM);
  assert.equal(normaliseDeliveryRadiusKm("0"), DELIVERY_RADIUS_MIN_KM, "0 must not mean 'nowhere'");
  assert.equal(normaliseDeliveryRadiusKm("-3"), DELIVERY_RADIUS_MIN_KM);
  assert.equal(normaliseDeliveryRadiusKm("9999"), DELIVERY_RADIUS_MAX_KM);
  // Operator-typed values arrive with units and spaces attached.
  assert.equal(normaliseDeliveryRadiusKm(" 5 "), 5);
  assert.equal(normaliseDeliveryRadiusKm("7.5km"), 7.5);
});

check("distance is rendered to one decimal place, and nothing else", () => {
  assert.equal(formatDistanceKm(4210), "4.2 km");
  assert.equal(formatDistanceKm(0), "0.0 km");
  assert.equal(formatDistanceKm(4567), "4.6 km");
  assert.equal(formatDistanceKm(Number.NaN), "—", "an absent distance must not read as zero");
  assert.equal(formatDistanceKm(null), "—");
});

check("Geocoding and Routes use their documented server-side API-key auth", withMaps({}, async () => {
  const firstCall = maps.calls.length;
  const checked = await checkDelivery({ address: ADDRESS });
  assert.equal(checked.eligible, true);

  const calls = maps.calls.slice(firstCall);
  const geocodeCall = calls.find((call) => call.url.includes("/maps/api/geocode/json"));
  const routeCall = calls.find((call) => call.url.includes("routes.googleapis.com"));
  assert.ok(geocodeCall, "Geocoding must be called");
  assert.ok(routeCall, "Routes must be called");
  assert.equal(new URL(geocodeCall.url).searchParams.get("key"), process.env.GOOGLE_MAPS_API_KEY);
  assert.equal(geocodeCall.init.headers?.["X-Goog-Api-Key"], undefined);
  assert.equal(routeCall.init.headers?.["X-Goog-Api-Key"], process.env.GOOGLE_MAPS_API_KEY);
}));

/* ------------------------------- the outcome ------------------------------- */

check(
  "an address inside the radius is available, with the road distance shown",
  withMaps({ distanceMeters: 3200 }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.outcome, DELIVERY_OUTCOME.AVAILABLE);
    assert.equal(checked.eligible, true);
    assert.equal(checked.distanceMeters, 3200);
    assert.equal(checked.radiusMeters, 4000);
    assert.match(checked.message, /3\.2 km/, "the customer is told how far, not just 'yes'");
  }),
);

check(
  "an address exactly on the 4 km boundary is deliverable",
  withMaps({ distanceMeters: 4000 }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.eligible, true, "the limit is inclusive");
    assert.equal(checked.distanceMeters, 4000);
  }),
);

check(
  "one metre beyond the boundary is refused, and the message names the limit",
  withMaps({ distanceMeters: 4001 }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.outcome, DELIVERY_OUTCOME.OUT_OF_RANGE);
    assert.equal(checked.eligible, false);
    assert.match(checked.message, /4 km/, "the customer needs the number to argue with");
  }),
);

check(
  "a fractional distance returned by the API is compared in whole metres",
  withMaps({ distanceMeters: 3999.7 }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.eligible, true, "3999.7 m rounds to 4000 m, which is inside");
    assert.equal(checked.distanceMeters, 4000, "the stored distance is a whole metre count");
  }),
);

check(
  "an address Google cannot locate is refused, and is distinguishable from being too far",
  withMaps({ geocodeStatus: "ZERO_RESULTS" }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.outcome, DELIVERY_OUTCOME.ADDRESS_NOT_FOUND);
    assert.equal(checked.eligible, false);
    assert.equal(checked.distanceMeters, null, "no distance is invented when there is none");
    assert.match(checked.message, /more complete address/i, "the customer is told how to fix it");
  }),
);

check(
  "an address Google only partially matches is refused",
  withMaps({
    geocodeResults: [
      {
        partial_match: true,
        formatted_address: "Madan Mahal, Jabalpur, Madhya Pradesh",
        geometry: { location: { lat: 23.18, lng: 79.99 } },
      },
    ],
  }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.outcome, DELIVERY_OUTCOME.ADDRESS_AMBIGUOUS);
    assert.equal(checked.eligible, false, "a guess about the address is not good enough to deliver");
  }),
);

check(
  "a provider failure fails CLOSED: unreachable maps must not mean 'deliverable'",
  withMaps({ routesResponse: { error: { message: "backend error" } } }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.outcome, DELIVERY_OUTCOME.CHECK_UNAVAILABLE);
    assert.equal(checked.eligible, false, "an unknown answer is not a permissive answer");
    assert.equal(checked.distanceMeters, null);
  }),
);

check(
  "a provider that cannot route at all is refused rather than assumed reachable",
  withMaps({ routesResponse: { routes: [] } }, async () => {
    const checked = await checkDelivery({ address: ADDRESS });
    assert.equal(checked.eligible, false);
    assert.equal(checked.outcome, DELIVERY_OUTCOME.CHECK_UNAVAILABLE);
  }),
);

check(
  "an unconfigured deployment refuses every order instead of accepting everything",
  async () => {
    const before = {
      key: process.env.GOOGLE_MAPS_API_KEY,
      lat: process.env.JOC_STORE_LATITUDE,
      lon: process.env.JOC_STORE_LONGITUDE,
    };
    clearDeliveryCache();
    try {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const checked = await checkDelivery({ address: ADDRESS });
      assert.equal(checked.outcome, DELIVERY_OUTCOME.NOT_CONFIGURED);
      assert.equal(checked.eligible, false, "a missing key must not open the delivery area");
      assert.ok(checked.configError, "an operator needs to know which variable is missing");

      process.env.GOOGLE_MAPS_API_KEY = before.key;
      delete process.env.JOC_STORE_LATITUDE;
      const missingCoords = await checkDelivery({ address: ADDRESS });
      assert.equal(missingCoords.eligible, false);
      assert.match(missingCoords.configError, /LATITUDE|LONGITUDE/);
    } finally {
      process.env.GOOGLE_MAPS_API_KEY = before.key;
      process.env.JOC_STORE_LATITUDE = before.lat;
      process.env.JOC_STORE_LONGITUDE = before.lon;
      clearDeliveryCache();
    }
  },
);

check("a determined answer is cached, an unknown one is not", withMaps({ distanceMeters: 3200 }, async () => {
  const first = await checkDelivery({ address: ADDRESS });
  const callsAfterFirst = maps.calls.length;
  const second = await checkDelivery({ address: ADDRESS });
  assert.equal(second.distanceMeters, first.distanceMeters);
  assert.equal(maps.calls.length, callsAfterFirst, "a repeat of the same address costs nothing");

  // The cache is keyed on the address, so a different one must still be measured.
  await checkDelivery({ address: "Rani Durgavati Vishwavidyalaya, Jabalpur" });
  assert.ok(maps.calls.length > callsAfterFirst, "a new address is not served a cached answer");
}));

check("the cache never stores the address itself", withMaps({ distanceMeters: 3200 }, async () => {
  await checkDelivery({ address: ADDRESS, landmark: "Near the petrol pump" });
  // The key is internal, so the observable claim is narrower and still true: the
  // cached answer carries no address text.
  const checked = await checkDelivery({ address: ADDRESS, landmark: "Near the petrol pump" });
  assert.ok(
    !JSON.stringify(checked).toLowerCase().includes("petrol"),
    "a cached answer must not carry personal data",
  );
}));

/* ------------------------- the order route gate ---------------------------- */

const callRoute = async (
  modulePath,
  { method = "POST", headers = {}, body = {}, query = {}, url } = {},
) => {
  const { default: handler } = await import(modulePath);
  const req = {
    method,
    headers: { "content-type": "application/json", ...headers },
    query,
    body: JSON.stringify(body),
    on: () => {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  // /api/delivery/config and /api/delivery/check share one handler now, and the
  // path is how it tells them apart, so a check can call the URL a browser would.
  if (url) req.url = url;
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler(req, res);
  return res;
};

const checkoutBody = (over = {}) => ({
  name: "Asha Rao",
  phone: "9876543210",
  email: "refused-order@example.com",
  address: ADDRESS,
  landmark: "Near the petrol pump",
  items: [{ id: "paneer-momos", qty: 2 }],
  paymentMethod: PAYMENT_METHOD.COD,
  ...over,
});

const placeOrder = (body, key) =>
  callRoute("../api/orders/index.js", {
    method: "POST",
    headers: { "idempotency-key": key },
    body,
  });

check(
  "an order in range is created and stores the distance the server measured",
  withMaps({ distanceMeters: 3200 }, async () => {
    const res = await placeOrder(checkoutBody(), "delivery-in-range-1");
    assert.equal(res.statusCode, 201, JSON.stringify(res.payload));
    assert.equal(res.payload.order.delivery.eligible, true);
    assert.equal(res.payload.order.delivery.verified, true);
    assert.equal(res.payload.order.delivery.distanceMeters, 3200);
    assert.equal(res.payload.order.delivery.outcome, DELIVERY_OUTCOME.AVAILABLE);
    assert.ok(res.payload.order.delivery.checkedAt, "the check is dated");
  }),
);

check(
  "an out-of-range order is refused with 422 and creates nothing",
  withMaps({ distanceMeters: 7200 }, async () => {
    const res = await placeOrder(checkoutBody(), "delivery-out-of-range-1");
    assert.equal(res.statusCode, 422, JSON.stringify(res.payload));
    // One code for "we will not create this", with the specific outcome in the
    // details, so the UI has one branch and the message still differs.
    assert.equal(res.payload.error.code, "delivery_unavailable");
    assert.equal(res.payload.error.details?.outcome, DELIVERY_OUTCOME.OUT_OF_RANGE);
    assert.match(res.payload.error.message, /4 km/);

    const store = await getStore();
    const listed = await store.listOrders({ limit: 100, offset: 0 });
    assert.equal(
      listed.rows.some((row) => row.customer_email === "refused-order@example.com"),
      false,
      "a refused order must leave no trace",
    );
  }),
);

check(
  "the customer cannot post a delivery verdict of their own",
  withMaps({ distanceMeters: 3200 }, async () => {
    const res = await placeOrder(
      checkoutBody({
        delivery: { eligible: true, distanceMeters: 10, outcome: DELIVERY_OUTCOME.AVAILABLE },
        deliveryEligible: true,
      }),
      "delivery-tamper-1",
    );
    assert.equal(res.statusCode, 201);
    assert.equal(
      res.payload.order.delivery.distanceMeters,
      3200,
      "the stored distance is the one the provider returned, not the client's",
    );
  }),
);

check(
  "an order is refused when the maps provider is broken, even though checkout passed",
  withMaps({ routesResponse: { error: { message: "backend error" } } }, async () => {
    const res = await placeOrder(checkoutBody(), "delivery-provider-down-1");
    assert.equal(res.statusCode, 422, JSON.stringify(res.payload));
    assert.equal(res.payload.error.code, "delivery_unavailable");
    assert.equal(
      res.payload.error.details?.outcome,
      DELIVERY_OUTCOME.CHECK_UNAVAILABLE,
      "a provider failure is recorded as a provider failure, not as 'too far'",
    );
    assert.equal(
      res.payload.error.details?.reason,
      undefined,
      "the provider's internal reason is not echoed back to the browser",
    );
  }),
);

check(
  "an idempotent replay is answered from the stored order without re-measuring",
  withMaps({ distanceMeters: 3200 }, async () => {
    const key = "delivery-replay-1";
    const first = await placeOrder(checkoutBody(), key);
    assert.equal(first.statusCode, 201);
    assert.ok(first.payload.accessToken, "the token is handed over once, at creation");

    const callsBefore = maps.calls.length;
    const replay = await placeOrder(checkoutBody(), key);
    assert.equal(replay.statusCode, 200, "a replay is not a second order");
    assert.equal(replay.payload.order.orderId, first.payload.order.orderId);
    assert.equal(replay.payload.accessToken, null, "the token is never handed over twice");
    assert.equal(maps.calls.length, callsBefore, "a replay must not spend a Google request");
  }),
);

check("the delivery preview never leaks server-only diagnostics", async () => {
  const res = await callRoute("../api/delivery/check.js", {
    method: "POST",
    body: { address: ADDRESS, landmark: "Near the petrol pump" },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  const { delivery } = res.payload;
  assert.equal(typeof delivery.message, "string");
  assert.equal(delivery.reason, undefined, "the provider's failure reason stays on the server");
  assert.equal(delivery.configError, undefined);
});

check("the preview refuses an address too short to geocode", async () => {
  const res = await callRoute("../api/delivery/check.js", {
    method: "POST",
    body: { address: "12" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "invalid_address");
});

check("GET /api/delivery/config answers from the check handler, rule only", async () => {
  const res = await callRoute("../api/delivery/check.js", {
    method: "GET",
    url: "/api/delivery/config",
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
  // The shape src/lib/api.js reads: radiusKm, radiusMeters, configured, rule.
  assert.deepEqual(Object.keys(res.payload).sort(), [
    "configured",
    "radiusKm",
    "radiusMeters",
    "rule",
  ]);
  assert.equal(res.payload.radiusKm, deliveryConfig().radiusKm);
  assert.equal(res.payload.radiusMeters, radiusMeters(res.payload.radiusKm));

  // No key, no store coordinates, no provider detail.
  const body = JSON.stringify(res.payload);
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue;
    if (!/(KEY|SECRET|TOKEN|PASSWORD|LATITUDE|LONGITUDE)/.test(name)) continue;
    assert.equal(body.includes(value), false, `${name} leaked into the config response`);
  }
  assert.equal(body.includes("23.1815"), false, "the store pin must not be published");
});

check("the merged handler refuses a POST on the config URL", async () => {
  // The config read shares a file with the preview now; the seam must not have
  // turned a rule read into an unthrottled address check.
  const res = await callRoute("../api/delivery/check.js", {
    method: "POST",
    url: "/api/delivery/config",
    body: { address: ADDRESS, landmark: "Near the petrol pump" },
  });
  assert.equal(res.statusCode, 405, `expected 405, got ${res.statusCode}`);
  assert.equal(res.payload.error.code, "method_not_allowed");
});

check("a GET on the preview URL is still refused", async () => {
  const res = await callRoute("../api/delivery/check.js", {
    method: "GET",
    url: "/api/delivery/check",
  });
  assert.equal(res.statusCode, 405, `expected 405, got ${res.statusCode}`);
  assert.equal(res.payload.delivery, undefined, "no address may be measured on a GET");
});

check("the published rule reports the radius actually in force", () => {
  const before = process.env.JOC_DELIVERY_RADIUS_KM;
  try {
    process.env.JOC_DELIVERY_RADIUS_KM = "8";
    assert.equal(deliveryConfig().radiusKm, 8);
    delete process.env.JOC_DELIVERY_RADIUS_KM;
    assert.equal(deliveryConfig().radiusKm, DELIVERY_RADIUS_FALLBACK_KM);
  } finally {
    if (before === undefined) delete process.env.JOC_DELIVERY_RADIUS_KM;
    else process.env.JOC_DELIVERY_RADIUS_KM = before;
  }
});

/* ----------------------------------- run ---------------------------------- */

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    _resetStoreCache();
    console.log(`  pass  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
    _resetStoreCache();
  }
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
