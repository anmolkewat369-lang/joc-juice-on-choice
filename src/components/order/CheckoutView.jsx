import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useCart } from "../../cart/cartStore";
import { formatPrice } from "../../data/menu";
import {
  DELIVERY_LABEL,
  DELIVERY_NOTE,
  DELIVERY_PENDING_LABEL,
  EMAIL_OPTIONAL_NOTE,
  LIMITS,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  validateCheckout,
} from "../../../shared/ordering.js";
import { cartHref, homeHref } from "../../lib/route";
import { useOrderFlow, isBusy, FLOW } from "../../lib/useOrderFlow";
import Field from "./Field";
import DeliveryCheck from "./DeliveryCheck";
import PaymentChoice from "./PaymentChoice";
import styles from "./CheckoutView.module.css";

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  landmark: "",
  instructions: "",
  paymentMethod: "",
};

const BUTTON_COPY = {
  [FLOW.SUBMITTING]: "Creating Order…",
  [FLOW.PAYING]: "Opening Payment…",
  [FLOW.VERIFYING]: "Confirming Payment…",
};

/**
 * Guest checkout — no account, no registration.
 *
 * Collected: name, mobile, address, and optionally a landmark, a note and an email
 * address. The same `validateCheckout` used by the server runs here for inline
 * messages, and the server still re-validates everything it receives.
 */
