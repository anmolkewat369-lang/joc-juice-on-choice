/**
 * Durable-storage checks: the Postgres driver.
 *
 * Why this file exists at all
 * ---------------------------
 * `dev/checkDelivery.mjs` and the rest of `npm test` run against the in-memory
 * store, because there is no database in CI. That leaves the driver production
 * actually uses — the one whose SQL decides what a real `joc_orders` row contains
 * — completely unexercised. A delivery area that validates, is returned in the
 * API response and is written by nothing would pass every other suite.
 *
 * So this drives `createPostgresStore()` against a stub `pg` pool and reads the SQL
 * it produces. No network, no database, no credentials: `pg.Pool` is replaced
 * before `api/_lib/store.js` lazily imports it, and every query is answered from
 * here.
 *
 * This is the check that proves the area is *persisted*, not merely accepted:
 *
 *   * `delivery_area` and `delivery_area_confirmed` are named in the INSERT, in
 *     the right positions, carrying the values that were validated;
 *   * the customer's name, phone, email, address, landmark and special
 *     instructions are all still there, in their own columns;
 *   * no legacy distance column is written, because nothing measures one;
 *   * a row coming back out of Postgres is turned into an admin order that carries
 *     the area, its label, the confirmation, the full address and the landmark.
 *
 * Store module state is per-process, and `getStore()` resolves a driver once, so
 * this must run as its own process. `npm test` invokes it as a separate script for
 * exactly that reason.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(`${process.cwd()}/package.json`);

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/* ------------------------------ the stub pool ------------------------------ */

const queries = [];
const NOW = new Date("2026-01-02T03:04:05.000Z");

/** What Postgres would hand back for the row we just inserted. */
const insertedRow = {
  id: "11111111-1111-1111-1111-111111111111",
  order_seq: 7,
  order_id: "JOC-20260102-0007",
  idempotency_key: "audit-postgres-1",
  access_hash: "0".repeat(64),
  customer_name: "Asha Rao",
  // Already normalised by validateCheckout, which is what actually reaches the
  // column. The stored form is E.164, not the 10 digits the customer typed.
  phone: "+919876543210",
  customer_email: "asha@example.com",
  address: "Plot 42, Dixit Colony, Marhatal, Jabalpur 482002",
  landmark: "Near the petrol pump",
  special_instructions: "Less spicy, no coriander",
  delivery_area: "marhatal",
  delivery_area_confirmed: true,
  // Present in the table, and never written by the application: the read-only
  // history of the old road-distance rule.
  delivery_distance_meters: 3200,
  delivery_radius_km: "4.00",
  delivery_eligible: true,
  delivery_outcome: "AVAILABLE",
  delivery_checked_at: NOW,
  tracking_token: "s3cret-token",
  items: [{ id: "paneer-momos", name: "Paneer Momos", price: 198, qty: 2, lineTotal: 396 }],
  subtotal: 396,
  delivery_charge: 0,
  total: 396,
  currency: "INR",
  payment_method: "COD",
  payment_status: "PENDING",
  order_status: "RECEIVED",
  razorpay_order_id: null,
  razorpay_payment_id: null,
  razorpay_signature: null,
  payment_method_used: null,
  payment_reference: null,
  payment_provider: "cod",
  payment_verified_at: null,
  payment_verified_by: null,
  created_at: NOW,
  updated_at: NOW,
};

class StubPool {
  constructor(options) {
    this.options = options;
  }

  async query(text, params) {
    const sql = String(text);
    queries.push({ sql, params: params ?? null });

    // The runtime DDL block. Accepted and ignored: this suite is about the INSERT
    // the driver builds, not about the schema it asks for.
    if (!params) return { rows: [] };
    if (/^insert into joc_orders/i.test(sql)) return { rows: [{ ...insertedRow, order_id: null }] };
    if (/^update joc_orders/i.test(sql)) return { rows: [insertedRow] };
    return { rows: [] };
  }
}

// Replace Pool before api/_lib/store.js dynamically imports "pg" (a CommonJS
// module, so the ESM namespace is read from this mutated export object).
const pg = require("pg");
pg.Pool = StubPool;

