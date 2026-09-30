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

/**
 * How many times one notification may be attempted before it is left alone.
 *
 * Bounded on purpose. An unbounded retry turns a misconfigured Resend key into a
 * per-status-change attempt storm against an API that will reject every one of
 * them, and a customer flipping their order through six statuses would multiply
 * that. Three is enough to ride out a transient network blip; after that the row
 * is an operator problem, which is where it belongs.
 */
export const NOTIFICATION_MAX_ATTEMPTS = 3;

/** How long a claimed-but-unresolved notification stays owned by its claimer. */
export const NOTIFICATION_LEASE_SECONDS = 60;

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
           idempotency_key, access_hash, customer_name, phone, customer_email,
           address, landmark, special_instructions,
           delivery_distance_meters, delivery_radius_km, delivery_eligible,
           delivery_outcome, delivery_checked_at,
           tracking_token,
           items, subtotal, delivery_charge, total, currency,
           payment_method, payment_status, order_status, payment_provider
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23)
         on conflict (idempotency_key) do nothing
         returning *`,
        [
          idempotencyKey,
          hashAccessToken(record.accessToken),
          record.customerName,
          record.phone,
          record.customerEmail ?? null,
          record.address,
          record.landmark,
          record.specialInstructions,
          // The verification the caller already performed. Stored so an admin can
          // see that an address was checked and how far it measured, and so a
          // later change to the radius cannot silently reinterpret an old order.
          record.delivery?.distanceMeters ?? null,
          record.delivery?.radiusKm ?? null,
          record.delivery?.eligible ?? null,
          record.delivery?.outcome ?? null,
          record.delivery?.checkedAt ?? null,
          record.trackingToken ?? null,
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
        const { rows: updatedRows } = await run(
          `update joc_orders
              set order_id = $1
            where id = $2
            returning *`,
          [formatOrderId(rows[0].created_at, rows[0].order_seq), rows[0].id],
        );
        const order = updatedRows[0];
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

    /**
     * Look up an order by its idempotency key, before any expensive work.
     *
     * The order route calls this FIRST, before the delivery check. A retry of a
     * request that already succeeded is a customer refreshing the page or a
     * network re-sending — neither is a new order, and neither should cost two
     * Google calls or, worse, be refused because the address has drifted out of
     * range since the order was placed. A customer's already-placed order is
     * never invalidated by a later check of the same address.
     */
    async findByIdempotencyKey(idempotencyKey) {
      const { rows } = await run(
        `select * from joc_orders where idempotency_key = $1 limit 1`,
        [idempotencyKey],
      );
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

    /* ---------------------------- notifications ----------------------------- */

    /**
     * Claim the right to send one notification, or report that someone else
     * already has.
     *
     * The insert IS the lock. The unique constraint on
     * (order_uuid, notification_type, dedupe_key) means exactly one caller can
     * win this insert; every concurrent loser gets zero rows back and is told
     * not to send. That is what makes a duplicated order request, a second
     * serverless instance, or an admin page refresh unable to produce a second
     * email — without a lock table, a distributed mutex, or a queue.
     *
     * A previously FAILED row is taken over rather than left to block forever, so
     * a transport blip does not permanently silence a notification. Retries are
     * bounded by MAX_ATTEMPTS, so a genuinely broken configuration produces a
     * small, bounded number of attempts rather than a retry storm.
     *
     * A 'sent' or 'skipped' row is never taken over. 'skipped' means the decision
     * was deliberate — the customer gave no email address — and re-asking on every
     * status change would be pure noise.
     */
    async claimNotification({
      orderUuid,
      orderRef,
      type,
      dedupeKey,
      recipient,
      leaseSeconds = 60,
    }) {
      const { rows } = await run(
        `insert into joc_notifications (
           order_uuid, order_ref, notification_type, dedupe_key, recipient, lease_until, attempts
         ) values ($1,$2,$3,$4,$5, now() + make_interval(secs => $6), 1)
         on conflict (order_uuid, notification_type, dedupe_key) do nothing
         returning *`,
        [orderUuid, orderRef, type, dedupeKey, recipient, leaseSeconds],
      );
      if (rows.length > 0) return { claimed: true, notification: rows[0] };

      // Conflict. Either it is already finished, it is in flight, or a previous
      // attempt failed and may be retried — decided in one statement so two
      // racing retries cannot both take over.
      const taken = await run(
        `update joc_notifications
            set status       = 'pending',
                attempts     = attempts + 1,
                last_error   = null,
                lease_until  = now() + make_interval(secs => $5),
                updated_at   = now()
          where id = (
                  select id from joc_notifications
                   where order_uuid = $1
                     and notification_type = $2
                     and dedupe_key = $3
                     and (
                       status = 'failed'
                       or (status = 'pending' and lease_until < now())
                     )
                     and attempts < $4
                 )
          returning *`,
        [orderUuid, type, dedupeKey, NOTIFICATION_MAX_ATTEMPTS, leaseSeconds],
      );
      if (taken.rows.length > 0) return { claimed: true, notification: taken.rows[0] };

      const current = await run(
        `select status from joc_notifications
          where order_uuid = $1 and notification_type = $2 and dedupe_key = $3 limit 1`,
        [orderUuid, type, dedupeKey],
      );
      return { claimed: false, status: current.rows[0]?.status ?? "sent" };
    },

    /** Resolve a claim. Only a row this caller owns can be resolved. */
    async completeNotification(id, status, error = null) {
      const { rows } = await run(
        `update joc_notifications
            set status     = $2,
                last_error = $3,
                sent_at    = case when $2 = 'sent' then now() else sent_at end,
                updated_at = now()
          where id = $1 and status = 'pending'
          returning *`,
        [id, status, error === null ? null : String(error).slice(0, 500)],
      );
      return rows[0] ?? null;
    },

    /** Audit view for the admin drawer: what has actually gone out. */
    async listNotifications(orderUuid) {
      const { rows } = await run(
        `select id, notification_type, dedupe_key, recipient, status, attempts,
                sent_at, created_at
           from joc_notifications
          where order_uuid = $1
          order by created_at, id`,
        [orderUuid],
      );
      return rows;
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
  customer_email: record.customerEmail ?? null,
  address: record.address,
  landmark: record.landmark,
  special_instructions: record.specialInstructions,
  delivery_distance_meters: record.delivery?.distanceMeters ?? null,
  delivery_radius_km: record.delivery?.radiusKm ?? null,
  delivery_eligible: record.delivery?.eligible ?? null,
  delivery_outcome: record.delivery?.outcome ?? null,
  delivery_checked_at: record.delivery?.checkedAt ?? null,
  tracking_token: record.trackingToken ?? null,
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
  const notifications = new Map(); // id -> row
  let sequence = 0;
  let notificationSequence = 0;

  /**
   * The same claim/complete contract as the Postgres driver, against a Map.
   *
   * Mirrored rather than approximated so the local demo exercises the real code
   * path in api/_lib/notify.js. Single-threaded JS makes the "conflicting" branch
   * unreachable here, which is exactly the point: the memory driver can only ever
   * take the winning branch, so a bug in the loser branch cannot hide behind a
   * green local run.
   */
  const notificationKey = (orderUuid, type, dedupeKey) => `${orderUuid}|${type}|${dedupeKey}`;

  const claimNotification = async ({
    orderUuid,
    orderRef,
    type,
    dedupeKey,
    recipient,
    leaseSeconds = NOTIFICATION_LEASE_SECONDS,
  }) => {
    const key = notificationKey(orderUuid, type, dedupeKey);
    const existing = notifications.get(key);
    const now = Date.now();

    if (existing) {
      const leaseExpired =
        existing.status === "pending" &&
        new Date(existing.lease_until).getTime() <= now;
      const retryable =
        existing.status === "failed" || leaseExpired;
      if (!retryable || existing.attempts >= NOTIFICATION_MAX_ATTEMPTS) {
        return { claimed: false, status: existing.status };
      }
      existing.status = "pending";
      existing.attempts += 1;
      existing.last_error = null;
      existing.lease_until = new Date(now + leaseSeconds * 1000).toISOString();
      return { claimed: true, notification: existing };
    }

    notificationSequence += 1;
    const row = {
      id: notificationSequence,
      order_uuid: orderUuid,
      order_ref: orderRef,
      notification_type: type,
      dedupe_key: dedupeKey,
      recipient,
      provider: "resend",
      status: "pending",
      attempts: 1,
      last_error: null,
      lease_until: new Date(now + leaseSeconds * 1000).toISOString(),
      sent_at: null,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    };
    notifications.set(key, row);
    return { claimed: true, notification: row };
  };

  const completeNotification = async (id, status, error = null) => {
    for (const row of notifications.values()) {
      if (row.id !== id || row.status !== "pending") continue;
      row.status = status;
      row.last_error = error === null ? null : String(error).slice(0, 500);
      if (status === "sent") row.sent_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      return row;
    }
    return null;
  };

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

    async findByIdempotencyKey(idempotencyKey) {
      const orderId = byKey.get(idempotencyKey);
      return orderId ? (orders.get(orderId) ?? null) : null;
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

    claimNotification,
    completeNotification,

    async listNotifications(orderUuid) {
      return [...notifications.values()]
        .filter((row) => row.order_uuid === orderUuid)
        .sort((a, b) => a.id - b.id);
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

/**
 * Row -> camelCase.
 *
 * `tracking_token` is DELIBERATELY ABSENT. It is the order secret in plaintext,
 * kept only so an emailed tracking link can be built hours later. It is not part
 * of the camelCase shape at all, which means it cannot leak through
 * `toPublicOrder`, `toAdminOrder`, a spread, or any future field that forgets to
 * strip it — the one function that reads the column is the notification code,
 * which needs it for exactly one purpose. Omitting it here is the strongest form
 * of the guarantee: there is no list to maintain.
 */
const toCamel = (row) => ({
  id: row.id,
  orderId: row.order_id,
  orderSeq: Number(row.order_seq),
  customerName: row.customer_name,
  phone: row.phone,
  customerEmail: row.customer_email ?? null,
  address: row.address,
  landmark: row.landmark,
  specialInstructions: row.special_instructions,
  /**
   * The verification the server performed before creating this order.
   *
   * Grouped and always present, so the UI never has to test five flat fields to
   * learn whether an address was checked. `verified: false` with nulls is the
   * honest reading for an order placed before the rule existed.
   */
  delivery: {
    verified: row.delivery_checked_at !== null && row.delivery_checked_at !== undefined,
    outcome: row.delivery_outcome ?? null,
    eligible: row.delivery_eligible ?? null,
    distanceMeters: row.delivery_distance_meters ?? null,
    radiusKm: row.delivery_radius_km === null || row.delivery_radius_km === undefined
      ? null
      : Number(row.delivery_radius_km),
    checkedAt: row.delivery_checked_at
      ? new Date(row.delivery_checked_at).toISOString()
      : null,
  },
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
 * The one sanctioned reader of `tracking_token`.
 *
 * Server-side only, and it returns the token to nobody but the notification
 * composer. There is deliberately no public or admin shape that reaches it — see
 * toCamel above. Rotation is the revocation story: overwrite this column and
 * every tracking link sent so far stops working at once.
 */
export const readTrackingToken = (row) => row?.tracking_token ?? null;

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

/**
 * Notification ledger rows for the admin drawer.
 *
 * The recipient is masked, and deliberately not left as-is: an admin looking at
 * "what was sent for this order" needs to know a message went to the customer's
 * address, not to read it. The masking makes the common case obvious while
 * keeping the column a phone number, so a dashboard full of e-mail addresses is
 * not a new copy of the customer list.
 */
export const toAdminNotification = (row) => ({
  id: Number(row.id),
  type: row.notification_type,
  dedupeKey: row.dedupe_key,
  recipient: maskEmail(row.recipient),
  status: row.status,
  attempts: Number(row.attempts ?? 0),
  sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),
});

/** e.g. `r•••••@gmail.com` — enough to recognise, not enough to harvest. */
const maskEmail = (value) => {
  const [local, domain] = String(value ?? "").split("@");
  if (!domain) return "—";
  return `${local.slice(0, 1)}•••••@${domain}`;
};

export const ORDER_DEFAULTS = {
  currency: CURRENCY,
  orderStatus: ORDER_STATUS.RECEIVED,
  paymentStatus: PAYMENT_STATUS.PENDING,
};

