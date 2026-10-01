import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, MessageCircle } from "lucide-react";
import { useCustomer } from "./AuthProvider";
import NotificationToggle from "./NotificationToggle";
import { loginHref, myOrdersHref } from "./accountRoute";
import { getMyOrders, adoptOrderToken } from "../lib/api";
import { orderTrackingHref } from "../lib/route";
import { whatsappUrl } from "../data/business";
import { formatPrice } from "../data/menu";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_PROVIDER_LABELS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABELS,
} from "../../shared/ordering.js";
import styles from "./account.module.css";

const formatWhen = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

function StatusBadges({ order }) {
  const paid = order.paymentStatus === PAYMENT_STATUS.PAID;
  const needsVerification = order.paymentStatus === PAYMENT_STATUS.PAYMENT_VERIFICATION_REQUIRED;
  return (
    <div className={styles.badges}>
      <span className={styles.badge}>{ORDER_STATUS_LABELS[order.orderStatus] ?? order.orderStatus}</span>
      <span
        className={`${styles.badge} ${paid ? styles.badgePaid : ""} ${
          needsVerification ? styles.badgeWarn : ""
        }`}
      >
        {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
      </span>
      <span className={styles.badge}>
        {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
      </span>
    </div>
  );
}

function OrderCard({ order }) {
  const viewOrder = () => {
    if (!order.trackingToken) return;
    // Store the owner-only secret, then reuse the existing tracking screen.
    adoptOrderToken(order.orderId, order.trackingToken);
    window.location.assign(`/${orderTrackingHref(order.orderId, order.trackingToken)}`);
  };

  return (
    <li className={styles.orderCard}>
      <div className={styles.orderHead}>
        <span className={styles.orderId}>{order.orderId}</span>
        <span className={styles.orderDate}>{formatWhen(order.createdAt)}</span>
      </div>

      <StatusBadges order={order} />

      <ul className={styles.orderItems}>
        {(order.items ?? []).map((item, index) => (
          <li key={`${order.orderId}-${item.id ?? index}`}>
            <span>
              {item.name ?? item.id} × {item.qty}
            </span>
            <span>{formatPrice(item.lineTotal ?? 0)}</span>
          </li>
        ))}
      </ul>

      <dl className={styles.totals}>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatPrice(order.subtotal ?? 0)}</dd>
        </div>
        <div>
          <dt>Delivery charge</dt>
          <dd>{order.deliveryCharge > 0 ? formatPrice(order.deliveryCharge) : "To be confirmed"}</dd>
        </div>
        <div className={styles.grand}>
          <dt>Total</dt>
          <dd>{formatPrice(order.total ?? 0)}</dd>
        </div>
      </dl>

      <div className={styles.detailGrid}>
        {order.deliveryAreaName ? (
          <span>
            <strong>Area:</strong> {order.deliveryAreaName}
          </span>
        ) : null}
        <span>
          <strong>Address:</strong> {order.address}
        </span>
        {order.landmark ? (
          <span>
            <strong>Landmark:</strong> {order.landmark}
          </span>
        ) : null}
        {order.specialInstructions ? (
          <span>
            <strong>Instructions:</strong> {order.specialInstructions}
          </span>
        ) : null}
        <span>
          <strong>Payment:</strong>{" "}
          {order.paymentProvider
            ? PAYMENT_PROVIDER_LABELS[order.paymentProvider] ?? order.paymentProvider
            : PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
        </span>
      </div>

      <div className={styles.orderFoot}>
        {order.trackingToken ? (
          <button type="button" className="btn btn--primary" onClick={viewOrder}>
            View Order
          </button>
        ) : (
          <span />
        )}
        {/* Help is offered on every order, not only ones with a live tracking
            token, and always names the order id so the conversation has context.
            The tracking token is deliberately never included. */}
        <a
          className="btn btn--whatsapp"
          href={whatsappUrl(`Hello JOC, I need help with my order ${order.orderId}.`)}
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle size={16} aria-hidden="true" />
          WhatsApp Help
        </a>
      </div>
    </li>
  );
}

/**
 * /my-orders — the signed-in customer's own orders.
 *
 * The list comes from the server, filtered by the session's user id; there is no
 * client-side filtering of a broader list. When the session is gone the customer
 * is sent to log in and returned here afterwards.
 */
export default function MyOrdersView() {
  const { status: authStatus, customer, logout } = useCustomer();
  const [orders, setOrders] = useState({ state: "loading", items: [], error: null });

  useEffect(() => {
    if (authStatus === "ready" && !customer) {
      window.location.replace(`${loginHref}?next=${encodeURIComponent(myOrdersHref)}`);
    }
  }, [authStatus, customer]);

  useEffect(() => {
    if (!customer) return undefined;
    const controller = new AbortController();
    getMyOrders({ signal: controller.signal })
      .then((items) => setOrders({ state: "ready", items, error: null }))
      .catch((error) => {
        if (error?.name === "AbortError") return;
        // A 401 here means the session expired between load and fetch; send them
        // back to log in rather than showing a broken page.
        if (error?.status === 401) {
          window.location.replace(`${loginHref}?next=${encodeURIComponent(myOrdersHref)}`);
          return;
        }
        setOrders({ state: "ready", items: [], error: error.message });
      });
    return () => controller.abort();
  }, [customer]);

  const onLogout = useCallback(async () => {
    await logout();
    window.location.assign("/");
  }, [logout]);

  if (authStatus === "loading" || !customer) {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="orders-title">
        <div className={`container ${styles.wrap}`}>
          <p className={styles.muted} role="status">
            Loading your orders…
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={`section ${styles.page}`} aria-labelledby="orders-title">
      <div className={`container ${styles.wide}`}>
        <div className={styles.split}>
          <div>
            <p className="eyebrow">Your account</p>
            <h1 id="orders-title" className={styles.title}>
              My Orders
            </h1>
            <p className={styles.lead}>{customer.email}</p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onLogout}>
            Log Out
          </button>
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <NotificationToggle audience="customer" />
        </div>

        {orders.state === "loading" ? (
          <p className={styles.muted} role="status">
            <Loader2 size={16} aria-hidden="true" /> Loading your orders…
          </p>
        ) : orders.error ? (
          <p className={styles.alert} role="alert">
            <AlertCircle size={17} aria-hidden="true" />
            <span>{orders.error}</span>
          </p>
        ) : orders.items.length === 0 ? (
          <div className={styles.card}>
            <p className={styles.lead}>You haven&apos;t placed any orders yet.</p>
            <div className={styles.linkRow}>
              <a className="btn btn--primary" href="/#menu">
                Order Now
              </a>
            </div>
          </div>
        ) : (
          <ul className={styles.orders}>
            {orders.items.map((order) => (
              <OrderCard key={order.id ?? order.orderId} order={order} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
