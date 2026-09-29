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
import {
  formatOrderId,
  ORDER_STATUS,
  PAYMENT_STATUS,
  PAYMENT_PROVIDER,
  CURRENCY,
} from "../../shared/ordering.js";
import { AUTO_MIGRATE_SQL } from "./schema.js";

let driverPromise = null;

/* --------------------------------- helpers -------------------------------- */

export const hashAccessToken = (token) =>
  createHash("sha256").update(String(token ?? "")).digest("hex");

export const newAccessToken = () => randomBytes(24).toString("hex");

const isMigrationOff = () =>
  String(process.env.JOC_AUTO_MIGRATE ?? "true").toLowerCase() === "false";

/** Largest page the admin API will ever return, whatever the client asks for. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Clamp client-supplied pagination to something sane. */
export function pageBounds({ page, pageSize } = {}) {
  const size = Math.min(
    Math.max(1, Number.parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const number = Math.max(1, Number.parseInt(page, 10) || 1);
  return { limit: size, offset: (number - 1) * size, page: number, pageSize: size };
}


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
           payment_method, payment_status, order_status, payment_provider
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)
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
          record.paymentProvider ?? null,
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

    /**
     * Convert an order to cash on delivery, in place.
     *
     * Every trace of the attempted digital payment is cleared, so a converted
     * order cannot carry a stale UTR or gateway id that an admin might later
     * verify. The provider becomes "cod" — see PAYMENT_PROVIDER.
     */
    async setPaymentMethod(orderId, paymentMethod) {
      const { rows } = await run(
        `update joc_orders
            set payment_method      = $2,
                payment_status      = $3,
                payment_provider    = $4,
                payment_reference   = null,
                payment_verified_at = null,
                payment_verified_by = null,
                razorpay_order_id   = null,
                razorpay_payment_id = null,
                razorpay_signature  = null
          where order_id = $1
          returning *`,
        [orderId, paymentMethod, PAYMENT_STATUS.PENDING, PAYMENT_PROVIDER.COD],
      );
      return rows[0] ?? null;
    },

    /**
     * Record a customer-submitted UTR.
     *
     * Deliberately narrow: it can only move a UPI order that is still awaiting
     * payment, and only into PAYMENT_VERIFICATION_REQUIRED. There is no
     * parameter through which this function could mark an order PAID — that
     * state is unreachable from any customer-facing code path.
     */
    async submitPaymentReference(orderId, reference, provider) {
      const { rows } = await run(
        `update joc_orders
            set payment_reference = $2,
                payment_provider  = coalesce($3, payment_provider),
                payment_status    = $4
          where order_id = $1
            and payment_method = 'UPI'
            and payment_status in ('PENDING', 'PAYMENT_VERIFICATION_REQUIRED')
          returning *`,
        [
          orderId,
          reference,
          provider ?? PAYMENT_PROVIDER.MANUAL_UPI,
          PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED,
        ],
      );
      return rows[0] ?? null;
    },

    /* ------------------------------ admin reads ----------------------------- */

    /**
     * Newest-first page of orders. `where` is a list of { sql, value } pairs
     * built by api/_lib/ordersAdmin.js from an allow-listed filter name, so no
     * request text ever reaches the query.
     */
    async listOrders({ where = [], limit, offset }) {
      const params = [];
      const clauses = where.map(({ sql, value }) => {
        params.push(value);
        return sql.replace("?", `$${params.length}`);
      });
      const whereSql = clauses.length ? `where ${clauses.join(" and ")}` : "";

      const total = await run(
        `select count(*)::int as count from joc_orders ${whereSql}`,
        params,
      );

      const listParams = [...params, limit, offset];
      const { rows } = await run(
        `select * from joc_orders
         ${whereSql}
         order by created_at desc, order_seq desc
         limit $${listParams.length - 1} offset $${listParams.length}`,
        listParams,
      );

      return { rows, total: total.rows[0]?.count ?? 0 };
    },

    /** Filter-bar badges in one grouped query. */
    async statusCounts() {
      const { rows } = await run(
        `select order_status, payment_status, count(*)::int as count
           from joc_orders
          group by order_status, payment_status`,
      );
      return rows.map((row) => ({
        orderStatus: row.order_status,
        paymentStatus: row.payment_status,
        count: row.count,
      }));
    },

    async listOrderEvents(orderUuid) {
      const { rows } = await run(
        `select * from joc_order_events
          where order_uuid = $1
          order by created_at desc, id desc`,
        [orderUuid],
      );
      return rows;
    },

    /** Append-only audit write. Never updates and never deletes. */
    async appendEvent({
      orderUuid,
      orderRef,
      eventType,
      field = null,
      oldValue = null,
      newValue = null,
      actor = "system",
      note = null,
      metadata = {},
    }) {
      const { rows } = await run(
        `insert into joc_order_events (
           order_uuid, order_ref, event_type, field, old_value, new_value,
           actor, note, metadata
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         returning *`,
        [
          orderUuid,
          orderRef,
          eventType,
          field,
          oldValue,
          newValue,
          actor,
          note,
          JSON.stringify(metadata ?? {}),
        ],
      );
      return rows[0] ?? null;
    },

    /**
     * Guarded admin write. Only the columns an admin action is allowed to
     * change are writable, and PAID is only reachable together with
     * `paymentVerifiedAt` — i.e. only through a recorded verification.
     */
    async adminUpdateOrder(
      orderId,
      {
        orderStatus = null,
        paymentStatus = null,
        paymentReference = null,
        paymentProvider = null,
        paymentVerifiedAt = null,
        paymentVerifiedBy = null,
      } = {},
    ) {
      const { rows } = await run(
        `update joc_orders
            set order_status        = coalesce($2, order_status),
                payment_status      = coalesce($3, payment_status),
                payment_reference   = coalesce($4, payment_reference),
                payment_provider    = coalesce($5, payment_provider),
                payment_verified_at = coalesce($6, payment_verified_at),
                payment_verified_by = coalesce($7, payment_verified_by)
          where order_id = $1
          returning *`,
        [
          orderId,
          orderStatus,
          paymentStatus,
          paymentReference,
          paymentProvider,
          paymentVerifiedAt,
          paymentVerifiedBy,
        ],
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
  payment_reference: null,
  payment_provider: record.paymentProvider ?? null,
  payment_verified_at: null,
  payment_verified_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

/**
 * The memory driver's admin list. The Postgres driver evaluates the same filter
 * set in SQL; here the `sql` fragments are matched by identity so both drivers
 * accept exactly the same allow-listed filters and cannot drift apart.
 */
const MEMORY_FILTERS = new Map([
  ["order_status = ?", (row, value) => row.order_status === value],
  ["payment_status = ?", (row, value) => row.payment_status === value],
  ["created_at > ?", (row, value) => new Date(row.created_at) > new Date(value)],
  ["lower(customer_name) like ?", (row, value) =>
    String(row.customer_name).toLowerCase().includes(String(value).replace(/%/g, ""))],
  ["phone like ?", (row, value) => String(row.phone).includes(String(value).replace(/%/g, ""))],
  ["order_id = ?", (row, value) => row.order_id === value],
]);

function createMemoryStore() {
  const orders = new Map(); // orderId -> row
  const byKey = new Map(); // idempotencyKey -> orderId
  const events = []; // append-only audit trail
  let sequence = 0;

  const recordEvent = (entry) => {
    const row = {
      id: events.length + 1,
      order_uuid: entry.orderUuid,
      order_ref: entry.orderRef,
      event_type: entry.eventType,
      field: entry.field ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      actor: entry.actor ?? "system",
      note: entry.note ?? null,
      metadata: entry.metadata ?? {},
      created_at: new Date().toISOString(),
    };
    events.push(row);
    return row;
  };

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
      row.payment_provider = PAYMENT_PROVIDER.COD;
      row.payment_reference = null;
      row.payment_verified_at = null;
      row.payment_verified_by = null;
      row.razorpay_order_id = null;
      row.razorpay_payment_id = null;
      row.razorpay_signature = null;
      return row;
    },

    async submitPaymentReference(orderId, reference, provider) {
      const row = orders.get(orderId);
      if (!row) return null;
      if (row.payment_method !== "UPI") return null;
      if (![PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED].includes(
        row.payment_status,
      )) {
        return null;
      }
      row.payment_reference = reference;
      row.payment_provider = provider ?? PAYMENT_PROVIDER.MANUAL_UPI;
      row.payment_status = PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED;
      return row;
    },

    async listOrders({ where = [], limit, offset }) {
      const matches = [...orders.values()].filter((row) =>
        where.every(({ sql, value }) => {
          const test = MEMORY_FILTERS.get(sql);
          if (!test) throw new Error(`Unsupported memory-store filter: ${sql}`);
          return test(row, value);
        }),
      );
      matches.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at) || b.order_seq - a.order_seq,
      );
      return { rows: matches.slice(offset, offset + limit), total: matches.length };
    },

    /** Filter-bar badges in one grouped pass. */
    async statusCounts() {
      const counts = new Map();
      for (const row of orders.values()) {
        const key = `${row.order_status}|${row.payment_status}`;
        const existing = counts.get(key) ?? {
          orderStatus: row.order_status,
          paymentStatus: row.payment_status,
          count: 0,
        };
        existing.count += 1;
        counts.set(key, existing);
      }
      return [...counts.values()];
    },

    async listOrderEvents(orderUuid) {
      return events
        .filter((event) => event.order_uuid === orderUuid)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
    },
    async appendEvent(entry) {
      return recordEvent(entry);
    },

    async adminUpdateOrder(
      orderId,
      {
        orderStatus = null,
        paymentStatus = null,
        paymentReference = null,
        paymentProvider = null,
        paymentVerifiedAt = null,
        paymentVerifiedBy = null,
      } = {},
    ) {
      const row = orders.get(orderId);
      if (!row) return null;
      if (orderStatus) row.order_status = orderStatus;
      if (paymentStatus) row.payment_status = paymentStatus;
      if (paymentReference) row.payment_reference = paymentReference;
      if (paymentProvider) row.payment_provider = paymentProvider;
      if (paymentVerifiedAt) row.payment_verified_at = paymentVerifiedAt;
      if (paymentVerifiedBy) row.payment_verified_by = paymentVerifiedBy;
      row.updated_at = new Date().toISOString();
      return row;
    },

    /** Test/inspection seam: the append-only audit trail. */
    _events: events,
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

/**
 * Drop the cached driver so the next getStore() re-reads the environment.
 *
 * Test seam only — the environment of a running serverless instance does not
 * change mid-life, and production never calls this.
 */
export function _resetStoreCache() {
  driverPromise = null;
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
  paymentProvider: row.payment_provider ?? null,
  paymentReference: row.payment_reference ?? null,
  paymentMethodUsed: row.payment_method_used,
  razorpayPaymentId: row.razorpay_payment_id,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at ?? row.created_at).toISOString(),
});

