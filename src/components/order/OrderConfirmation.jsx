import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Home,
  Loader2,
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
  PAYMENT_METHOD,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_USED_LABELS,
  PAYMENT_STATUS,
  customerPaymentState,
} from "../../../shared/ordering.js";
import { getOrderDetail } from "../../lib/api";
import { useOrderFlow, isBusy } from "../../lib/useOrderFlow";
import UpiPaymentPanel from "./UpiPaymentPanel";
import styles from "./OrderConfirmation.module.css";

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
 */
export default function OrderConfirmation({ orderId, initialOutcome, storageNotice, onSettled }) {
  const { clearCart } = useCart();
  const [order, setOrder] = useState(null);
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const headingRef = useRef(null);

  const flow = useOrderFlow({
    onComplete: ({ order: next, outcome, switchedToCod, payment: nextPayment }) => {
      setOrder(next);
      if (nextPayment) setPayment(nextPayment);
      onSettled?.({ order: next, outcome, switchedToCod });
    },
  });

  // Reload from the server: the truth lives there, and a refresh must not lose it.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getOrderDetail(orderId, { signal: controller.signal })
      .then((data) => {
        setOrder(data.order);
        setPayment(data.payment ?? null);
        setLoadError(null);
        if (data.order.paymentStatus === PAYMENT_STATUS.PAID || data.order.paymentMethod === PAYMENT_METHOD.COD) {
          clearCart();
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setLoadError(error.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // clearCart is stable; re-running on it would refetch on every cart change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

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
          </p>
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
        </div>
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
        {order.deliveryCharge === 0 ? DELIVERY_PENDING_LABEL : formatPrice(order.deliveryCharge)}
      </p>
    </div>
  );
}

const STATUS_LABELS = {
  PENDING: "Pending",
  PAYMENT_VERIFICATION_REQUIRED: "Awaiting our confirmation",
  PAID: "Paid",
  FAILED: "Not completed",
  REFUNDED: "Refunded",
  RECEIVED: "Received",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

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

const statusLabel = (status) => STATUS_LABELS[status] ?? status;
