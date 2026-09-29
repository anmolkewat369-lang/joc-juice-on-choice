import { useState } from "react";
import { Banknote, Check, Copy, Info, Smartphone } from "lucide-react";
import { PAYMENT_METHOD, PAYMENT_PROVIDER } from "../../../shared/ordering.js";
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
    label: "UPI / Online Payment",
    note: "Pay using UPI before the order is confirmed.",
    Icon: Smartphone,
    providerNote: {
      [PAYMENT_PROVIDER.MANUAL_UPI]:
        "Pay using UPI before the order is confirmed. We will ask for the UTR so we can verify it.",
      [PAYMENT_PROVIDER.RAZORPAY]: "UPI • Cards • Net Banking",
    },
  },
];

/**
 * Native radio inputs inside a fieldset, so keyboard arrow-key navigation and
 * screen readers behave exactly as they should. Nothing is preselected: the
 * customer always makes an explicit choice.
 */
export default function PaymentChoice({ value, onChange, error, digitalPayment }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(null);

  const provider = digitalPayment?.provider;
  const available = Boolean(digitalPayment?.available);
  /**
   * `loaded` separates "the server has not answered yet" from "the server says
   * online payment is off". Without it the "Cash on Delivery is the only option"
   * warning would flash on every page load during the request, which reads as an
   * outage to a customer who is merely on a slow connection.
   */
  const loaded = Boolean(digitalPayment?.loaded);
  const vpa = digitalPayment?.vpa ?? null;
  const manualUpi = available && provider === PAYMENT_PROVIDER.MANUAL_UPI && vpa;

  const options = OPTIONS.filter((option) =>
    option.alwaysAvailable ? true : available,
  ).map((option) =>
    option.providerNote
      ? { ...option, note: option.providerNote[provider] ?? option.providerNote[PAYMENT_PROVIDER.MANUAL_UPI] }
      : option,
  );

  const copyUpiId = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Could not copy automatically. Please select the UPI ID and copy it manually.");
    }
  };

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

      {/* Revealed only once the customer has actually chosen UPI, so the
          checkout does not open with a wall of payment instructions. */}
      {manualUpi && value === PAYMENT_METHOD.UPI ? (
        <div className={styles.instructions} role="group" aria-label="UPI payment details">
          <p className={styles.instructionsLead}>
            <Info size={15} aria-hidden="true" />
            Pay securely using UPI
          </p>

          <div className={styles.upiRow}>
            <code className={styles.upiId}>{vpa}</code>
            <button type="button" className={styles.copyButton} onClick={copyUpiId}>
              {copied ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <ol className={styles.instructionsSteps}>
            <li>Place your order — it is confirmed straight away.</li>
            <li>
              Pay the exact total to the UPI ID above using any UPI app. A QR
              code and a one-tap UPI link appear on the confirmation screen.
            </li>
            <li>
              Enter the UTR / transaction reference your app shows. JOC verifies
              it before the order is released.
            </li>
          </ol>

          <p className={styles.note}>
            Entering a UTR does not mark the order paid. It goes to JOC for
            verification, and only an admin can confirm the payment.
          </p>

          {copyError ? (
            <p className={styles.error} role="alert">
              {copyError}
            </p>
          ) : null}
        </div>
      ) : null}

      {loaded && !available ? (
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
