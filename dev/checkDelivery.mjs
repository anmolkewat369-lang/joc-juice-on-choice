/**
 * Delivery-area checks.
 *
 * This replaces the road-distance suite that stubbed ORS and compared a measured
 * driving distance against a radius. There is no measurement now, so there is
 * nothing to stub: the rule JOC actually enforces is that a customer must choose
 * an area from the published list and explicitly confirm their address.
 *
 * What is pinned here, and why each one matters:
 *
 *   * the list has exactly one home, and nothing else defines an area;
 *   * the server rejects an area it does not serve, rather than trusting the id;
 *   * the confirmation must be a real boolean, so the checkbox and the wire field
 *     cannot mean different things;
 *   * no source file anywhere in the project mentions a maps provider, a radius
 *     or a coordinate — the strongest available guarantee that the automatic check
 *     has not crept back in through a new import;
 *   * a placed order makes no outbound request.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DELIVERY_AREAS,
  deliveryAreaFor,
  deliveryAreaStatusLabel,
  deliveryAreaSummary,
  isDeliveryArea,
  normaliseAreaId,
  validateDeliveryArea,
  DELIVERY_AREA_CONFIRM_LABEL,
  DELIVERY_AREA_CONFIRM_REQUIRED,
  DELIVERY_AREA_NOTE,
  DELIVERY_AREA_REQUIRED,
  DELIVERY_AREA_UNSUPPORTED,
} from "../shared/delivery.js";
import { searchDeliveryAreas } from "../src/data/deliveryAreas.js";
import { validateCheckout, VALIDATION_MESSAGES } from "../shared/ordering.js";
import { _resetStoreCache, getStore } from "../api/_lib/store.js";
import { PAYMENT_METHOD } from "../shared/ordering.js";

process.env.JOC_ALLOW_MEMORY_STORE = "true";
delete process.env.DATABASE_URL;

// Ordering requires a signed-in customer, so the suite signs one in through the
// real session machinery rather than bypassing `requireCustomer`.
process.env.JOC_CUSTOMER_SESSION_SECRET =
  "a-customer-test-secret-that-is-long-enough-xxxx";
const { createCustomerSession } = await import("../api/_lib/customerAuth.js");
const CUSTOMER_COOKIE = `joc_customer_session=${
  createCustomerSession({ id: "cust-test-user-1", email: "area-order@example.com" }).token
}`;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const ADDRESS = "Plot 42, Dixit Colony, Jabalpur 482002";

/* ------------------------------ the harness -------------------------------- */

const callRoute = async (
  modulePath,
  { method = "POST", headers = {}, body = {}, query = {} } = {},
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
  email: "area-order@example.com",
  deliveryArea: "dixit-colony",
  deliveryAreaConfirmed: true,
  address: ADDRESS,
  landmark: "Near the petrol pump",
  items: [{ id: "paneer-momos", qty: 2 }],
  paymentMethod: PAYMENT_METHOD.COD,
  ...over,
});

const placeOrder = (body, key) =>
  callRoute("../api/orders/index.js", {
    method: "POST",
    headers: { "idempotency-key": key, cookie: CUSTOMER_COOKIE },
    body,
  });

/* ------------------------------ the area list ------------------------------ */

/**
 * JOC's 22 areas, exactly as supplied, in the order supplied.
 *
 * Written out here rather than derived, because this is the one list a customer
 * reads verbatim. If an entry is dropped, renamed, duplicated or reordered, this
 * check fails and the diff says why — instead of the change shipping quietly as
 * "the picker looks slightly different".
 */
const JOC_AREAS = [
  "Dixit Colony",
  "Shri Ram College Rd",
  "Shri Ram College",
  "Rajeev Gandhi Nagar",
  "Karmeta",
  "Katangi Rd",
  "Madhotal",
  "Bhola Chowk",
  "Thana Madhotal",
  "Shri Ram Institute of Technology",
  "Tata Motors, Madhotal",
  "Rajiv Gandhi Chowk",
  "Transport Nagar",
  "Sheetalpuri",
  "Ranital Lake Jabalpur",
  "Vijay Nagar",
  "Kanchan Vihar",
  "Kachnar City Shiva Temple",
  "Sanatan Chowk",
  "Gayatri Temple, Transport Nagar",
  "Rani Durgavati Museum",
  "Pisanhari Ki Madiya",
];

