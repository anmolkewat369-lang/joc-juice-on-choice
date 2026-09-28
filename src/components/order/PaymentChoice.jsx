import { Banknote, Smartphone } from "lucide-react";
import { PAYMENT_METHOD } from "../../../shared/ordering.js";
import styles from "./PaymentChoice.module.css";

const OPTIONS = [
  {
    value: PAYMENT_METHOD.COD,
    label: "Cash on Delivery",
    note: "Pay the delivery partner in cash when your order arrives.",
    Icon: Banknote,
  },
  {
    value: PAYMENT_METHOD.ONLINE,
    label: "Pay Now",
    note: "UPI • Cards • Net Banking",
    Icon: Smartphone,
  },
];

/**
 * Native radio inputs inside a fieldset, so keyboard arrow-key navigation and
 * screen readers behave exactly as they should. Nothing is preselected: the
 * customer always makes an explicit choice.
 */
export default function PaymentChoice({ value, onChange, error, onlineAvailable = true }) {
  return (
    <fieldset className={styles.group} aria-describedby={error ? "payment-error" : undefined}>
      <legend className={styles.legend}>Payment Method</legend>

      <div className={styles.options}>
        {OPTIONS.filter((option) => onlineAvailable || option.value !== PAYMENT_METHOD.ONLINE).map(
          ({ value: optionValue, label, note, Icon }) => {
            const selected = value === optionValue;
            return (
              <label
                key={optionValue}
                className={`${styles.option} ${selected ? styles.selected : ""}`}
              >
                <input
                  type="radio"
                  id={`payment-${optionValue.toLowerCase()}`}
                  name="paymentMethod"
                  value={optionValue}
                  checked={selected}
                  onChange={() => onChange(optionValue)}
                  className="visually-hidden"
                />
                <span className={styles.radio} aria-hidden="true">
                  <span className={styles.dot} />
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{label}</span>
                  <span className={styles.note}>{note}</span>
                </span>
                <Icon className={styles.icon} size={20} aria-hidden="true" />
              </label>
            );
          },
        )}
      </div>

      {error ? (
        <p id="payment-error" className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