/**
 * Shape sent to the browser. The order secret and the raw hash are stripped —
 * the secret only ever travels in the create response and the X-Order-Token
 * header. `paymentReference` is deliberately NOT stripped: it is the reference
 * the customer themselves submitted, and the confirmation screen shows it back
 * so they can check it. The admin-only verification metadata is stripped.
 */
export const toPublicOrder = (row) => {
  if (!row) return null;
  // Destructure by the *camelCase* names toCamel produces. Destructuring the
  // snake_case column names here would silently match nothing, leaving the full
  // Razorpay payment id in the payload and dropping the masked reference. The
  // verification fields are discarded on purpose: who confirmed a payment, and
  // when, is admin-only information.
  const {
    razorpayPaymentId,
    paymentVerifiedAt: _verifiedAt,
    paymentVerifiedBy: _verifiedBy,
    ...rest
  } = toCamel(row);
  return {
    ...rest,
    razorpayPaymentRef: razorpayPaymentId ? maskReference(razorpayPaymentId) : null,
  };
};

/**
 * Shape sent to the admin dashboard: everything, including customer contact and
 * delivery details and who verified a payment. Only ever produced by a route
 * that has already authenticated an admin session server-side.
 */
export const toAdminOrder = (row) => {
  if (!row) return null;
  const camel = toCamel(row);
  return {
    ...camel,
    razorpayOrderId: row.razorpay_order_id ?? null,
    paymentVerifiedAt: row.payment_verified_at
      ? new Date(row.payment_verified_at).toISOString()
      : null,
    paymentVerifiedBy: row.payment_verified_by ?? null,
  };
};

/**
 * Show enough of a gateway id for a customer to recognise it in their own bank
 * or gateway history, and nothing more. A gateway payment id can be treated as a
 * secret by some providers, so the prefix is deliberately not echoed back.
 */
const maskReference = (value) => `••••${String(value).slice(-6)}`;

/** Audit rows for the admin detail view. */
export const toAdminEvent = (row) => ({
  id: Number(row.id),
  orderId: row.order_ref,
  eventType: row.event_type,
  field: row.field,
  oldValue: row.old_value,
  newValue: row.new_value,
  actor: row.actor,
  note: row.note,
  metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata ?? {}),
  createdAt: new Date(row.created_at).toISOString(),
});

export const ORDER_DEFAULTS = {
  currency: CURRENCY,
  orderStatus: ORDER_STATUS.RECEIVED,
  paymentStatus: PAYMENT_STATUS.PENDING,
};