check("the list is JOC's 22 areas, with these labels, in this order", () => {
  assert.equal(
    DELIVERY_AREAS.length,
    JOC_AREAS.length,
    `expected ${JOC_AREAS.length} areas, found ${DELIVERY_AREAS.length}`,
  );
  assert.deepEqual(
    DELIVERY_AREAS.map((area) => area.name),
    JOC_AREAS,
    "the customer-facing labels or their order have changed",
  );
});

check("every area is reachable by its own id, and the server accepts all 22", () => {
  // Walk the real validation path for each one rather than trusting the ids: this
  // is what proves the API would accept any area the picker offers.
  for (const name of JOC_AREAS) {
    const area = DELIVERY_AREAS.find((candidate) => candidate.name === name);
    assert.ok(area, `${name} is missing from the list`);
    const result = validateDeliveryArea({
      deliveryArea: area.id,
      deliveryAreaConfirmed: true,
    });
    assert.equal(result.valid, true, `${area.id} was refused: ${JSON.stringify(result.errors)}`);
    assert.equal(result.value.areaName, name, `${area.id} must resolve back to "${name}"`);
  }
});

check("no area carries a proximity label", () => {
  // The list is for choosing a place, not for telling a customer how far away it
  // is. Nothing here may imply a measurement.
  for (const area of DELIVERY_AREAS) {
    for (const banned of ["very close", "close", "moderate", "far", "farther", "near", "km"]) {
      assert.equal(
        area.name.toLowerCase().includes(banned),
        false,
        `"${area.name}" contains "${banned}" — no proximity wording may be shown`,
      );
    }
    assert.equal(area.stars, undefined, `${area.id} must not carry a star rating`);
    assert.equal(area.proximity, undefined, `${area.id} must not carry a proximity label`);
    assert.equal(area.distance, undefined, `${area.id} must not carry a distance`);
  }
});

check("the configured list is well-formed and free of duplicates", () => {
  assert.ok(Array.isArray(DELIVERY_AREAS), "DELIVERY_AREAS must be an array");
  assert.ok(DELIVERY_AREAS.length > 0, "the list must not be empty — no order could be placed");
  const ids = new Set();
  const names = new Set();
  for (const area of DELIVERY_AREAS) {
    assert.equal(typeof area.id, "string", "every area needs a string id");
    assert.equal(typeof area.name, "string", "every area needs a string name");
    assert.match(area.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `id "${area.id}" must be a stable slug`);
    assert.equal(ids.has(area.id), false, `duplicate id: ${area.id}`);
    assert.equal(names.has(area.name.toLowerCase()), false, `duplicate name: ${area.name}`);
    ids.add(area.id);
    names.add(area.name.toLowerCase());
  }
});

check("an area id is matched after normalising case and whitespace", () => {
  assert.equal(isDeliveryArea("dixit-colony"), true);
  assert.equal(isDeliveryArea("  KARMETA  "), true);
  assert.equal(isDeliveryArea("MADHOTAL"), true);
  assert.equal(isDeliveryArea("Tata-Motors-Madhotal"), true);
  // An id, not a name: "Gayatri Temple" normalises to "gayatri temple", which is
  // not the key "gayatri-temple-transport-nagar".
  assert.equal(isDeliveryArea("gayatri temple"), false, "a space is not a hyphen");
  assert.equal(isDeliveryArea("Dixit Colony"), false, "a label is not an id");
});

check("nothing that is not one of JOC's areas is refused", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "   ",
    "atlantis",
    "gadarwara",
    // Names from the previous provisional list: they are no longer offered, so
    // they must no longer be accepted either.
    "marhatal",
    "wright-town",
    "kanchan-vihar-2",
    "dixit colony",
    "MADHOTAL; DROP TABLE joc_orders",
    42,
    {},
    [],
    true,
    // Prototype keys must not pass a lookup that walks a Map built from the list.
    "constructor",
    "__proto__",
    "toString",
  ]) {
    assert.equal(
      isDeliveryArea(bad),
      false,
      `${JSON.stringify(bad) ?? String(bad)} must not be treated as an area`,
    );
  }
});

check("an id that is not in the list resolves to no name", () => {
  assert.equal(deliveryAreaFor("nope"), null);
  // An order whose area was later removed from the list must not be shown a
  // neighbour's name — null is the honest reading.
  assert.equal(deliveryAreaFor("constructor"), null);
});

