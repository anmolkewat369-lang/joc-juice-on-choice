/**
 * Menu availability checks for the durable API, server-side checkout guard and
 * customer-facing menu card. The Postgres pool is stubbed; no database or
 * credentials are needed.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(`${ROOT}/package.json`);
const overrides = new Map();
const queries = [];
let orderWrites = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

class StubPool {
  constructor() {}

  async query(text, params) {
    const sql = String(text);
    queries.push({ sql, params: params ?? null });
    if (/select item_id, status, updated_at, updated_by/i.test(sql)) {
      return { rows: [...overrides.values()] };
    }
    if (/select item_id from joc_menu_availability/i.test(sql)) {
      return {
        rows: (params?.[0] ?? [])
          .filter((itemId) => overrides.get(itemId)?.status !== "available")
          .map((item_id) => ({ item_id })),
      };
    }
    if (!params) return { rows: [] };
    if (/insert into joc_menu_availability/i.test(sql)) {
      const [itemId, status, updatedBy] = params;
      const row = {
        item_id: itemId,
        status,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
      };
      overrides.set(itemId, row);
      return { rows: [row] };
    }
    if (/select \* from joc_orders where idempotency_key/i.test(sql)) {
      return { rows: [] };
    }
    if (/insert into joc_orders/i.test(sql)) {
      orderWrites += 1;
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL in availability test: ${sql}`);
  }
}

const pg = require("pg");
pg.Pool = StubPool;
process.env.DATABASE_URL = "postgres://availability-test.invalid/joc";
process.env.JOC_AUTO_MIGRATE = "false";
process.env.JOC_ADMIN_SESSION_SECRET = "menu-availability-admin-test-secret-32-chars";
process.env.JOC_CUSTOMER_SESSION_SECRET = "menu-availability-customer-test-secret-32-chars";
delete process.env.JOC_ADMIN_EMAILS;
delete process.env.JOC_ALLOW_MEMORY_STORE;

const { default: adminOrdersHandler } = await import("../api/admin/orders/index.js");
const { createSessionToken } = await import("../api/_lib/adminAuth.js");
const { createCustomerSession } = await import("../api/_lib/customerAuth.js");
const { MENU_ITEMS } = await import("../src/data/menu.js");
const { buildOrderRecord } = await import("../api/_lib/orderRequest.js");
const { _resetStoreCache } = await import("../api/_lib/store.js");
const adminCookie = `joc_admin_session=${createSessionToken({
  id: "admin-menu-test",
  email: "owner@example.com",
}).token}`;
const customerCookie = `joc_customer_session=${createCustomerSession({
  id: "customer-menu-test",
  email: "customer@example.com",
}).token}`;

async function request({
  method = "GET",
  url = "/api/menu",
  headers = {},
  body = {},
  rawBody,
} = {}) {
  const req = {
    method,
    url,
    headers: { "content-type": "application/json", ...headers },
    query: {},
    body: rawBody ?? JSON.stringify(body),
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
  await adminOrdersHandler(req, res);
  return res;
}

check("unauthenticated and forged admin updates are rejected", async () => {
  for (const cookie of [undefined, "joc_admin_session=forged", customerCookie]) {
    const result = await request({
      method: "PATCH",
      headers: cookie ? { cookie } : {},
      body: { itemId: "apple-juice", status: "out_of_stock" },
    });
    assert.equal(result.statusCode, 401);
  }
  assert.equal(overrides.size, 0);
});

check("the public menu starts with the original catalogue and defaults to Available", async () => {
  const result = await request();
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(result.payload.items.length, MENU_ITEMS.length);
  for (const item of MENU_ITEMS) {
    const effective = result.payload.items.find((entry) => entry.id === item.id);
    assert.ok(effective, `${item.id} was removed from the public menu`);
    assert.equal(effective.name, item.name);
    assert.equal(effective.category, item.category);
    assert.equal(effective.price, item.price);
    assert.equal(effective.image, item.image);
    assert.equal(effective.availability, "available");
  }
});

check("all three valid statuses are admin-writable and attributed to the session", async () => {
  for (const [itemId, status] of [
    ["apple-juice", "available"],
    ["orange-juice", "out_of_stock"],
    ["watermelon-juice", "coming_soon"],
  ]) {
    const result = await request({
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: { itemId, status },
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.item.id, itemId);
    assert.equal(result.payload.item.availability, status);
    assert.equal(overrides.get(itemId).updated_by, "admin-menu-test");
  }
});

check("invalid statuses, unknown IDs and malformed requests are rejected", async () => {
  const invalidStatus = await request({
    method: "PATCH",
    headers: { cookie: adminCookie },
    body: { itemId: "apple-juice", status: "sold_out" },
  });
  assert.equal(invalidStatus.statusCode, 422);
  assert.equal(invalidStatus.payload.error.code, "invalid_availability_status");

  const unknownId = await request({
    method: "PATCH",
    headers: { cookie: adminCookie },
    body: { itemId: "not-a-menu-item", status: "available" },
  });
  assert.equal(unknownId.statusCode, 404);

  const malformed = await request({
    method: "PATCH",
    headers: { cookie: adminCookie },
    rawBody: "{",
  });
  assert.equal(malformed.statusCode, 400);
});

check("Postgres retains status overrides when the API store is recreated", async () => {
  _resetStoreCache();
  const result = await request();
  const byId = new Map(result.payload.items.map((item) => [item.id, item]));
  assert.equal(byId.get("orange-juice").availability, "out_of_stock");
  assert.equal(byId.get("watermelon-juice").availability, "coming_soon");
  assert.equal(byId.get("banana-juice").availability, "available");
  assert.ok(queries.some(({ sql }) => /insert into joc_menu_availability/i.test(sql)));
  assert.ok(queries.some(({ sql }) => /on conflict \(item_id\) do update/i.test(sql)));
});

const orderBody = (id) => ({
  name: "Asha Rao",
  phone: "9876543210",
  email: "asha@example.com",
  address: "12 Dixit Colony, Jabalpur 482002",
  landmark: "Near the market",
  instructions: "",
  deliveryArea: "dixit-colony",
  deliveryAreaConfirmed: true,
  items: [{ id, qty: 1 }],
  paymentMethod: "COD",
});

check("order validation blocks current Out of Stock and Coming Soon items before persistence", async () => {
  const { default: ordersHandler } = await import("../api/orders/index.js");
  const before = orderWrites;
  for (const [id, status] of [
    ["orange-juice", "out_of_stock"],
    ["watermelon-juice", "coming_soon"],
  ]) {
    assert.equal(overrides.get(id).status, status);
    const req = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `menu-check-${id}`,
        cookie: customerCookie,
      },
      body: JSON.stringify(orderBody(id)),
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
    await ordersHandler(req, res);
    assert.equal(res.statusCode, 422);
    assert.equal(res.payload.error.code, "items_unavailable");
    assert.match(res.payload.error.message, new RegExp(MENU_ITEMS.find((item) => item.id === id).name));
  }
  assert.equal(orderWrites, before, "unavailable item request reached the orders INSERT");
});

check("Available items keep the normal server-side price calculation", () => {
  const record = buildOrderRecord(orderBody("apple-juice"), {
    customerUserId: "customer-menu-test",
    availability: { "apple-juice": "available" },
  });
  assert.equal(record.items[0].id, "apple-juice");
  assert.equal(record.items[0].price, MENU_ITEMS.find((item) => item.id === "apple-juice").price);
  assert.equal(record.total, record.subtotal);
});

check("unavailable customer cards retain prices, show badges and disable cart controls", async () => {
  const vite = await createServer({
    configFile: resolve(ROOT, "vite.config.js"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const [{ default: MenuCard }, { CartContext }] = await Promise.all([
      vite.ssrLoadModule("/src/components/MenuCard.jsx"),
      vite.ssrLoadModule("/src/cart/cartStore.js"),
    ]);
    const render = (id, status) => {
      const item = MENU_ITEMS.find((entry) => entry.id === id);
      const context = {
        items: [],
        availabilityFor: () => status,
        availabilityLoading: false,
        addItem() {},
        increment() {},
        decrement() {},
      };
      return renderToStaticMarkup(
        createElement(
          CartContext.Provider,
          { value: context },
          createElement(MenuCard, { item }),
        ),
      );
    };
    const out = render("orange-juice", "out_of_stock");
    assert.match(out, /Out of Stock/);
    assert.match(out, /disabled/);
    assert.match(out, /₹149/);
    const coming = render("watermelon-juice", "coming_soon");
    assert.match(coming, /Coming Soon/);
    assert.match(coming, /disabled/);
    const available = render("apple-juice", "available");
    assert.match(available, /Add to Cart/);
    assert.doesNotMatch(available, /disabled/);
  } finally {
    await vite.close();
  }
});

check("a stale cart item stays visible but cannot proceed to checkout", async () => {
  const vite = await createServer({
    configFile: resolve(ROOT, "vite.config.js"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const [{ default: CartView }, { CartContext }] = await Promise.all([
      vite.ssrLoadModule("/src/components/cart/CartView.jsx"),
      vite.ssrLoadModule("/src/cart/cartStore.js"),
    ]);
    const product = MENU_ITEMS.find((item) => item.id === "orange-juice");
    const value = {
      lines: [{ ...product, qty: 1, lineTotal: product.price }],
      subtotal: product.price,
      deliveryCharge: 0,
      total: product.price,
      count: 1,
      isEmpty: false,
      increment() {},
      decrement() {},
      removeItem() {},
      clearCart() {},
      availabilityFor: () => "out_of_stock",
      availabilityLoading: false,
      availabilityError: null,
    };
    const html = renderToStaticMarkup(
      createElement(CartContext.Provider, { value }, createElement(CartView)),
    );
    assert.match(html, /Out of Stock/);
    assert.match(html, /cannot be ordered right now/);
    assert.match(html, /disabled/);
    assert.doesNotMatch(html, /Proceed to Checkout/);
    assert.match(html, /Remove/);
  } finally {
    await vite.close();
  }
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(
      String(error?.stack ?? error)
        .split("\n")
        .map((line) => `        ${line}`)
        .join("\n"),
    );
  }
}

console.log(`\n${checks.length - failed}/${checks.length} menu availability checks passed.`);
if (failed > 0) process.exitCode = 1;
