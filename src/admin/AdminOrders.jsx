import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Bell,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
} from "../../shared/ordering.js";
import { deliveryAreaStatusLabel } from "../../shared/delivery.js";
import { actOnOrder, getOrder, listOrders } from "./api.js";
import NewOrderAlert from "./NewOrderAlert.jsx";
import { formatPrice, formatDateTime } from "./format.js";
import styles from "./AdminOrders.module.css";

/**
 * How often the dashboard asks the server for new orders.
 *
 * Fifteen seconds is frequent enough that a new order surfaces while someone is
 * looking at the screen, and slow enough that a forgotten open tab is not a
 * meaningful load on the API. The tab pauses when hidden, so a backgrounded
 * dashboard costs nothing.
 */
const POLL_MS = 15_000;
const PAGE_SIZE = 20;
const INITIAL_FILTER = "all";

/** Stable empty values, so referential equality holds while the first load runs. */
const EMPTY = [];
const EMPTY_COUNTS = {};
const EMPTY_SET = new Set();

export default function AdminOrders({ admin, busy: signOutBusy, onSignOut, onSessionExpired }) {
  const [listing, setListing] = useState(null);
  const [filter, setFilter] = useState(INITIAL_FILTER);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [seenIds, setSeenIds] = useState(() => new Set());
  /**
   * Orders that arrived while this dashboard was open and have not been opened.
   *
   * Separate from `seenIds` on purpose. `seenIds` exists so the sound does not
   * replay for history; "unseen" is a question about the human in front of the
   * screen. Merging them would mean the badge cleared itself the moment the poll
   * noticed an order — the exact moment the admin most needs to be told.
   */
  const [unreadIds, setUnreadIds] = useState(() => new Set());
  const [soundOn, setSoundOn] = useState(false);

  /**
   * A ref mirror of seenIds, so the polling interval and the fetch itself never
   * close over a stale set. Declared before `load` and written directly in its
   * success path, because the poll may run before React has committed the state
   * update from a load that only just finished.
   */
  const seenIdsRef = useRef(seenIds);
  useEffect(() => {
    seenIdsRef.current = seenIds;
  }, [seenIds]);

  const notifyRef = useRef(null);

  /**
   * Fetch one page of orders.
   *
   * `filter` and `page` are always passed in rather than read from state here.
   * A click that changes both the filter and the page then loads exactly the page
   * it asked for, instead of racing a state update that has not rendered yet.
   *
   * A 401 is treated as "sign in again" rather than an error worth showing.
   */
  const load = useCallback(
    async ({ filter: nextFilter, page: nextPage, quiet = false }) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await listOrders({
          filter: nextFilter,
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        setListing(data);
        setError(null);
        // Anything the admin has been shown is now "seen". Seeding on every
        // deliberate load — not only the first — is what stops a filter or page
        // change from making the next poll alert about rows already on screen.
        // A quiet load is the poll itself: seeding there would mark a genuinely
        // new order as seen before the tick could announce it, so it is skipped
        // and the tick does the adding.
        if (!quiet) {
          const next = new Set(seenIdsRef.current);
          for (const order of data.orders) next.add(order.orderId);
          seenIdsRef.current = next;
          setSeenIds(next);
        }
        return data;
      } catch (caught) {
        if (caught.status === 401) {
          onSessionExpired?.();
          return null;
        }
        setError(caught.message);
        return null;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onSessionExpired],
  );

  /* ------------------------------ first load ------------------------------ */

  // The dashboard has to ask the server once before it has anything to show.
  // This is the shape the rule flags, but not the problem it is warning about:
  // the state update is a response arriving over the network, not a value being
  // derived from props that render already had. Suppressed here rather than
  // project-wide, so the rule stays useful everywhere else.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    load({ filter: INITIAL_FILTER, page: 1 });
  }, [load]);

  /**
   * Filter and page changes load from the handler that caused them, not from an
   * effect watching the state. One path per user action, and `load` stops
   * changing identity every time a filter moves.
   */
  const applyFilter = (next) => {
    setFilter(next);
    setPage(1);
    load({ filter: next, page: 1 });
    // Choosing to look at the new-orders list IS the acknowledgement, so the
    // badge does not linger over a view that already shows them.
    if (next === "new") setUnreadIds(EMPTY_SET);
  };

  const goToPage = (next) => {
    setPage(next);
    load({ filter, page: next });
  };

  /* -------------------------------- polling ------------------------------- */

  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      const data = await load({ filter, page, quiet: true });
      if (!data) return;

      const fresh = data.orders.filter((order) => !seenIdsRef.current.has(order.orderId));
      if (fresh.length > 0) {
        const next = new Set(seenIdsRef.current);
        for (const order of fresh) next.add(order.orderId);
        seenIdsRef.current = next;
        setSeenIds(next);
        setUnreadIds((previous) => {
          const merged = new Set(previous);
          for (const order of fresh) merged.add(order.orderId);
          return merged.size === previous.size ? previous : merged;
        });
        notifyRef.current?.announce(fresh);
      }
    };

    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, filter, page]);

  /* ------------------------------- derived -------------------------------- */

  const orders = listing?.orders ?? EMPTY;
  const counts = listing?.counts ?? EMPTY_COUNTS;
  const notify = listing?.notify;

  /**
   * The server does not offer a free-text search endpoint, so this filters the
   * page in the browser and says so. Adding server-side search later means
   * changing this one function.
   *
   * `EMPTY` is a module constant rather than a fresh `?? []` so the array identity
   * is stable across renders and cannot retrigger the memo below.
   */
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) =>
      [order.orderId, order.customerName, order.phone, order.paymentReference]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [orders, search]);

  const needsAttention = visible.filter(
    (order) => order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED,
  ).length;

  const unreadCount = unreadIds.size;

  /* -------------------------------- actions ------------------------------- */

  const openOrder = async (orderId) => {
    setUnreadIds((previous) => {
      if (!previous.has(orderId)) return previous;
      const next = new Set(previous);
      next.delete(orderId);
      return next;
    });
    try {
      const detail = await getOrder(orderId);
      setSelected(detail);
    } catch (caught) {
      if (caught.status === 401) return onSessionExpired?.();
      setError(caught.message);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>JOC Orders</h1>
            {/*
              Counting orders the admin has not opened yet, using the poll that
              already runs — this badge costs no extra request. Clicking it goes
              to the New filter, which is where those orders can be worked.
            */}
            {unreadCount > 0 ? (
              <button
                type="button"
                className={styles.unreadBadge}
                onClick={() => applyFilter("new")}
                title={`${unreadCount} new order${unreadCount === 1 ? "" : "s"}`}
              >
                <Bell size={13} aria-hidden="true" />
                {unreadCount} new
              </button>
            ) : null}
          </div>
          <p className={styles.muted}>
            Signed in as {admin?.email}
            {needsAttention > 0 ? (
              <>
                {" • "}
                <strong className={styles.alert}>
                  {needsAttention} awaiting payment verification
                </strong>
              </>
            ) : null}
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setSoundOn((value) => !value)}
            aria-pressed={soundOn}
            title={soundOn ? "Mute new-order sound" : "Enable new-order sound"}
          >
            {soundOn ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
            <span className="visually-hidden">
              {soundOn ? "Mute new-order sound" : "Enable new-order sound"}
            </span>
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => load({ filter, page, quiet: true })}
            disabled={refreshing}
            title="Refresh"
          >
            <RefreshCw className={refreshing ? styles.spin : undefined} size={16} aria-hidden="true" />
            <span className="visually-hidden">Refresh</span>
          </button>
          <button type="button" className={styles.iconButton} onClick={onSignOut} disabled={signOutBusy}>
            <LogOut size={16} aria-hidden="true" />
            <span className="visually-hidden">Sign out</span>
          </button>
        </div>
      </header>

      <NewOrderAlert ref={notifyRef} enabled={soundOn} whatsappNumber={notify?.whatsappNumber} />

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.filters} role="tablist" aria-label="Filter orders">
          {Object.entries(COUNTS_KEYS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`${styles.filter} ${filter === key ? styles.filterActive : ""}`}
              onClick={() => applyFilter(key)}
            >
              {label}
              {counts[key] ? <span className={styles.badge}>{counts[key]}</span> : null}
            </button>
          ))}
        </div>

        <div className={styles.searchWrap}>
          <Search size={15} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="admin-search">
            Search this page by order id, name, phone or UTR
          </label>
          <input
            id="admin-search"
            className={styles.search}
            type="search"
            placeholder="Search this page…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {loading && !listing ? (
        <p className={styles.muted} role="status">
          <Loader2 className={styles.spin} size={16} aria-hidden="true" /> Loading orders…
        </p>
      ) : visible.length === 0 ? (
        <p className={styles.muted}>
          {search ? "No order on this page matches that search." : "No orders here yet."}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">
              Orders, newest first. Showing page {listing?.page} of {listing?.pageCount}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Placed</th>
                <th scope="col">Payment</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((order) => (
                <tr
                  key={order.orderId}
                  className={
                    order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED
                      ? styles.rowAttention
                      : undefined
                  }
                >
                  <td>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => openOrder(order.orderId)}
                    >
                      {order.orderId}
                    </button>
                    {order.paymentProvider ? (
                      <span className={styles.subtle}>{order.paymentProvider}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.strong}>{order.customerName}</span>
                    <span className={styles.subtle}>{order.phone}</span>
                  </td>
                  <td className={styles.nowrap}>{formatDateTime(order.createdAt)}</td>
                  <td>
                    <span className={styles.strong}>
                      {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
                    </span>
                    <span
                      className={`${styles.subtle} ${
                        order.paymentStatus === PAYMENT_STATUS.PAID ? styles.good : styles.warn
                      }`}
                    >
                      {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                    </span>
                    {order.paymentReference ? (
                      <span className={styles.mono}>{order.paymentReference}</span>
                    ) : null}
                  </td>
                  <td>{ORDER_STATUS_LABELS[order.orderStatus] ?? order.orderStatus}</td>
                  <td className={styles.nowrap}>{formatPrice(order.total)}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => openOrder(order.orderId)}
                      aria-label={`Open ${order.orderId}`}
                      title="Open order"
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {listing && listing.pageCount > 1 ? (
        <nav className={styles.pager} aria-label="Pagination">
          <button
            type="button"
            className={styles.iconButton}
            disabled={listing.page <= 1}
            onClick={() => goToPage(Math.max(1, listing.page - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className={styles.muted}>
            Page {listing.page} of {listing.pageCount} · {listing.total} orders
          </span>
          <button
            type="button"
            className={styles.iconButton}
            disabled={listing.page >= listing.pageCount}
            onClick={() => goToPage(listing.page + 1)}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}

      {selected ? (
        <OrderDrawer
          detail={selected}
          onClose={() => setSelected(null)}
          onAction={async (action, extra) => {
            try {
              const updated = await actOnOrder(selected.order.orderId, action, extra);
              setSelected(updated);
              // The list is now stale in exactly one way: the row we just changed.
              await load({ filter, page, quiet: true });
              return true;
            } catch (caught) {
              if (caught.status === 401) return onSessionExpired?.();
              setError(caught.message);
              return false;
            }
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------- filter keys ------------------------------ */

const COUNTS_KEYS = {
  all: "All",
  new: "New",
  verification: "Verify UTR",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/**
 * Ledger types, spelled the way an admin reads them.
 *
 * The stored values are machine tokens and are stable forever; these are free to
 * be reworded, so the dashboard never renders a raw `customer_status`.
 */
const NOTIFICATION_LABELS = {
  admin_new_order: "New order alert",
  customer_order_received: "Order received confirmation",
  customer_status: "Status update",
  customer_payment_verified: "Payment confirmed",
};

/* --------------------------------- drawer --------------------------------- */

function OrderDrawer({ detail, onClose, onAction }) {
  const { order, events, notifications, verification, whatsapp } = detail;
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (action, extra = {}) => {
    if (busy) return;
    setBusy(action);
    setLocalError(null);
    const ok = await onAction(action, extra);
    if (ok) setNote("");
    setBusy(null);
    return ok;
  };

  const transitions = ORDER_STATUS_TRANSITIONS[order.orderStatus] ?? [];
  const awaitingVerification =
    order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED;
  const paid = order.paymentStatus === PAYMENT_STATUS.PAID;

  return (
    <div className={styles.drawerBackdrop} onClick={onClose} role="presentation">
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.orderId}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>{order.orderId}</h2>
            <p className={styles.muted}>{formatDateTime(order.createdAt)}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close order"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {localError ? (
          <p className={styles.error} role="alert">
            {localError}
          </p>
        ) : null}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Customer</h3>
          <p>
            <strong>{order.customerName}</strong>
            <br />
            {order.phone}
            {order.customerEmail ? (
              <>
                <br />
                {order.customerEmail}
              </>
            ) : null}
            <br />
            {order.address}
            {order.landmark ? (
              <>
                <br />
                Landmark: {order.landmark}
              </>
            ) : null}
          </p>
          {order.specialInstructions ? (
            <p className={styles.subtle}>Note for us: {order.specialInstructions}</p>
          ) : null}
        </section>

        {/*
          What the customer agreed to, and what JOC still has to decide.

          This section is what the Confirm action is read against. There is no
          measured distance here any more, because nothing measures one — the admin
          sees the area the customer picked and their own confirmation, and judges
          the exact address themselves. An order with no area predates the list, and
          says so rather than being shown an empty field.
        */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Delivery area</h3>
          {order.deliveryArea ? (
            <>
              <p>
                <MapPin size={15} aria-hidden="true" />{" "}
                {order.deliveryAreaName ?? order.deliveryArea}
              </p>
              <p className={styles.subtle}>
                {deliveryAreaStatusLabel(order)} — confirm the address below before preparing
                this order.
              </p>
            </>
          ) : (
            <p className={styles.subtle}>
              No area recorded — this order was placed before JOC published a delivery-area list.
              Confirm the delivery address manually.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Items</h3>
          <ul className={styles.lines}>
            {order.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.name} × {item.qty}
                </span>
                <span>{formatPrice(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <p className={styles.totals}>
            <span>Subtotal</span>
            <span>{formatPrice(order.subtotal)}</span>
          </p>
          <p className={styles.totals}>
            <span>Delivery</span>
            <span>{order.deliveryCharge === 0 ? "To be confirmed" : formatPrice(order.deliveryCharge)}</span>
          </p>
          <p className={styles.totalsStrong}>
            <span>Total</span>
            <span>{formatPrice(order.total)}</span>
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Payment</h3>
          <p>
            {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
            {order.paymentProvider ? ` • ${order.paymentProvider}` : ""}
            <br />
            <strong>{PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}</strong>
          </p>

          {awaitingVerification && verification?.paymentReference ? (
            <div className={styles.verifyBox}>
              <p className={styles.verifyLead}>
                <Clock size={15} aria-hidden="true" />
                Check <span className={styles.mono}>{verification.paymentReference}</span> against
                JOC&apos;s bank or UPI records, then confirm it.
              </p>
              <label className="visually-hidden" htmlFor="verify-note">
                Verification note (optional)
              </label>
              <input
                id="verify-note"
                className={styles.input}
                type="text"
                placeholder="Note (optional) — e.g. seen in bank statement"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <button
                type="button"
                className={styles.primary}
                disabled={busy !== null}
                onClick={() => run("verifyPayment", { note: note.trim() || undefined })}
              >
                {busy === "verifyPayment" ? (
                  <Loader2 className={styles.spin} size={16} aria-hidden="true" />
                ) : (
                  <BadgeCheck size={16} aria-hidden="true" />
                )}
                Confirm payment received
              </button>
              <p className={styles.subtle}>
                    Only press this after the money is actually in the JOC account.
                  </p>
            </div>
          ) : null}

          {paid && order.paymentVerifiedAt ? (
            <p className={styles.subtle}>
              Verified {formatDateTime(order.paymentVerifiedAt)}
              {order.paymentVerifiedBy ? ` by ${order.paymentVerifiedBy}` : ""}
            </p>
          ) : null}

          {whatsapp ? (
            <a className={styles.secondary} href={whatsapp} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              Share on WhatsApp
            </a>
          ) : null}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Status
            <span className={styles.subtle}> · {ORDER_STATUS_LABELS[order.orderStatus]}</span>
          </h3>
          {transitions.length === 0 ? (
            <p className={styles.subtle}>
              This order has reached a final state, so its status cannot change.
            </p>
          ) : (
            <div className={styles.actions}>
              {transitions.map((next) => (
                <button
                  key={next}
                  type="button"
                  className={styles.secondary}
                  disabled={busy !== null}
                  onClick={() => run("setStatus", { status: next, note: note.trim() || undefined })}
                >
                  {busy === `setStatus:${next}` ? (
                    <Loader2 className={styles.spin} size={15} aria-hidden="true" />
                  ) : null}
                  Mark {ORDER_STATUS_LABELS[next] ?? next}
                </button>
              ))}
            </div>
          )}
        </section>

        {/*
          The send ledger. Present because the most common support question about
          an order is "did they get the message?", and the honest answer needs to be
          readable here. A row that says `failed` is the one worth acting on.
        */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <Mail size={15} aria-hidden="true" /> Notifications
          </h3>
          {!notifications || notifications.length === 0 ? (
            <p className={styles.subtle}>No messages were sent for this order.</p>
          ) : (
            <ol className={styles.timeline}>
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <span className={styles.timelineType}>{NOTIFICATION_LABELS[notification.type] ?? notification.type}</span>
                  <span className={styles.subtle}>
                    {notification.status === "sent"
                      ? `sent to ${notification.recipient} · ${formatDateTime(notification.sentAt ?? notification.createdAt)}`
                      : `${notification.status} · ${notification.recipient} · ${formatDateTime(notification.createdAt)}`}
                    {notification.attempts > 1 ? ` · ${notification.attempts} attempts` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>History</h3>
          {events.length === 0 ? (
            <p className={styles.subtle}>No recorded events yet.</p>
          ) : (
            <ol className={styles.timeline}>
              {events.map((event) => (
                <li key={event.id}>
                  <span className={styles.timelineType}>{event.eventType.replaceAll("_", " ")}</span>
                  <span className={styles.subtle}>
                    {formatDateTime(event.createdAt)} · {event.actor}
                    {event.oldValue && event.newValue
                      ? ` · ${event.oldValue} → ${event.newValue}`
                      : event.newValue
                        ? ` · ${event.newValue}`
                        : ""}
                  </span>
                  {event.note ? <span className={styles.subtle}>{event.note}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}