check("normaliseAreaId collapses junk to the empty string, never to a match", () => {
  assert.equal(normaliseAreaId("  Kanchan Vihar "), "kanchan vihar");
  assert.equal(normaliseAreaId(null), "");
  assert.equal(normaliseAreaId(42), "");
  assert.equal(normaliseAreaId({}), "");
});

/* ------------------------------- the search -------------------------------- */

check("an empty search returns every area, so the list is never a blank box", () => {
  assert.equal(searchDeliveryAreas("").length, DELIVERY_AREAS.length);
  assert.equal(searchDeliveryAreas("   ").length, DELIVERY_AREAS.length);
  assert.equal(searchDeliveryAreas(null).length, DELIVERY_AREAS.length);
  assert.equal(searchDeliveryAreas(",").length, DELIVERY_AREAS.length);
});

check("every one of the 22 areas is findable by searching for its own name", () => {
  for (const area of DELIVERY_AREAS) {
    const found = searchDeliveryAreas(area.name);
    assert.ok(
      found.some((match) => match.id === area.id),
      `searching "${area.name}" did not find ${area.id}`,
    );
  }
});

check("search finds an area by part of its name, ignoring case", () => {
  assert.ok(searchDeliveryAreas("madh").map((a) => a.id).includes("madhotal"));
  assert.ok(searchDeliveryAreas("MADH").map((a) => a.id).includes("madhotal"));
  // "rd" reaches both roads, and does not reorder them.
  const roads = searchDeliveryAreas("rd").map((a) => a.id);
  assert.deepEqual(roads, ["shri-ram-college-rd", "katangi-rd"]);
  // Both temple entries, and both transport-nagar entries, are reachable by word.
  assert.equal(searchDeliveryAreas("temple").length, 2);
  assert.equal(searchDeliveryAreas("transport nagar").length, 2);
});

check("a search that matches a comma keeps working", () => {
  // The two labels that contain a comma are the easiest thing to break: the query
  // and the name must be folded the same way, or "Tata Motors, Madhotal" becomes
  // unsearchable by its own name.
  assert.ok(
    searchDeliveryAreas("Tata Motors, Madhotal").some((a) => a.id === "tata-motors-madhotal"),
    "the comma form must match",
  );
  assert.ok(
    searchDeliveryAreas("Tata Motors Madhotal").some((a) => a.id === "tata-motors-madhotal"),
    "the punctuation-free form must match too",
  );
  assert.ok(
    searchDeliveryAreas("Gayatri Temple, Transport Nagar").some(
      (a) => a.id === "gayatri-temple-transport-nagar",
    ),
    "the comma form must match",
  );
});

check("search results keep the configured order", () => {
  // Filtering must narrow the list, never reshuffle it: the order is what JOC
  // chose and what the customer has already seen.
  const order = DELIVERY_AREAS.map((area) => area.id);
  for (const query of ["nagar", "temple", "ram", "chowk", "rd"]) {
    const found = searchDeliveryAreas(query).map((area) => area.id);
    assert.deepEqual(
      found,
      order.filter((id) => found.includes(id)),
      `searching "${query}" reordered the list`,
    );
  }
});

check("a search that matches nothing returns an empty list, not everything", () => {
  // The opposite failure to the empty-query case: silently showing the whole list
  // would let a customer pick an area they did not search for.
  assert.deepEqual(searchDeliveryAreas("zzzzz"), []);
});

/* ----------------------------- the confirmation ---------------------------- */

check("the acknowledgement wording is fixed and shared", () => {
  assert.equal(
    DELIVERY_AREA_CONFIRM_LABEL,
    "I confirm that the delivery address entered above is correct and is within JOC's delivery area.",
  );
  assert.equal(
    DELIVERY_AREA_CONFIRM_REQUIRED,
    "Please confirm that your delivery address is correct and within JOC's delivery area.",
  );
  assert.match(DELIVERY_AREA_NOTE, /approximately 4 km by road/);
  assert.match(DELIVERY_AREA_NOTE, /JOC will confirm delivery availability/);
});

