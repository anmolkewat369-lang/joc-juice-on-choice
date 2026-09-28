/**
 * Order storage.
 *
 * Two drivers behind one interface:
 *
 *   postgres  — the real store. Supabase Postgres (or any Postgres) via
 *               DATABASE_URL. Durable, survives restarts, shared across
 *               serverless instances. This is what production uses.
 *
 *   memory    — a plain Map, used only when DATABASE_URL is absent so the flow
 *               can be demonstrated locally. NOT durable, NOT shared. Every
 *               response built on it is tagged `durable: false` and the checkout
 *               tells the customer, in plain language, that the order is not
 *               being saved. Nothing is ever faked as stored.
 *
 * The localStorage cart on the client is a shopping bag. It is never the order
 * database.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { formatOrderId, ORDER_STATUS, PAYMENT_STATUS, CURRENCY } from "../../shared/ordering.js";
import { AUTO_MIGRATE_SQL } from "./schema.js";

let driverPromise = null;

/* --------------------------------- helpers -------------------------------- */

export const hashAccessToken = (token) =>
  createHash("sha256").update(String(token ?? "")).digest("hex");

export const newAccessToken = () => randomBytes(24).toString("hex");

const isMigrationOff = () =>
  String(process.env.JOC_AUTO_MIGRATE ?? "true").toLowerCase() === "false";

/* ------------------------------- postgres -------------------------------- */

function createPostgresStore() {
  const pool = new pgModule.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });

  let ready = null;
  const ensureReady = () => {
    ready ??= isMigrationOff()
      ? Promise.resolve()
      : pool.query(AUTO_MIGRATE_SQL).catch((error) => {
          // A locked-down or read-only database should fail loudly on the first
          // real query instead of silently pretending to work.
          console.error("[joc-api] auto-migrate failed:", error.message);
          throw error;
        });
    return ready;
  };

  const run = async (text, params) => {
    await ensureReady();
    return pool.query(text, params);
  };

  return {
    driver: "postgres",
    durable: true,

    /**
     * Insert a new order, or return the one that already exists for this
     * idempotency key. The unique index is what makes a double-clicked
     * "Place Order", a refresh or a network retry impossible to duplicate.
     */
    async createOrder(record, idempotencyKey) {
      const { rows } = await run(
        `insert into joc_orders (
           idempotency_key, access_hash, customer_name, phone, address, landmark,
           special_instructions, items, subtotal, delivery_charge, total, currency,
           payment_method, payment_status, order_status
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)
         on conflict (idempotency_key) do nothing
         returning *`,
        [
          idempotencyKey,
          hashAccessToken(record.accessToken),
          record.customerName,
          record.phone,
          record.address,
          record.landmark,
          record.specialInstructions,
          JSON.stringify(record.items),
          record.subtotal,
          record.deliveryCharge,
          record.total,
          record.currency,
          record.paymentMethod,
          record.paymentStatus,
          record.orderStatus,
        ],
      );

      if (rows.length > 0) {
        const [order] = await run(
          `update joc_orders
              set order_id = $1
            where id = $2
            returning *`,
          [formatOrderId(rows[0].created_at, rows[0].order_seq), rows[0].id],
        );
        return { order, created: true };
      }

      // Replay of a request that already succeeded.
      const existing = await run(
        `select * from joc_orders where idempotency_key = $1 limit 1`,
        [idempotencyKey],
      );
      if (existing.rows.length === 0) {
        throw new Error("Order insert conflicted but no existing order was found.");
      }
      return { order: existing.rows[0], created: false };
    },

    async getOrder(orderId) {
      const { rows } = await run(`select * from joc_orders where order_id = $1 limit 1`, [
        orderId,
      ]);
      return rows[0] ?? null;
    },

    async setRazorpayOrderId(orderId, razorpayOrderId) {
      const { rows } = await run(
        `update joc_orders set razorpay_order_id = $2 where order_id = $1 returning *`,
        [orderId, razorpayOrderId],
      );
      return rows[0] ?? null;
    },

    async updatePayment(orderId, patch) {
      const { rows } = await run(
        `update joc_orders
            set payment_status        = $2,
                razorpay_payment_id   = coalesce($3, razorpay_payment_id),
                razorpay_signature    = coalesce($4, razorpay_signature),
                payment_method_used   = coalesce($5, payment_method_used),
                order_status          = coalesce($6, order_status)
          where order_id = $1
          returning *`,
        [
          orderId,
          patch.paymentStatus,
          patch.razorpayPaymentId ?? null,
          patch.razorpaySignature ?? null,
          patch.paymentMethodUsed ?? null,
          patch.orderStatus ?? null,
        ],
      );
      return rows[0] ?? null;
    },

    async setPaymentMethod(orderId, paymentMethod) {
      const { rows } = await run(
        `update joc_orders
            set payment_method      = $2,
                payment_status      = $3,
                razorpay_order_id   = null,
                razorpay_payment_id = null,
                razorpay_signature  = null
          where order_id = $1
          returning *`,
        [orderId, paymentMethod, PAYMENT_STATUS.PENDING],
      );
      return rows[0] ?? null;
    },
  };
}

/* --------------------------------- memory --------------------------------- */

/**
 * Mirrors the memory driver onto the same snake_case row shape Postgres
 * returns, so both drivers share one mapping in `toPublicOrder` and the
 * non-durable mode can never diverge from the durable one.
 */
