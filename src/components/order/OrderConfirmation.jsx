import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Home,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { useCart } from "../../cart/cartStore";
import { formatPrice } from "../../data/menu";
import {
  CUSTOMER_PAYMENT_STATE,
  DELIVERY_LABEL,
  DELIVERY_PENDING_LABEL,
  ORDER_STATUS,
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_USED_LABELS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
  customerPaymentState,
} from "../../../shared/ordering.js";
import { DELIVERY_AREA_PENDING_NOTE } from "../../../shared/delivery.js";
import { whatsappUrl } from "../../data/business";
import { getOrderDetail } from "../../lib/api";
import { useOrderFlow, isBusy } from "../../lib/useOrderFlow";
import UpiPaymentPanel from "./UpiPaymentPanel";
import styles from "./OrderConfirmation.module.css";

/**
 * How often an unfinished order re-reads its status.
 *
 * 30s, not 5s. This page is usually left open by a customer waiting for a juice
 * shop to start making their order, and the status changes a handful of times over
 * tens of minutes — polling every 5s would spend a serverless invocation every
 * five seconds to learn "still preparing". A manual Refresh sits right next to it
 * for the customer who wants to know right now.
 *
 * Polling STOPS once the order reaches a terminal state. An open tab on a
 * delivered order has nothing left to learn, and an idle poll forever is how a
 * cheap feature quietly becomes an expensive one.
 */
const POLL_MS = 30_000;

const TERMINAL_STATUSES = new Set([ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED]);

/**
 * One screen covers every terminal state of an order:
 *
 *   placed   — cash on delivery, or a UPI payment the admin has verified
 *   awaiting — a UPI order whose payment has not been made yet
 *   verifying— a UTR has been submitted and JOC is confirming it
 *   failed   — the payment did not complete, with retry and switch-to-COD
 *   cancelled— the customer closed the payment window, same two options
 *
 * It reloads the order from the server on mount, so a refresh here is safe and
 * the status shown is always the server's, never a leftover browser state.
 *
 * It doubles as the guest TRACKING page. `token` arrives from an emailed
 * `#/order/<id>?t=<token>` link, so a customer can follow their order from any
 * device without an account — while the proof of ownership stays the same
 * per-order secret, checked against a hash in constant time.
 */
