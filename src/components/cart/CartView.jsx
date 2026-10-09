import { ArrowRight, ShoppingBag, Trash2 } from "lucide-react";
import { useCart } from "../../cart/cartStore";
import { formatPrice } from "../../data/menu";
import {
  DELIVERY_LABEL,
  DELIVERY_NOTE,
  DELIVERY_PENDING_LABEL,
} from "../../../shared/ordering.js";
import { checkoutHref } from "../../lib/route";
import QtyStepper from "./QtyStepper";
import styles from "./CartView.module.css";

/**
 * The cart screen. Same visual language as the rest of the site — the menu's
 * card shadows, the pill buttons, the existing type scale. Nothing new was
 * introduced stylistically to make ordering look like a different website.
 */
export default function CartView() {
  const {
    lines,
    subtotal,
    deliveryCharge,
    total,
    count,
    isEmpty,
    increment,
    decrement,
    removeItem,
    clearCart,
    availabilityFor,
    availabilityLoading,
    availabilityError,
  } = useCart();
  const blockedLines = lines.filter((line) => availabilityFor(line.id) !== "available");
  const availabilityBlocked = availabilityLoading || blockedLines.length > 0;

  if (isEmpty) return <EmptyCart />;

  return (
    <section className={`section ${styles.page}`} aria-labelledby="cart-title">
      <div className={`container ${styles.wrap}`}>
        <header className={styles.head}>
          <p className="eyebrow">Step 1 of 3</p>
          <h1 id="cart-title">Your Cart</h1>
          <p>
            {count} {count === 1 ? "item" : "items"} ready to go. Adjust quantities or head to
            checkout.
          </p>
        </header>

        <div className={styles.layout}>
          <ul className={styles.lines}>
            {lines.map((line) => (
              <li key={line.id} className={styles.line}>
                <div className={styles.lineMain}>
                  <h2 className={styles.lineName}>
                    {line.name}
                    {line.size ? <span className={styles.lineSize}>{line.size}</span> : null}
                  </h2>
                  <p className={styles.lineMeta}>
                    <span className={`chip ${styles.chip}`}>{line.category}</span>
                    <span className={styles.unit}>{formatPrice(line.price)} each</span>
                    {availabilityFor(line.id) === "out_of_stock" ? (
                      <span className={styles.unavailable}>Out of Stock</span>
                    ) : availabilityFor(line.id) === "coming_soon" ? (
                      <span className={styles.unavailable}>Coming Soon</span>
                    ) : availabilityFor(line.id) !== "available" ? (
                      <span className={styles.unavailable}>
                        {availabilityLoading ? "Checking availability…" : "Availability unavailable"}
                      </span>
                    ) : null}
                  </p>
                </div>

                <div className={styles.lineControls}>
                  <QtyStepper
                    size="lg"
                    qty={line.qty}
                    label={line.name}
                    onIncrement={() => increment(line.id)}
                    onDecrement={() => decrement(line.id)}
                    incrementDisabled={availabilityFor(line.id) !== "available"}
                  />
                  <span className={styles.lineTotal}>{formatPrice(line.lineTotal)}</span>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => removeItem(line.id)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Remove
                    <span className="visually-hidden"> {line.name} from cart</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <aside className={styles.summary} aria-labelledby="cart-summary-title">
            <h2 id="cart-summary-title" className={styles.summaryTitle}>
              Order Summary
            </h2>

            <dl className={styles.totals}>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatPrice(subtotal)}</dd>
              </div>
              <div>
                <dt>{DELIVERY_LABEL}</dt>
                <dd>
                  {deliveryCharge > 0 ? formatPrice(deliveryCharge) : DELIVERY_PENDING_LABEL}
                </dd>
              </div>
              <div className={styles.grand}>
                <dt>Total</dt>
                <dd>{formatPrice(total)}</dd>
              </div>
            </dl>

            <p className={styles.deliveryNote}>{DELIVERY_NOTE}</p>

            {availabilityBlocked ? (
              <div>
                <p className={styles.availabilityNotice} role="alert">
                  {availabilityLoading
                    ? "Checking current item availability…"
                    : availabilityError
                      ? "Availability could not be confirmed. Please refresh before ordering."
                      : `${blockedLines.map((line) => line.name).join(", ")} cannot be ordered right now. Remove ${
                          blockedLines.length === 1 ? "it" : "them"
                        } to continue.`}
                </p>
              </div>
            ) : (
              <a className={`btn btn--primary btn--lg btn--block ${styles.checkout}`} href={checkoutHref}>
                Proceed to Checkout
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            )}

            <button type="button" className={styles.clear} onClick={clearCart}>
              <Trash2 size={15} aria-hidden="true" />
              Clear cart
            </button>

            <a className={styles.back} href="#menu">
              Keep browsing the menu
            </a>
          </aside>
        </div>
      </div>
    </section>
  );
}

function EmptyCart() {
  return (
    <section className={`section ${styles.page} ${styles.emptyPage}`} aria-labelledby="cart-title">
      <div className={`container ${styles.emptyWrap}`}>
        <span className={styles.emptyMark} aria-hidden="true">
          <ShoppingBag size={30} />
        </span>
        <h1 id="cart-title">Your cart is empty</h1>
        <p>Explore our fresh juices, shakes and quick bites, then add what you like.</p>
        <a className="btn btn--primary btn--lg" href="#menu">
          Browse Menu
          <ArrowRight size={18} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