const toRow = (record) => ({
  id: randomUUID(),
  order_seq: null,
  order_id: null,
  idempotency_key: null,
  access_hash: hashAccessToken(record.accessToken),
  customer_name: record.customerName,
  phone: record.phone,
  address: record.address,
  landmark: record.landmark,
  special_instructions: record.specialInstructions,
  items: record.items,
  subtotal: record.subtotal,
  delivery_charge: record.deliveryCharge,
  total: record.total,
  currency: record.currency,
  payment_method: record.paymentMethod,
  payment_status: record.paymentStatus,
  order_status: record.orderStatus,
  razorpay_order_id: null,
  razorpay_payment_id: null,
  razorpay_signature: null,
  payment_method_used: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

function createMemoryStore() {
  const orders = new Map(); // orderId -> row
  const byKey = new Map(); // idempotencyKey -> orderId
  let sequence = 0;

  return {
    driver: "memory",
    durable: false,

    async createOrder(record, idempotencyKey) {
      const replayId = byKey.get(idempotencyKey);
      if (replayId) return { order: orders.get(replayId), created: false };

      sequence += 1;
      const row = toRow(record);
      row.order_seq = sequence;
      row.order_id = formatOrderId(new Date(row.created_at), sequence);
      row.idempotency_key = idempotencyKey;
      orders.set(row.order_id, row);
      byKey.set(idempotencyKey, row.order_id);
      return { order: row, created: true };
    },

    async getOrder(orderId) {
      return orders.get(orderId) ?? null;
    },

    async setRazorpayOrderId(orderId, razorpayOrderId) {
      const row = orders.get(orderId);
      if (!row) return null;
      row.razorpay_order_id = razorpayOrderId;
      return row;
    },

    async updatePayment(orderId, patch) {
      const row = orders.get(orderId);
      if (!row) return null;
      if (patch.paymentStatus) row.payment_status = patch.paymentStatus;
      if (patch.razorpayPaymentId) row.razorpay_payment_id = patch.razorpayPaymentId;
      if (patch.razorpaySignature) row.razorpay_signature = patch.razorpaySignature;
      if (patch.paymentMethodUsed) row.payment_method_used = patch.paymentMethodUsed;
      if (patch.orderStatus) row.order_status = patch.orderStatus;
      return row;
    },

    async setPaymentMethod(orderId, paymentMethod) {
      const row = orders.get(orderId);
      if (!row) return null;
      row.payment_method = paymentMethod;
      row.payment_status = PAYMENT_STATUS.PENDING;
      row.razorpay_order_id = null;
      row.razorpay_payment_id = null;
      row.razorpay_signature = null;
      return row;
    },
  };
}

/* -------------------------------- lifecycle ------------------------------- */

let pgModule = null;

/** `pg` is imported only when a database is actually configured. */
async function loadPg() {
  if (!pgModule) {
    const mod = await import("pg");
    pgModule = mod.default ?? mod;
  }
  return pgModule;
}

export async function getStore() {
  driverPromise ??= (async () => {
    const url = process.env.DATABASE_URL;
    if (url) {
      await loadPg();
      console.log("[joc-api] order storage: postgres (durable)");
      return createPostgresStore();
    }

    // On Vercel production a missing database must never mean "orders vanish
    // on the next deploy". Refuse the server instead: nothing gets silently
    // accepted and forgotten. Local dev and preview builds keep the honest
    // memory fallback for trying the flow out.
    const isProduction = process.env.VERCEL_ENV === "production";
    if (isProduction && process.env.JOC_ALLOW_MEMORY_STORE !== "true") {
      throw new Error(
        "[joc-api] DATABASE_URL is required in production. Orders would not persist, so the API is refusing to run.",
      );
    }

    console.warn(
      "[joc-api] DATABASE_URL is not set — orders are being held in memory for this " +
        "instance only. They are NOT saved. Set DATABASE_URL before launch.",
    );
    return createMemoryStore();
  })();
  return driverPromise;
}

/* --------------------------------- mapping -------------------------------- */

const toCamel = (row) => ({
  id: row.id,
  orderId: row.order_id,
  orderSeq: Number(row.order_seq),
  customerName: row.customer_name,
  phone: row.phone,
  address: row.address,
  landmark: row.landmark,
  specialInstructions: row.special_instructions,
  items: typeof row.items === "string" ? JSON.parse(row.items) : row.items,
  subtotal: row.subtotal,
  deliveryCharge: row.delivery_charge,
  total: row.total,
  currency: row.currency ?? CURRENCY,
  paymentMethod: row.payment_method,
  paymentStatus: row.payment_status,
  orderStatus: row.order_status,
  paymentMethodUsed: row.payment_method_used,
  razorpayPaymentId: row.razorpay_payment_id,
  createdAt: new Date(row.created_at).toISOString(),
});

/**
 * Shape sent to the browser. The order secret and the raw hash are stripped —
 * the secret only ever travels in the create response and the lookup query.
 */
export const toPublicOrder = (row) => {
  if (!row) return null;
  const { razorpay_payment_id, ...rest } = toCamel(row);
  return {
    ...rest,
    razorpayPaymentRef: razorpay_payment_id ? lastChars(razorpay_payment_id) : null,
  };
};

const lastChars = (value) => `••${String(value).slice(-6)}`;

export const ORDER_DEFAULTS = {
  currency: CURRENCY,
  orderStatus: ORDER_STATUS.RECEIVED,
  paymentStatus: PAYMENT_STATUS.PENDING,
};
