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
import {
  DELIVERY_AREA_CONFIRM_LABEL,
  DELIVERY_AREA_NOTE,
} from "../../../shared/delivery.js";
import { cartHref, homeHref } from "../../lib/route";
import { useCustomer } from "../../account/AuthProvider";
import { loginHref } from "../../account/accountRoute";
import { useOrderFlow, isBusy, FLOW } from "../../lib/useOrderFlow";
import Field from "./Field";
import AreaSelector from "./AreaSelector";
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
  // The area is an id from the configured list, and `deliveryAreaConfirmed` is a
  // real boolean rather than the string "on" — the server compares it to `true`
  // exactly, and a string reaching that field would be refused.
  deliveryArea: null,
  deliveryAreaConfirmed: false,
};

const BUTTON_COPY = {
  [FLOW.SUBMITTING]: "Creating Order…",
  [FLOW.PAYING]: "Opening Payment…",
  [FLOW.VERIFYING]: "Confirming Payment…",
};

/**
 * A half-typed checkout survives the trip to the login page.
 *
 * Ordering now requires an account, so a customer can be sent to /login and back
 * mid-form. The cart already lives in localStorage; this keeps the address they
 * had started typing in sessionStorage so a redirect does not silently discard
 * it. It is cleared the moment an order is actually placed, so the next checkout
 * starts clean.
 */
const DRAFT_KEY = "joc.checkout.draft.v1";

const readDraft = () => {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? { ...EMPTY_FORM, ...parsed } : null;
  } catch {
    return null;
  }
};

const writeDraft = (form) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form));
  } catch {
    /* private browsing — the in-memory form still works for this visit */
  }
};

const clearDraft = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
};

/**
 * Guest checkout — no account, no registration.
 *
 * Collected: name, mobile, delivery area, exact address, and optionally a landmark,
 * a note and an email address — plus a required confirmation that the address is
 * correct and inside JOC's area. The same `validateCheckout` used by the server runs
 * here for inline messages, and the server still re-validates everything it
 * receives, including that the chosen area is one JOC actually serves.
 */