export default function CheckoutView({ onPlaced, onReturnHome }) {
  const { lines, subtotal, deliveryCharge, total, isEmpty } = useCart();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const headingRef = useRef(null);
  const flow = useOrderFlow({ onComplete: onPlaced });
  const busy = isBusy(flow.flow);

  const items = useMemo(
    () => lines.map(({ id, qty }) => ({ id, qty })),
    [lines],
  );

  // Focus the heading on mount so a screen reader user lands on the new screen.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (isEmpty) {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="checkout-title">
        <div className={`container ${styles.emptyWrap}`}>
          <h1 id="checkout-title" className={styles.emptyTitle} tabIndex={-1} ref={headingRef}>
            There is nothing to check out yet
          </h1>
          <p>Add a few items to your cart and come back — we will keep your place here.</p>
          <a className="btn btn--primary btn--lg" href="#menu">
            Browse Menu
          </a>
        </div>
      </section>
    );
  }

  const update = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    if (submitted) {
      setErrors(
        validateCheckout({ ...form, [key]: value, items }).errors,
      );
    }
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return; // blocks the double click before the request goes out

    setSubmitted(true);
    const result = validateCheckout({ ...form, items });
    setErrors(result.errors);
    if (!result.valid) {
      // Move focus to the first thing that needs fixing.
      const firstKey = Object.keys(result.errors)[0];
      const target =
        firstKey === "paymentMethod" ? "payment-cod" : firstKey;
      document.getElementById(target)?.focus();
      return;
    }

    await flow.placeOrder({ items, details: result.value });
  };

  /**
   * Which rail settles a UPI order, per the server. Both branches below used to
   * test `PAYMENT_METHOD.ONLINE`, a key that no longer exists since the method
   * was renamed to UPI — so `undefined` was compared against a real value, both
   * comparisons were permanently false, and the copy silently described cash on
   * delivery even when the customer had chosen UPI. Branching on the provider
   * keeps the copy true for manual UPI as well as for a gateway.
   */
  const upiProvider =
    form.paymentMethod === PAYMENT_METHOD.UPI
      ? (flow.digitalPayment?.provider ?? null)
      : null;
  const isGateway = upiProvider === PAYMENT_PROVIDER.RAZORPAY;
  const isManualUpi = upiProvider === PAYMENT_PROVIDER.MANUAL_UPI;

  const submitLabel = (() => {
    if (busy) return BUTTON_COPY[flow.flow];
    // Only a gateway takes the money inside this button. Manual UPI is paid
    // after the order exists, so it is still "Place Order".
    return isGateway ? "Pay Now" : "Place Order";
  })();

  return (
    <section className={`section ${styles.page}`} aria-labelledby="checkout-title">
      <div className={`container ${styles.wrap}`}>
        <header className={styles.head}>
          <p className="eyebrow">Step 2 of 3</p>
          <h1 id="checkout-title" tabIndex={-1} ref={headingRef}>
            Checkout
          </h1>
          <p>Tell us where to deliver and how you would like to pay. No account needed.</p>
        </header>

        <div className={styles.layout}>
          <form className={styles.form} onSubmit={onSubmit} noValidate>
            <fieldset className={styles.block} disabled={busy}>
              <legend className={styles.blockTitle}>Customer details</legend>
              <div className={styles.grid}>
                <Field
                  id="name"
                  label="Full Name"
                  value={form.name}
                  onChange={update("name")}
                  error={errors.name}
                  autoComplete="name"
                  maxLength={LIMITS.name}
                  placeholder="e.g. Rahul Sharma"
                  required
                />
                <Field
                  id="phone"
                  label="Mobile Number"
                  value={form.phone}
                  onChange={update("phone")}
                  error={errors.phone}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={LIMITS.phone}
                  hint="10-digit Indian mobile number."
                  placeholder="e.g. 96301 94023"
                  required
                />
                <div className={styles.full}>
                  <Field
                    id="email"
                    label="Email Address"
                    value={form.email}
                    onChange={update("email")}
                    error={errors.email}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={LIMITS.email}
                    hint={EMAIL_OPTIONAL_NOTE}
                    placeholder="e.g. rahul@example.com"
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className={styles.block} disabled={busy}>
              <legend className={styles.blockTitle}>Delivery details</legend>
              <div className={styles.grid}>
                <div className={styles.full}>
                  <Field
                    id="address"
                    label="Full Address"
                    value={form.address}
                    onChange={update("address")}
                    error={errors.address}
                    multiline
                    rows={3}
                    maxLength={LIMITS.address}
                    placeholder="House / flat, street, area"
                    hint="Include anything our delivery partner needs to find you."
                    required
                  />
                </div>
                <Field
                  id="landmark"
                  label="Landmark"
                  value={form.landmark}
                  onChange={update("landmark")}
                  maxLength={LIMITS.landmark}
                  placeholder="e.g. Near Shri Ram Engineering College"
                />
                <div className={styles.full}>
                  <Field
                    id="instructions"
                    label="Special Instructions"
                    value={form.instructions}
                    onChange={update("instructions")}
                    multiline
                    rows={2}
                    maxLength={LIMITS.instructions}
                    placeholder="Less spicy, no onion, call on arrival…"
                  />
                </div>
                <div className={styles.full}>
                  {/*
                   * A preview only. The order route re-runs the same check against
                   * this address before anything is created, so this component can
                   * never be the reason an out-of-range order is accepted.
                   */}
                  <DeliveryCheck address={form.address} landmark={form.landmark} disabled={busy} />
                </div>
              </div>
            </fieldset>

            <div className={styles.block}>
              <PaymentChoice
                value={form.paymentMethod}
                onChange={(value) => {
                  setForm((current) => ({ ...current, paymentMethod: value }));
                  if (submitted) {
                    setErrors((current) => ({ ...current, paymentMethod: undefined }));
                  }
                }}
                error={errors.paymentMethod}
                digitalPayment={flow.digitalPayment}
              />
            </div>

            {flow.error ? (
              <p className={styles.alert} role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>
                  {flow.error.message}
                  {flow.error.code === "payments_unavailable" && flow.pendingOrderId ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        className={styles.alertAction}
                        disabled={busy}
                        onClick={() => flow.switchToCod(flow.pendingOrderId)}
                      >
                        Switch to Cash on Delivery
                      </button>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}

            <div className={styles.actions}>
              <button
                type="submit"
                className="btn btn--primary btn--lg btn--block"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <Loader2 className={styles.spin} size={18} aria-hidden="true" />
                    {submitLabel}
                  </>
                ) : (
                  submitLabel
                )}
              </button>

              <p className={styles.trust}>
                <Lock size={14} aria-hidden="true" />
                {isGateway
                  ? flow.testMode
                    ? "TEST MODE: this is a development payment on the Razorpay sandbox — no real money moves."
                    : "Payment details go straight to the payment provider. We never see or store card details."
                  : isManualUpi
                    ? "Pay by UPI after placing the order, then send us the UTR. JOC verifies it before the order is released."
                    : "No advance payment. Pay the delivery partner when your order arrives."}
              </p>
            </div>
          </form>

          <aside className={styles.summary} aria-labelledby="summary-title">
            <h2 id="summary-title" className={styles.summaryTitle}>
              Order Summary
            </h2>

            <ul className={styles.summaryLines}>
              {lines.map((line) => (
                <li key={line.id} className={styles.summaryLine}>
                  <span className={styles.summaryName}>
                    {line.name}
                    <span className={styles.summaryQty}>× {line.qty}</span>
                  </span>
                  <span className={styles.summaryAmount}>{formatPrice(line.lineTotal)}</span>
                </li>
              ))}
            </ul>

            <dl className={styles.totals}>
              <div>
                <dt>Subtotal</dt>
                <dd>{formatPrice(subtotal)}</dd>
              </div>
              <div>
                <dt>{DELIVERY_LABEL}</dt>
                {/* A zero charge means JOC has not set one, so it is labelled
                    "to be confirmed" — never "Free", which would be a claim we
                    have not made. */}
                <dd>{deliveryCharge > 0 ? formatPrice(deliveryCharge) : DELIVERY_PENDING_LABEL}</dd>
              </div>
              <div className={styles.grand}>
                <dt>Total</dt>
                <dd>{formatPrice(total)}</dd>
              </div>
            </dl>

            <p className={styles.deliveryNote}>{DELIVERY_NOTE}</p>

            <div className={styles.summaryLinks}>
              <a href={cartHref}>Edit cart</a>
              <a href={homeHref} onClick={onReturnHome}>
                Back to home
              </a>
            </div>

            <p className={styles.secure}>
              <ShieldCheck size={15} aria-hidden="true" />
              Guest checkout — we only ask for what is needed to deliver.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