check("a valid area plus a real confirmation passes", () => {
  const result = validateDeliveryArea({
    deliveryArea: "dixit-colony",
    deliveryAreaConfirmed: true,
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.value.area, "dixit-colony");
  assert.equal(result.value.areaName, "Dixit Colony", "the label comes from the list");
  assert.equal(result.value.confirmed, true);
});

check("a missing area names the fix", () => {
  const result = validateDeliveryArea({ deliveryAreaConfirmed: true });
  assert.equal(result.valid, false);
  assert.equal(result.errors.deliveryArea, DELIVERY_AREA_REQUIRED);
});

check("an unsupported area is refused without naming what JOC does not serve", () => {
  const result = validateDeliveryArea({
    deliveryArea: "atlantis",
    deliveryAreaConfirmed: true,
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.deliveryArea, DELIVERY_AREA_UNSUPPORTED);
});

check("the confirmation must be exactly true", () => {
  // Everything below is what a naive `if (value)` would accept.
  for (const bad of [false, undefined, null, "true", "on", "yes", 1, {}, []]) {
    const result = validateDeliveryArea({ deliveryArea: "dixit-colony", deliveryAreaConfirmed: bad });
    assert.equal(
      result.valid,
      false,
      `${JSON.stringify(bad) ?? String(bad)} must not count as a confirmation`,
    );
    assert.equal(result.errors.deliveryAreaConfirmed, DELIVERY_AREA_CONFIRM_REQUIRED);
  }
});

check("both problems are reported at once, not one per submit", () => {
  const result = validateDeliveryArea({ deliveryArea: "", deliveryAreaConfirmed: false });
  assert.ok(result.errors.deliveryArea, "the missing area is reported");
  assert.ok(result.errors.deliveryAreaConfirmed, "and the missing confirmation");
});

/* ---------------------------- through validateCheckout --------------------- */

check("checkout validation requires the area and the confirmation", () => {
  const base = {
    name: "Asha Rao",
    phone: "9876543210",
    address: ADDRESS,
    paymentMethod: "COD",
    items: [{ id: "paneer-momos", qty: 1 }],
  };
  const missing = validateCheckout(base);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.deliveryArea, "an order with no area cannot be valid");
  assert.ok(missing.errors.deliveryAreaConfirmed, "nor can one with no confirmation");

  const complete = validateCheckout({
    ...base,
    deliveryArea: "dixit-colony",
    deliveryAreaConfirmed: true,
  });
  assert.equal(complete.valid, true, JSON.stringify(complete.errors));
  assert.equal(complete.value.deliveryArea, "dixit-colony");
  assert.equal(complete.value.deliveryAreaName, "Dixit Colony");
  assert.equal(complete.value.deliveryAreaConfirmed, true);
});

check("an order's area label is resolved from the list, never from the request", () => {
  const result = validateCheckout({
    name: "Asha Rao",
    phone: "9876543210",
    address: ADDRESS,
    paymentMethod: "COD",
    items: [{ id: "paneer-momos", qty: 1 }],
    deliveryArea: "dixit-colony",
    deliveryAreaConfirmed: true,
    deliveryAreaName: "ATTACKER CHOSEN LABEL",
  });
  assert.equal(result.valid, true);
  assert.equal(result.value.deliveryAreaName, "Dixit Colony", "a submitted label must be ignored");
});

/* --------------------------- presentation helpers ------------------------- */

check("an order's area is labelled honestly, including a legacy one", () => {
  assert.equal(
    deliveryAreaStatusLabel({ deliveryArea: "dixit-colony", deliveryAreaConfirmed: true }),
    "Confirmed by customer",
  );
  assert.match(
    deliveryAreaStatusLabel({ deliveryArea: "dixit-colony", deliveryAreaConfirmed: false }),
    /pending/i,
  );
  assert.equal(
    deliveryAreaStatusLabel({ deliveryArea: null }),
    "Not recorded",
    "an order placed before the area list must not look confirmed",
  );
  assert.match(deliveryAreaSummary({ deliveryArea: "dixit-colony", deliveryAreaConfirmed: true }), /confirmed/);
  assert.match(deliveryAreaSummary({}), /no area/i);
});

/* ------------------------------ the order route ---------------------------- */

check("an order with no area is refused by the API", async () => {
  const res = await placeOrder(checkoutBody({ deliveryArea: null }), "area-missing-0001");
  assert.equal(res.statusCode, 422, JSON.stringify(res.payload));
  assert.equal(res.payload.error.code, "invalid_checkout");
  assert.equal(res.payload.error.errors.deliveryArea, DELIVERY_AREA_REQUIRED);
});

check("an area JOC does not serve is refused by the API", async () => {
  const res = await placeOrder(checkoutBody({ deliveryArea: "atlantis" }), "area-unknown-0001");
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.errors.deliveryArea, DELIVERY_AREA_UNSUPPORTED);
});

