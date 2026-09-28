import { Banknote, Smartphone } from "lucide-react";
import { PAYMENT_METHOD } from "../../../shared/ordering.js";
import styles from "./PaymentChoice.module.css";

/**
 * The digital option is described by whichever rail the server has selected, and
 * it is only rendered at all when the server says that rail is usable.
 *
 * Nothing here decides which payment methods exist. The server is the only thing
 * that knows whether a UPI ID is configured or gateway credentials are valid, so
 * the choice is passed in rather than hard-coded — a method that cannot actually
 * take money must never be offered.
 */
const OPTIONS = [
  {
    value: PAYMENT_METHOD.COD,
    label: "Cash on Delivery",
    note: "Pay the delivery partner in cash when your order arrives.",
    Icon: Banknote,
    alwaysAvailable: true,
  },
  {
    value: PAYMENT_METHOD.UPI,
    label: "Pay by UPI",
    note: "Pay to our UPI ID, then enter the UTR so we can confirm it.",
    Icon: Smartphone,
    providerNote: {
      manual_upi: "Pay to our UPI ID, then enter the UTR so we can confirm it.",
      razorpay: "UPI • Cards • Net Banking",
    },
  },
];

/**
 * Native radio inputs inside a fieldset, so keyboard arrow-key navigation and
 * screen readers behave exactly as they should. Nothing is preselected: the
 * customer always makes an explicit choice.
 */
export default function PaymentChoice({ value, onChange, error, digitalPayment }) {
  const provider = digitalPayment?.provider;
  const available = Boolean(digitalPayment?.available);

  const options = OPTIONS.filter((option) =>
    option.alwaysAvailable ? true : available,
  ).map((option) =>
    option.providerNote
      ? { ...option, note: option.providerNote[provider] ?? option.providerNote.manual_upi }
      : option,
  );

  return (
    <fieldset className={styles.group} aria-describedby={error ? "payment-error" : undefined}>
      <legend className={styles.legend}>Payment Method</legend>

      <div className={styles.options}>
        {options.map(({ value: optionValue, label, note, Icon }) => {
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
        })}
      </div>

      {!available ? (
        <p className={styles.note} role="note">
          Online payment is unavailable right now, so Cash on Delivery is the only option.
        </p>
      ) : null}

      {error ? (
        <p id="payment-error" className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
