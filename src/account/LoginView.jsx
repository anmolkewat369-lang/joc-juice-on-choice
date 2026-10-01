import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import AccountField from "./AccountField";
import { useCustomer } from "./AuthProvider";
import { signupHref, safeNextFromLocation } from "./accountRoute";
import { customerForgot } from "../lib/api";
import styles from "./account.module.css";

/**
 * /login — sign in, create an account, or ask for a reset link.
 *
 * The destination after a successful sign-in comes from `?next=`, but only a
 * same-origin relative path is honoured (see `safeNextFromLocation`). That is
 * what sends a customer who was stopped at checkout straight back to it, while
 * refusing an open redirect.
 */
export default function LoginView() {
  const { login, configured } = useCustomer();
  const next = safeNextFromLocation("/my-orders");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("login");
  const [resetSent, setResetSent] = useState(false);

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

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      await login({ email, password });
      // A full navigation so the destination page starts from a clean load with
      // the new session cookie already in place.
      window.location.assign(next);
    } catch (error) {
      setFormError(error.message);
      if (error.fieldErrors) setErrors(error.fieldErrors);
      setBusy(false);
    }
  };

  const onForgot = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setErrors({});
    try {
      await customerForgot({ email });
      setResetSent(true);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`section ${styles.page}`} aria-labelledby="account-title">
      <div className={`container ${styles.wrap}`}>
        <header className={styles.head}>
          <p className="eyebrow">Your account</p>
          <h1 id="account-title" className={styles.title}>
            {mode === "login" ? "Log in" : "Reset your password"}
          </h1>
          <p className={styles.lead}>
            {mode === "login"
              ? "Log in to place an order and track it from My Orders."
              : "Enter your email and we will send you a reset link."}
          </p>
        </header>

        <div className={styles.card}>
          {mode === "login" ? (
            <form className={styles.form} onSubmit={onSubmit} noValidate>
              {formError ? (
                <p className={styles.alert} role="alert">
                  <AlertCircle size={17} aria-hidden="true" />
                  <span>{formError}</span>
                </p>
              ) : null}
              <AccountField
                id="login-email"
                label="Email Address"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={errors.email}
                required
                autoFocus
              />
              <AccountField
                id="login-password"
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={errors.password}
                required
              />
              <div className={styles.actions}>
                <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 size={18} aria-hidden="true" /> Logging in…
                    </>
                  ) : (
                    "Log In"
                  )}
                </button>
              </div>
              <div className={styles.linkRow}>
                <a className={styles.link} href={signupHref}>
                  Create Account
                </a>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setMode("forgot");
                    setFormError(null);
                  }}
                >
                  Forgot Password?
                </button>
              </div>
            </form>
          ) : resetSent ? (
            <div className={styles.success} role="status">
              If an account exists for <strong>{email}</strong>, a reset link is on its way. Check
              your inbox and spam folder.
              <div className={styles.linkRow}>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setMode("login");
                    setResetSent(false);
                  }}
                >
                  Back to log in
                </button>
              </div>
            </div>
          ) : (
            <form className={styles.form} onSubmit={onForgot} noValidate>
              {formError ? (
                <p className={styles.alert} role="alert">
                  <AlertCircle size={17} aria-hidden="true" />
                  <span>{formError}</span>
                </p>
              ) : null}
              <AccountField
                id="forgot-email"
                label="Email Address"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={errors.email}
                required
                autoFocus
              />
              <div className={styles.actions}>
                <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
                  {busy ? "Sending…" : "Send Reset Link"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--block"
                  onClick={() => {
                    setMode("login");
                    setFormError(null);
                  }}
                >
                  Back to log in
                </button>
              </div>
            </form>
          )}
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