export default function OrderConfirmation({
  orderId,
  token,
  initialOutcome,
  storageNotice,
  onSettled,
}) {
  const { clearCart } = useCart();
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  /** A failed manual refresh only. Cleared by the next attempt. */
  const [refreshError, setRefreshError] = useState(null);
  const headingRef = useRef(null);

  const flow = useOrderFlow({
    onComplete: ({ order: next, outcome, switchedToCod, payment: nextPayment }) => {
      setOrder(next);
      if (nextPayment) setPayment(nextPayment);
      onSettled?.({ order: next, outcome, switchedToCod });
    },
  });

  /**
   * One loader, used by the mount, the manual refresh and the poll.
   *
   * `quiet` is what separates a background poll from a customer-visible action:
   * a poll must never blank the page or spin a spinner, or the screen would flash
   * every 30 seconds. Only the first load and a manual refresh show progress.
   */
  const load = useCallback(
    async ({ signal, quiet = false } = {}) => {
      if (!quiet) setRefreshing(true);
      try {
        const data = await getOrderDetail(orderId, { signal, token });
        setOrder(data.order);
        setPayment(data.payment ?? null);
        setLoadError(null);
        if (
          data.order.paymentStatus === PAYMENT_STATUS.PAID ||
          data.order.paymentMethod === PAYMENT_METHOD.COD
        ) {
          clearCart();
        }
        return data.order;
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [orderId, token, clearCart],
  );

  /**
   * The customer pressed Refresh, so a failure here IS their problem and is worth
   * one quiet line — unlike a background poll, which fails silently. The order on
   * screen is left exactly as it was: a stale status beats no status, and the
   * server's answer is still the one that counts.
   */
  const refresh = () => {
    setRefreshError(null);
    load().catch((error) => {
      if (error.name === "AbortError") return;
      setRefreshError(error.message);
    });
  };

  // Reload from the server: the truth lives there, and a refresh must not lose it.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load({ signal: controller.signal })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setLoadError(error.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // clearCart is stable; re-running on it would refetch on every cart change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /**
   * Live status, while the order is still in progress.
   *
   * The interval is not left running for a delivered or cancelled order, and a
   * failed poll is swallowed rather than surfaced — a tracking page that shouts
   * "could not reach JOC" because one request timed out is worse than one that
   * quietly tries again in 30 seconds.
   */
  useEffect(() => {
    if (!order || TERMINAL_STATUSES.has(order.orderStatus)) return undefined;

    const timer = setInterval(() => {
      const controller = new AbortController();
      load({ signal: controller.signal, quiet: true }).catch(() => {
        /* offline, or the tab was backgrounded — the next tick tries again */
      });
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [order, load]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [loading]);

  if (loading && !order) {
    return (
      <Shell>
        <div className={styles.loading} role="status">
          <Loader2 className={styles.spin} size={22} aria-hidden="true" />
          Loading your order…
        </div>
      </Shell>
    );
  }

  if (!order) {
    return (
      <Shell>
        <div className={styles.panel}>
          <span className={`${styles.mark} ${styles.markWarn}`} aria-hidden="true">
            <CircleSlash size={28} />
          </span>
          <h1 className={styles.title} tabIndex={-1} ref={headingRef}>
            We could not find that order
          </h1>
          <p className={styles.lead}>
            {loadError ??
              "Order details are kept on the device that placed them. Open the link on the same device, or call JOC and quote your order id."}
          </p>
          <div className={styles.actions}>
            <a className="btn btn--primary" href="#menu">
              <ShoppingBag size={17} aria-hidden="true" />
              Back to the menu
            </a>
            {/* The order id is in the URL even when the lookup failed, so it is
                the one useful thing this page can hand over. No tracking token
                is ever put in a WhatsApp message. */}
            <a
              className="btn btn--whatsapp"
              href={whatsappUrl(`Hello JOC, I need help with my order ${orderId}.`)}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={17} aria-hidden="true" />
              WhatsApp Us
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  const paid = order.paymentStatus === PAYMENT_STATUS.PAID;
  const cod = order.paymentMethod === PAYMENT_METHOD.COD;
  const failed = order.paymentStatus === PAYMENT_STATUS.FAILED;
  const awaitingPayment =
    order.paymentMethod === PAYMENT_METHOD.UPI && order.paymentStatus === PAYMENT_STATUS.PENDING;
  const outcome = initialOutcome;
  const state = customerPaymentState(order);
  const copy = CUSTOMER_COPY[state] ?? CUSTOMER_COPY[CUSTOMER_PAYMENT_STATE.ORDER_RECEIVED];

  if (failed) {
    return (
      <Shell>
        <div className={styles.panel}>
          <span className={`${styles.mark} ${styles.markWarn}`} aria-hidden="true">
            <AlertTriangle size={28} />
          </span>
          <h1 className={styles.title} tabIndex={-1} ref={headingRef}>
            {outcome?.status === "cancelled" ? "Payment was cancelled" : "Payment could not be completed"}
          </h1>
          <p className={styles.lead}>
            {outcome?.description ??
              "Your payment was not confirmed, so nothing has been charged. Your order is saved — you can try again or pay cash on delivery."}
          </p>

          <dl className={styles.facts}>
            <div>
              <dt>Order ID</dt>
              <dd>{order.orderId}</dd>
            </div>
            <div>
              <dt>Payment status</dt>
              <dd>{statusLabel(order.paymentStatus)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatPrice(order.total)}</dd>
            </div>
          </dl>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => flow.retryPayment(order.orderId)}
              disabled={isBusy(flow.flow)}
              aria-busy={isBusy(flow.flow)}
            >
              {isBusy(flow.flow) ? (
                <Loader2 className={styles.spin} size={17} aria-hidden="true" />
              ) : (
                <RefreshCw size={17} aria-hidden="true" />
              )}
              Try Payment Again
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => flow.switchToCod(order.orderId)}
              disabled={isBusy(flow.flow)}
            >
              <Wallet size={17} aria-hidden="true" />
              Change to Cash on Delivery
            </button>
            <a className="btn btn--ghost" href="#/cart">
              <ShoppingBag size={17} aria-hidden="true" />
              Return to Cart
            </a>
            <a
              className="btn btn--whatsapp"
              href={whatsappUrl(
                `Hello JOC, I need help with my order ${order.orderId} (payment not completed).`,
              )}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={17} aria-hidden="true" />
              WhatsApp Us
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className={styles.panel}>
        <span
          className={`${styles.mark} ${
            paid || cod || !awaitingPayment ? styles.markGood : styles.markWarn
          }`}
          aria-hidden="true"
        >
          {awaitingPayment ? <Wallet size={30} /> : <Check size={30} />}
        </span>

        <h1 className={styles.title} tabIndex={-1} ref={headingRef}>
          {awaitingPayment ? "Order Placed — Complete Your Payment" : copy.title}
        </h1>
        <p className={styles.lead}>{awaitingPayment ? copy.lead : copy.lead}</p>

        <dl className={styles.facts}>
          <div>
            <dt>Order ID</dt>
            <dd className={styles.orderId}>{order.orderId}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>
              {cod
                ? PAYMENT_METHOD_LABELS.COD
                : PAYMENT_METHOD_USED_LABELS[order.paymentMethodUsed] ??
                  PAYMENT_METHOD_LABELS.UPI}
            </dd>
          </div>
          <div>
            <dt>Payment status</dt>
            <dd>{statusLabel(order.paymentStatus)}</dd>
          </div>
          <div>
            <dt>Order status</dt>
            <dd>{statusLabel(order.orderStatus)}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{formatPrice(order.total)}</dd>
          </div>
        </dl>

        {/* The live view of an order in progress. This is what makes the emailed
            tracking link worth having: a customer can see where their order has
            got to without messaging the shop. */}
        <OrderTimeline order={order} />

        {awaitingPayment ? (
          <UpiPaymentPanel
            order={order}
            payment={payment}
            onSubmitted={(next) => setOrder(next)}
          />
        ) : null}

        <OrderLines order={order} />

        <div className={styles.address}>
          <h2>Delivering to</h2>
          <p>
            {order.customerName}
            <br />
            {order.address}
            {order.landmark ? (
              <>
                <br />
                Landmark: {order.landmark}
              </>
            ) : null}
            <br />
            <span className={styles.phone}>
              <Phone size={14} aria-hidden="true" />
              {order.phone}
            </span>
            {/*
             * Only shown when the customer actually gave one. Echoing their own
             * address back is useful for the tracking use case; inventing an
             * empty-looking row for the many orders without one would not be.
             */}
            {order.customerEmail ? (
              <span className={styles.phone}>
                <Mail size={14} aria-hidden="true" />
                {order.customerEmail}
              </span>
            ) : null}
          </p>
          {/*
           * The area the customer chose and their own confirmation of the address.
           *
           * No distance is shown because none exists: nothing measured the address.
           * The wording below says the confirmation is still pending, which is the
           * honest state — the customer's acknowledgement is on the order, and JOC
           * confirms the address before preparing it.
           */}
          {order.deliveryArea ? (
            <p className={styles.distance}>
              <MapPin size={14} aria-hidden="true" />
              {order.deliveryAreaName ?? order.deliveryArea}
              {order.deliveryAreaConfirmed === true
                ? " · address confirmed by you"
                : " · confirmation pending"}
            </p>
          ) : null}
          {order.deliveryArea ? (
            <p className={styles.instructions}>{DELIVERY_AREA_PENDING_NOTE}</p>
          ) : null}
          {order.specialInstructions ? (
            <p className={styles.instructions}>
              <span>Note for us:</span> {order.specialInstructions}
            </p>
          ) : null}
        </div>

        {order.paymentMethodUsed === "razorpay_test" ? (
          <p className={styles.notice}>
            This was a <strong>TEST payment</strong> in the development playground — no real money
            was charged.
          </p>
        ) : null}

        {storageNotice ? <p className={styles.notice}>{storageNotice}</p> : null}

        <div className={styles.actions}>
          <a className="btn btn--primary btn--lg" href="#home" onClick={() => clearCart()}>
            <Home size={18} aria-hidden="true" />
            Back to Home
          </a>
          {/*
           * Offered while the order can still change. For a delivered order the
           * button would do nothing, so it is removed rather than left as a
           * control that lies about its effect.
           */}
          {!TERMINAL_STATUSES.has(order.orderStatus) ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={refresh}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              <RefreshCw className={refreshing ? styles.spin : undefined} size={17} aria-hidden="true" />
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
          ) : null}
          {/* The order id travels in the message, never the tracking token. */}
          <a
            className="btn btn--whatsapp"
            href={whatsappUrl(`Hello JOC, I need help with my order ${order.orderId}.`)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={17} aria-hidden="true" />
            WhatsApp Us
          </a>
        </div>

        {refreshError ? (
          <p className={styles.notice} role="status">
            {refreshError} The status above is the last one we could load.
          </p>
        ) : null}
      </div>
    </Shell>
  );
}

/* --------------------------------- pieces -------------------------------- */

function Shell({ children }) {
  return (
    <section className={`section ${styles.page}`} aria-labelledby="order-status">
      <div className={`container ${styles.wrap}`}>
        <h2 id="order-status" className="visually-hidden">
          Order status
        </h2>
        {children}
      </div>
    </section>
  );
}

function OrderLines({ order }) {
  if (!Array.isArray(order.items) || order.items.length === 0) return null;
  return (
    <div className={styles.items}>
      <h2>Your items</h2>
      <ul>
        {order.items.map((line) => (
          <li key={line.id}>
            <span>
              {line.name} <span className={styles.qty}>× {line.qty}</span>
            </span>
            <span>{formatPrice(line.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <p className={styles.itemTotals}>
        Subtotal {formatPrice(order.subtotal)} · {DELIVERY_LABEL}{" "}
        {order.deliveryCharge > 0 ? formatPrice(order.deliveryCharge) : DELIVERY_PENDING_LABEL}
      </p>
      <p className={styles.itemTotal}>
        Total <strong>{formatPrice(order.total)}</strong>
      </p>
    </div>
  );
}

/**
 * The order's progress through the lifecycle.
 *
 * Derived entirely from `order.orderStatus` — the server's value — rather than
 * from a log of transitions the browser remembers. A customer who opens this page
 * halfway through, on a new device, sees the same timeline as one who never closed
 * the tab, because there is only one source and it is not in the browser.
 *
 * A CANCELLED order gets its own single-step timeline instead of a row of
 * unticked circles: showing "Received ✓ Preparing ○ Ready ○ …" for an order that
 * will never be prepared is a small, unnecessary lie.
 */
function OrderTimeline({ order }) {
  if (order.orderStatus === ORDER_STATUS.CANCELLED) {
    return (
      <div className={styles.timeline}>
        <h2>Order progress</h2>
        <p className={styles.timelineCancelled}>
          <CircleSlash size={15} aria-hidden="true" />
          This order was cancelled.
        </p>
      </div>
    );
  }

  const steps = ORDER_STATUS_FLOW;
  const reached = steps.indexOf(order.orderStatus);

  return (
    <div className={styles.timeline}>
      <h2>Order progress</h2>
      <ol>
        {steps.map((step, index) => {
          const done = reached > index;
          const current = reached === index;
          return (
            <li
              key={step}
              className={done ? styles.stepDone : current ? styles.stepCurrent : styles.stepTodo}
              aria-current={current ? "step" : undefined}
            >
              <span className={styles.stepDot} aria-hidden="true">
                {done ? <Check size={12} /> : index + 1}
              </span>
              <span className={styles.stepLabel}>{STATUS_LABELS[step]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Customer-facing status wording.
 *
 * Built from the shared tables so a status added server-side still renders here,
 * with one override: "Verification required" is admin phrasing, and the customer
 * reading it is waiting to find out whether their money arrived. The raw value is
 * the last resort, never a blank.
 */
const STATUS_LABELS = {
  ...PAYMENT_STATUS_LABELS,
  ...ORDER_STATUS_LABELS,
  [PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED]: "Awaiting our confirmation",
};

const statusLabel = (status) => STATUS_LABELS[status] ?? status;

/**
 * Headline copy, keyed by the shared customer-facing state.
 *
 * The wording is deliberately careful about the one thing that must never be
 * ambiguous: a submitted UTR is *not* a paid order. The customer is told it is
 * being checked, and that they need do nothing further.
 */
const CUSTOMER_COPY = {
  [CUSTOMER_PAYMENT_STATE.ORDER_RECEIVED]: {
    title: "Order Placed Successfully!",
    lead: "Thank you for ordering from JOC. We will prepare your order shortly.",
  },
  [CUSTOMER_PAYMENT_STATE.AWAITING_PAYMENT]: {
    title: "Order Placed — Complete Your Payment",
    lead: "Thank you for ordering from JOC. Your order is saved — please pay the exact amount by UPI below and submit your UTR so we can confirm it.",
  },
  [CUSTOMER_PAYMENT_STATE.VERIFICATION_REQUIRED]: {
    title: "Order Placed — Verifying Your Payment",
    lead: "Thank you for ordering from JOC. We have your UTR and are checking it against our records. You do not need to do anything else.",
  },
  [CUSTOMER_PAYMENT_STATE.VERIFIED]: {
    title: "Order Placed Successfully!",
    lead: "Thank you for ordering from JOC. Your payment is confirmed and we will prepare your order shortly.",
  },
  [CUSTOMER_PAYMENT_STATE.FAILED]: {
    title: "Payment could not be completed",
    lead: "Your payment was not confirmed, so nothing has been charged. Your order is saved — you can try again or pay cash on delivery.",
  },
  [CUSTOMER_PAYMENT_STATE.CANCELLED]: {
    title: "Payment was cancelled",
    lead: "You closed the payment window. Your order is saved — you can try again or pay cash on delivery.",
  },
};