check("an unconfirmed address is refused by the API", async () => {
  const res = await placeOrder(
    checkoutBody({ deliveryAreaConfirmed: false }),
    "area-unconfirmed-0001",
  );
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.errors.deliveryAreaConfirmed, DELIVERY_AREA_CONFIRM_REQUIRED);
});

check("a valid order is stored with its area and confirmation", async () => {
  _resetStoreCache();
  const res = await placeOrder(checkoutBody(), "area-ok-0001");
  assert.equal(res.statusCode, 201, JSON.stringify(res.payload));
  assert.equal(res.payload.order.deliveryArea, "dixit-colony");
  assert.equal(res.payload.order.deliveryAreaName, "Dixit Colony");
  assert.equal(res.payload.order.deliveryAreaConfirmed, true);
  assert.equal(res.payload.order.orderStatus, "RECEIVED", "JOC confirms delivery afterwards");
});

check("a replay returns the same order and never re-validates it", async () => {
  // The order exists. A customer whose network dropped the response retries with
  // the same key, and must get their order back rather than a refusal.
  const first = await placeOrder(checkoutBody(), "area-replay-0001");
  assert.equal(first.statusCode, 201);
  const second = await placeOrder(
    checkoutBody({ deliveryArea: "atlantis", deliveryAreaConfirmed: false }),
    "area-replay-0001",
  );
  assert.equal(second.statusCode, 200, JSON.stringify(second.payload));
  assert.equal(second.payload.created, false);
  assert.equal(second.payload.order.orderId, first.payload.order.orderId);
  assert.equal(second.payload.accessToken, null, "a replay is never handed the secret again");
});