process.env.DATABASE_URL = "postgres://audit:audit@localhost:5432/audit";
delete process.env.JOC_ALLOW_MEMORY_STORE;
// No DDL round trip needed for this suite, and it keeps the captured query list
// down to the one statement under test.
process.env.JOC_AUTO_MIGRATE = "false";

const storeUrl = pathToFileURL(`${process.cwd()}/api/_lib/store.js`).href;
const { getStore, toAdminOrder, toPublicOrder, readTrackingToken } = await import(storeUrl);

/* -------------------------------- the record ------------------------------- */

/**
 * The record the order route builds. Taken from the real builder rather than
 * hand-written here, so this suite cannot pass while the route passes something
 * else to the store.
 */
const { buildOrderRecord } = await import(
  pathToFileURL(`${process.cwd()}/api/_lib/orderRequest.js`).href
);

const buildRecord = (over = {}) =>
  buildOrderRecord({
    name: "Asha Rao",
    phone: "9876543210",
    email: "asha@example.com",
    address: "Plot 42, Dixit Colony, Marhatal, Jabalpur 482002",
    landmark: "Near the petrol pump",
    instructions: "Less spicy, no coriander",
    deliveryArea: "marhatal",
    deliveryAreaConfirmed: true,
    items: [{ id: "paneer-momos", qty: 2 }],
    paymentMethod: "COD",
    ...over,
  });

const store = await getStore();

/**
 * One real insert, performed before the checks run, so the assertions below read
 * captured SQL rather than re-issuing statements. `buildOrderRecord` is the real
 * builder the order route calls, so this suite cannot pass while the route passes
 * something else to the store.
 */
const record = buildRecord();
const created = await store.createOrder(record, "audit-postgres-1");
const insert = queries.find((q) => /^insert into joc_orders/i.test(q.sql));
const columns = insert
  ? insert.sql
      .match(/insert into joc_orders\s*\(([^)]*)\)/i)[1]
      .split(",")
      .map((name) => name.trim())
  : [];
const params = insert?.params ?? [];
const valueFor = (column) => params[columns.indexOf(column)];

check("the durable driver is the one under test", () => {
  assert.equal(store.driver, "postgres");
  assert.equal(store.durable, true, "a memory store here would prove nothing");
  assert.ok(insert, "createOrder did not insert into joc_orders — the stub pool was bypassed");
  assert.equal(created.created, true);
  assert.equal(created.order.order_id, "JOC-20260102-0007", "the order id is assigned after insert");
});

check("the record the route hands over already carries the area", () => {
  assert.equal(record.deliveryArea, "marhatal");
  assert.equal(record.deliveryAreaName, "Marhatal");
  assert.equal(record.deliveryAreaConfirmed, true);
});

check("the area and its confirmation reach the INSERT", () => {
  assert.ok(
    columns.includes("delivery_area"),
    `delivery_area is not in the INSERT: ${columns.join(", ")}`,
  );
  assert.ok(
    columns.includes("delivery_area_confirmed"),
    `delivery_area_confirmed is not in the INSERT: ${columns.join(", ")}`,
  );
  assert.equal(
    columns.length,
    params.length,
    "the column list and the parameter list have drifted apart",
  );
  assert.equal(valueFor("delivery_area"), "marhatal");
  assert.equal(valueFor("delivery_area_confirmed"), true);
});

check("the customer's own details are all still stored", () => {
  assert.equal(valueFor("customer_name"), "Asha Rao");
  assert.equal(valueFor("phone"), "+919876543210");
  assert.equal(valueFor("customer_email"), "asha@example.com");
  assert.equal(valueFor("address"), "Plot 42, Dixit Colony, Marhatal, Jabalpur 482002");
  assert.equal(valueFor("landmark"), "Near the petrol pump");
  assert.equal(valueFor("special_instructions"), "Less spicy, no coriander");
  assert.equal(valueFor("payment_method"), "COD");
  assert.equal(valueFor("payment_status"), "PENDING", "a new COD order is pending");
  assert.equal(valueFor("order_status"), "RECEIVED", "JOC confirms delivery afterwards");
});

