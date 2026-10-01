import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import AccountField from "./AccountField";
import { useCustomer } from "./AuthProvider";
import { loginHref, safeNextFromLocation } from "./accountRoute";
import styles from "./account.module.css";

const MIN_PASSWORD = 8;

/**
 * /signup — Name, Email, Password, Confirm Password.
 *
 * If the Supabase project auto-confirms new users (the current setting), the API
 * signs them straight in and this navigates on. If email confirmation is enabled
 * instead, the API honestly reports that no session was created and this shows a
 * "check your inbox" message rather than pretending the customer is logged in.
 */
export default function SignupView() {
  const { signup, configured } = useCustomer();
  const next = safeNextFromLocation("/my-orders");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  if (configured === false) {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="account-title">
        <div className={`container ${styles.wrap}`}>
          <div className={styles.card}>
            <h1 id="account-title" className={styles.title}>
              Customer accounts are not available
            </h1>
            <p className={styles.lead}>
              This deployment has not finished configuring sign-in. Ordering is paused until it
              is. Please contact JOC if you need help.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const update = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);

    const local = {};
    if (form.name.trim().length < 2) local.name = "Enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = "Enter a valid email address.";
    if (form.password.length < MIN_PASSWORD) {
      local.password = `Use at least ${MIN_PASSWORD} characters.`;
    }
    if (form.confirmPassword !== form.password) {
      local.confirmPassword = "The passwords do not match.";
    }
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setBusy(false);
      return;
    }

    try {
      const result = await signup(form);
      if (result.confirmationRequired) {
        setConfirmationRequired(true);
        setBusy(false);
        return;
      }
      window.location.assign(next);
    } catch (error) {
      setFormError(error.message);
      if (error.fieldErrors) setErrors(error.fieldErrors);
      setBusy(false);
    }
  };

  if (confirmationRequired) {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="account-title">
        <div className={`container ${styles.wrap}`}>
          <div className={styles.card}>
            <h1 id="account-title" className={styles.title}>
              Confirm your email
            </h1>
            <p className={styles.lead}>
              We have sent a confirmation link to <strong>{form.email}</strong>. Open it, then log
              in to start ordering.
            </p>
            <div className={styles.linkRow}>
              <a className={styles.link} href={loginHref}>
                Go to log in
              </a>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`section ${styles.page}`} aria-labelledby="account-title">
      <div className={`container ${styles.wrap}`}>
        <header className={styles.head}>
          <p className="eyebrow">Your account</p>
          <h1 id="account-title" className={styles.title}>
            Create account
          </h1>
          <p className={styles.lead}>
            Create an account to place orders and track them from My Orders.
          </p>
        </header>

        <div className={styles.card}>
          <form className={styles.form} onSubmit={onSubmit} noValidate>
            {formError ? (
              <p className={styles.alert} role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{formError}</span>
              </p>
            ) : null}
            <AccountField
              id="signup-name"
              label="Full Name"
              autoComplete="name"
              value={form.name}
              onChange={update("name")}
              error={errors.name}
              required
              autoFocus
            />
            <AccountField
              id="signup-email"
              label="Email Address"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={update("email")}
              error={errors.email}
              required
            />
            <AccountField
              id="signup-password"
              label="Password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={update("password")}
              error={errors.password}
              hint={`At least ${MIN_PASSWORD} characters.`}
              required
            />
            <AccountField
              id="signup-confirm-password"
              label="Confirm Password"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={update("confirmPassword")}
              error={errors.confirmPassword}
              required
            />
            <div className={styles.actions}>
              <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={18} aria-hidden="true" /> Creating account…
                  </>
                ) : (
                  "Create Account"
                )}
              </button>
            </div>
            <div className={styles.linkRow}>
              <span className={styles.muted}>Already have an account?</span>
              <a className={styles.link} href={loginHref}>
                Log in
              </a>
            </div>
          </form>
        </div>

        <div className={styles.linkRow}>
          <a className={styles.link} href="/">
            Back to JOC
          </a>
        </div>
      </div>
    </section>
  );
}