export default function CheckoutView({ onPlaced, onReturnHome }) {
  const { lines, subtotal, deliveryCharge, total, isEmpty } = useCart();
  const { status: authStatus, customer } = useCustomer();
  const [form, setForm] = useState(() => readDraft() ?? EMPTY_FORM);
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

  // Persist every edit so a redirect to log in and back does not lose the form.
  useEffect(() => {
    writeDraft(form);
  }, [form]);

  // Prefill the email from the signed-in account, but never overwrite something
  // the customer has already typed.
  useEffect(() => {
    if (!customer?.email) return;
    // The session resolves after this screen mounts, so the account email cannot
    // be an initial value; syncing it in is exactly what an effect is for. The
    // rule's synchronous-update concern does not apply. Suppressed here only.
    // oxlint-disable-next-line react/set-state-in-effect
    setForm((current) => (current.email ? current : { ...current, email: customer.email }));
  }, [customer?.email]);

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

  // The account is still being checked. A brief status screen beats flashing the
  // login gate for someone who is already signed in.
  if (authStatus === "loading") {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="checkout-title">
        <div className={`container ${styles.emptyWrap}`}>
          <h1 id="checkout-title" className={styles.emptyTitle} tabIndex={-1} ref={headingRef}>
            Checking your account…
          </h1>
        </div>
      </section>
    );
  }

  // Ordering requires an account. The cart is in localStorage and the half-typed
  // form is in sessionStorage, so a trip through login and back loses nothing.
  if (!customer) {
    const next = encodeURIComponent("/#/checkout");
    return (
      <section className={`section ${styles.page}`} aria-labelledby="checkout-title">
        <div className={`container ${styles.emptyWrap}`}>
          <h1 id="checkout-title" className={styles.emptyTitle} tabIndex={-1} ref={headingRef}>
            Please log in to place your order
          </h1>
          <p>
            Please log in to place an order and track it from My Orders. Your cart is saved, and we
            will bring you straight back here.
          </p>
          <div className={styles.authActions}>
            <a className="btn btn--primary btn--lg" href={`${loginHref}?next=${next}`}>
              Log In
            </a>
            <a className="btn btn--ghost btn--lg" href={`/signup?next=${next}`}>
              Create Account
            </a>
          </div>
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
      // Move focus to the first thing that needs fixing. Two fields do not carry
      // their own id — the payment choice and the area picker — so each maps to the
      // element that actually holds focus. Without this, focusing "deliveryArea"
      // would silently do nothing and the customer would have to hunt for it.
      const FOCUS_TARGET = { paymentMethod: "payment-cod", deliveryArea: "area-selector-search" };
      const firstKey = Object.keys(result.errors)[0];
      const target = FOCUS_TARGET[firstKey] ?? firstKey;
      document.getElementById(target)?.focus();
      return;
    }

    const order = await flow.placeOrder({ items, details: result.value });
    // The order exists now, so the saved draft has done its job. Clearing it
    // means the next checkout does not resurrect this address.
    if (order) clearDraft();
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
          <p>Tell us where to deliver and how you would like to pay.</p>
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
              <p className={styles.areaNote}>{DELIVERY_AREA_NOTE}</p>
              <div className={styles.grid}>
                {/*
                 * The area comes first: it is what tells the customer JOC reaches
                 * them at all, so asking for the full address before showing the
                 * list would have them type an address into a form that may not
                 * apply to them.
                 */}
                <div className={styles.full}>
                  <AreaSelector
                    value={form.deliveryArea}
                    onChange={(deliveryArea) => {
                      setForm((current) => ({ ...current, deliveryArea }));
                      // Re-validate so the error clears as soon as it is fixed,
                      // rather than lingering until the next submit.
                      if (submitted) {
                        setErrors(
                          validateCheckout({ ...form, deliveryArea, items }).errors,
                        );
                      }
                    }}
                    disabled={busy}
                    error={errors.deliveryArea}
                  />
                </div>
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

                {/*
                 * The required acknowledgement.
                 *
                 * A checkbox is used because this is an explicit statement of
                 * something only the customer can know, and a tick they can see and
                 * un-tick is honest about that. It is not a substitute for the
                 * server check — validateCheckout requires `deliveryAreaConfirmed`
                 * to be exactly true on the request itself, so clearing this box and
                 * posting anyway is refused rather than silently treated as agreed.
                 */}
                <div className={`${styles.full} ${styles.confirm}`}>
                  <label className={styles.confirmLabel} htmlFor="deliveryAreaConfirmed">
                    <input
                      id="deliveryAreaConfirmed"
                      type="checkbox"
                      className={styles.confirmInput}
                      checked={form.deliveryAreaConfirmed}
                      disabled={busy}
                      aria-invalid={Boolean(errors.deliveryAreaConfirmed) || undefined}
                      aria-describedby={
                        errors.deliveryAreaConfirmed ? "deliveryAreaConfirmed-error" : undefined
                      }
                      onChange={(event) => {
                        const deliveryAreaConfirmed = event.target.checked;
                        setForm((current) => ({ ...current, deliveryAreaConfirmed }));
                        if (submitted) {
                          setErrors(
                            validateCheckout({ ...form, deliveryAreaConfirmed, items }).errors,
                          );
                        }
                      }}
                    />
                    <span>{DELIVERY_AREA_CONFIRM_LABEL}</span>
                  </label>
                  {errors.deliveryAreaConfirmed ? (
                    <p id="deliveryAreaConfirmed-error" className={styles.confirmError} role="alert">
                      {errors.deliveryAreaConfirmed}
                    </p>
                  ) : null}
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
                  {flow.error.code === "customer_unauthenticated" ? (
                    <>
                      {" "}
                      <a
                        className={styles.alertAction}
                        href={`${loginHref}?next=${encodeURIComponent("/#/checkout")}`}
                      >
                        Log in and continue
                      </a>
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
              We only ask for what is needed to deliver, and keep it under your account.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