check("no legacy distance column is written", () => {
  // They stay in the table as history, but nothing may write them: a stored
  // distance would be a measurement nothing performed.
  for (const legacy of [
    "delivery_distance_meters",
    "delivery_radius_km",
    "delivery_eligible",
    "delivery_outcome",
    "delivery_checked_at",
  ]) {
    assert.equal(
      columns.includes(legacy),
      false,
      `${legacy} must not be written by the application`,
    );
  }
});

check("the row read back carries the area to the admin", () => {
  const admin = toAdminOrder(insertedRow);
  assert.equal(admin.deliveryArea, "marhatal");
  assert.equal(admin.deliveryAreaName, "Marhatal", "the label is resolved from the list");
  assert.equal(admin.deliveryAreaConfirmed, true);
  // Everything the admin needs to decide whether this order can be delivered.
  assert.equal(admin.address, "Plot 42, Dixit Colony, Marhatal, Jabalpur 482002");
  assert.equal(admin.landmark, "Near the petrol pump");
  assert.equal(admin.customerName, "Asha Rao");
  assert.equal(admin.phone, "+919876543210");
  assert.equal(admin.customerEmail, "asha@example.com");
  assert.equal(admin.specialInstructions, "Less spicy, no coriander");
  assert.equal(admin.orderStatus, "RECEIVED");
  assert.equal(admin.paymentStatus, "PENDING");
});

check("the customer's own order view shows the area too", () => {
  const pub = toPublicOrder(insertedRow);
  assert.equal(pub.deliveryArea, "marhatal");
  assert.equal(pub.deliveryAreaName, "Marhatal");
  assert.equal(pub.deliveryAreaConfirmed, true);
});

check("the legacy distance columns are never read back into a payload", () => {
  // The row above still carries 3200 m from the old rule. Nothing should surface it,
  // or an old order would make a distance claim JOC no longer supports.
  for (const shape of [toAdminOrder(insertedRow), toPublicOrder(insertedRow)]) {
    const body = JSON.stringify(shape);
    assert.equal(body.includes("3200"), false, "a legacy distance leaked into a payload");
    assert.equal(body.includes("AVAILABLE"), false, "a legacy outcome leaked into a payload");
    for (const key of Object.keys(shape)) {
      assert.equal(
        /^delivery(Distance|Radius|Eligible|Outcome|Checked)/.test(key),
        false,
        `${key} should not exist on an order payload`,
      );
    }
  }
});

check("the order secret still never appears in a payload", () => {
  assert.equal(readTrackingToken(insertedRow), "s3cret-token", "notifications can still build links");
  const body = JSON.stringify(toAdminOrder(insertedRow)) + JSON.stringify(toPublicOrder(insertedRow));
  assert.equal(body.includes("s3cret-token"), false, "the tracking token leaked");
  assert.equal(body.includes(insertedRow.access_hash), false, "the access hash leaked");
});

check("an order with no area is stored as NULL, not as a guess", () => {
  // Only reachable for a row written outside createOrder — a pre-005 order. It must
  // read back as "no area", not as some default area.
  const legacy = toAdminOrder({ ...insertedRow, delivery_area: null, delivery_area_confirmed: null });
  assert.equal(legacy.deliveryArea, null);
  assert.equal(legacy.deliveryAreaName, null);
  assert.equal(legacy.deliveryAreaConfirmed, false, "an old order is never 'confirmed'");
});

check("an area removed from the list reads back as no label, not a wrong one", () => {
  const orphaned = toAdminOrder({ ...insertedRow, delivery_area: "area-removed-last-year" });
  assert.equal(orphaned.deliveryArea, "area-removed-last-year", "the id survives");
  assert.equal(orphaned.deliveryAreaName, null, "but no name is invented for it");
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

console.log(`\n${checks.length - failures}/${checks.length} postgres storage checks passed`);
process.exit(failures === 0 ? 0 : 1);