check("placing an order makes no outbound request", async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input?.url ?? input));
    return realFetch(input, init);
  };
  try {
    const res = await placeOrder(checkoutBody(), "area-no-egress-0001");
    assert.equal(res.statusCode, 201, JSON.stringify(res.payload));
    assert.deepEqual(calls, [], `order creation reached out to: ${calls.join(", ")}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

check("no response or stored order carries a measured distance", async () => {
  const store = await getStore();
  const res = await placeOrder(checkoutBody(), "area-nodistance-0001");
  assert.equal(res.statusCode, 201);
  const body = JSON.stringify(res.payload);
  for (const claim of ["distanceMeters", "radiusKm", "by road", "delivery_outcome"]) {
    assert.equal(body.includes(claim), false, `a placed order must not report ${claim}`);
  }

  const row = await store.getOrder(res.payload.order.orderId);
  assert.equal(row.delivery_area, "dixit-colony");
  assert.equal(row.delivery_area_confirmed, true);
  for (const column of [
    "delivery_distance_meters",
    "delivery_radius_km",
    "delivery_eligible",
    "delivery_outcome",
    "delivery_checked_at",
  ]) {
    assert.equal(row[column], undefined, `${column} is gone from the record`);
  }
});

/* -------------------- no automatic check, anywhere ------------------------- */

/**
 * Read every source file in the project and assert none of them mentions a maps
 * provider, a radius or a coordinate.
 *
 * This is the guarantee that matters most: the removal of the automatic check is
 * easy to undo by accident in a later change, and a new import of a deleted module
 * would fail the build anyway — but a new *inline* fetch to a routing API would
 * not. This catches it.
 *
 * `dev/` is excluded because this file names those providers itself, in the
 * patterns below. Everything that actually runs in production is covered.
 */
const SOURCE_DIRS = ["api", "shared", "src"];
const FORBIDDEN = [
  /\bheigit\b/i,
  /openrouteservice/i,
  /pelias/i,
  /ORS_API_KEY/,
  /JOC_DELIVERY_RADIUS_KM/,
  /JOC_STORE_LATITUDE/,
  /JOC_STORE_LONGITUDE/,
  /GOOGLE_MAPS_API_KEY/,
  /\bdirections\/driving\b/i,
  /navigator\.geolocation/,
  /geolocation\./,
];

async function* sourceFiles(dir = "") {
  const base = dir ? join(process.cwd(), dir) : process.cwd();
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* sourceFiles(rel);
    } else if (/\.(js|mjs|jsx|css)$/.test(entry.name)) {
      yield rel;
    }
  }
}

check("no source file references a maps provider, radius or location API", async () => {
  const offenders = [];
  for (const dir of SOURCE_DIRS) {
    for await (const rel of sourceFiles(dir)) {
      const text = await readFile(join(process.cwd(), rel), "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${rel} matches ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `automatic delivery checking crept back in:\n${offenders.join("\n")}`);
});

check("the delivery-check endpoint and its modules are gone", async () => {
  // Removing the route removes the ability to ask the server "is this address
  // deliverable?", which is the whole point: that question has no measured answer.
  for (const path of [
    "api/delivery/check.js",
    "api/_lib/delivery.js",
    "api/_lib/ors.js",
    "src/components/order/DeliveryCheck.jsx",
  ]) {
    let exists = true;
    try {
      await readFile(join(process.cwd(), path));
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `${path} must no longer exist`);
  }
});

/* ------------------------ the browser actually sends it ---------------------- */

/**
 * The gap this closes
 * ------------------
 * Every other check here posts to the API directly, which means none of them can
 * catch a field that the BROWSER forgot to send. A request built in the app that
 * omits `deliveryArea` is refused every single time with "Please select your area
 * from the list." — a checkout that can never succeed, no matter how many green
 * suites there are, because every one of them filled the field in by hand.
 *
 * So: read the payload the order flow actually builds, and require that every
 * field `validateCheckout` can refuse is present in it. The list comes from the
 * shared contract rather than from a hand-written copy, so adding a required field
 * upstream fails here until the browser sends it too.
 */
check("the browser sends every field the shared contract can refuse", async () => {
  const flow = await readFile(join(process.cwd(), "src/lib/useOrderFlow.js"), "utf8");

  // The literal passed to createOrder(...). Taken from the call site rather than
  // the whole file, so an unrelated object elsewhere in the module cannot satisfy
  // this by accident.
  const call = flow.match(/createOrder\(\s*\{([\s\S]*?)\},\s*idempotencyKey/);
  assert.ok(call, "could not find the createOrder payload in src/lib/useOrderFlow.js");
  const payload = call[1];

  const sent = new Set([...payload.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]));
  // `cart` is reported against the cart, not a customer field, and is expressed as
  // the items array in the payload.
  const required = Object.keys(VALIDATION_MESSAGES).filter((field) => field !== "cart");
  // "items" is the field name the API expects; the browser builds an "items"
  // array from the cart. validateCheckout does not validate a top-level "items"
  // string, so there is no refusal to assert for a missing "item" field.
  const missing = required.filter((field) => field !== "item" && !sent.has(field));
  assert.deepEqual(
    missing,
    [],
    `src/lib/useOrderFlow.js does not send: ${missing.join(", ")} — the server refuses an\n` +
      "order missing any of these, so the customer could never complete checkout.",
  );
});

check("the browser sends the area and the confirmation as separate fields", async () => {
  const flow = await readFile(join(process.cwd(), "src/lib/useOrderFlow.js"), "utf8");
  assert.match(
    flow,
    /deliveryArea:\s*details\.deliveryArea\b/,
    "the chosen area must be sent",
  );
  assert.match(
    flow,
    /deliveryAreaConfirmed:\s*details\.deliveryAreaConfirmed\b/,
    "the acknowledgement must be sent, and sent as its own boolean field",
  );
  // The area must arrive as an id from the list, not as a display string, or the
  // server would have nothing to look up.
  const selector = await readFile(
    join(process.cwd(), "src/components/order/CheckoutView.jsx"),
    "utf8",
  );
  assert.match(
    selector,
    /onChange=\{\(deliveryArea\) =>/,
    "the picker must report the id it was given, not a label",
  );
});

/* --------------------------------- runner ---------------------------------- */

let failures = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message.split("\n").join("\n      ")}`);
  }
}

console.log(`\n${checks.length - failures}/${checks.length} delivery-area checks passed`);
process.exit(failures === 0 ? 0 : 1);