import { useEffect, useRef, useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { useCart } from "../../cart/cartStore";
import QtyStepper from "./QtyStepper";
import styles from "./AddToCartButton.module.css";

/**
 * The ordering CTA that lives on every orderable menu card.
 *
 * Before adding it is a single "Add to Cart" button. After adding it becomes a
 * quantity control carrying a check, so the customer can see the count and
 * change it without leaving the menu. The confirmation is announced politely
 * for screen readers.
 */
export default function AddToCartButton({ item }) {
  const { items, addItem, increment, decrement } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef(null);

  const line = items.find((entry) => entry.id === item.id);
  const qty = line?.qty ?? 0;

  useEffect(() => () => clearTimeout(timer.current), []);

  const onAdd = () => {
    addItem(item.id, 1);
    setJustAdded(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setJustAdded(false), 2200);
  };

  if (qty === 0) {
    return (
      <div className={styles.wrap}>
        <button type="button" className={styles.add} onClick={onAdd}>
          <ShoppingBag size={16} aria-hidden="true" />
          Add to Cart
          <span className="visually-hidden"> — {item.name}</span>
        </button>
        <span className="visually-hidden" role="status" aria-live="polite">
          {justAdded ? `${item.name} added to your cart.` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.inCart}>
        <Check size={14} aria-hidden="true" />
        In cart
      </span>
      <QtyStepper
        qty={qty}
        confirmed
        label={item.name}
        onIncrement={() => increment(item.id)}
        onDecrement={() => decrement(item.id)}
      />
      <span className="visually-hidden" role="status" aria-live="polite">
        {`${item.name}, quantity ${qty} in cart.`}
      </span>
    </div>
  );
}
