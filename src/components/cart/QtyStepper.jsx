import { Check, Minus, Plus } from "lucide-react";
import styles from "./QtyStepper.module.css";

/**
 * Compact quantity control. Real <button> elements with accessible names, so
 * it works with a keyboard and a screen reader — the icon is decoration only.
 */
export default function QtyStepper({
  qty,
  onDecrement,
  onIncrement,
  label,
  size = "sm",
  confirmed = false,
}) {
  return (
    <div className={`${styles.stepper} ${styles[size] ?? styles.sm}`}>
      <button
        type="button"
        className={styles.button}
        onClick={onDecrement}
        aria-label={`Reduce quantity of ${label}`}
      >
        <Minus size={15} aria-hidden="true" />
      </button>

      <span className={styles.qty} aria-live="polite">
        {confirmed ? (
          <span className={styles.confirmed}>
            <Check size={13} aria-hidden="true" />
            {qty}
          </span>
        ) : (
          qty
        )}
        <span className="visually-hidden"> in cart</span>
      </span>

      <button
        type="button"
        className={styles.button}
        onClick={onIncrement}
        aria-label={`Add one more ${label}`}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
