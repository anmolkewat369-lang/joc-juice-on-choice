import { useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import AccountField from "./AccountField";
import { loginHref } from "./accountRoute";
import { customerReset } from "../lib/api";
import styles from "./account.module.css";

const MIN_PASSWORD = 8;

/** The recovery fragment Supabase appends: `#access_token=…&type=recovery`. */
function recoveryToken() {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(raw);
  const token = params.get("access_token");
  return token && token.length > 20 ? token : null;
}

/**
 * /reset-password — set a new password from the emailed recovery link.
 *
 * The access token arrives in the URL FRAGMENT, which the browser never sends to
 * a server, and it is used exactly once here to call Supabase's update-password
 * endpoint. No JOC session is created by this screen: the customer returns to
 * log in with the new password, which doubles as proof that it works.
 */
export default function ResetPasswordView() {
  const token = useMemo(() => recoveryToken(), []);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="account-title">
        <div className={`container ${styles.wrap}`}>
          <div className={styles.card}>
            <h1 id="account-title" className={styles.title}>
              That reset link is not valid
            </h1>
            <p className={styles.lead}>
              Reset links expire quickly, and each can be used only once. Request a new one and
              open the newest email.
            </p>
            <div className={styles.linkRow}>
              <a className={styles.link} href={loginHref}>
                Back to log in
              </a>
            </div>
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

    const local = {};
    if (password.length < MIN_PASSWORD) {
      local.password = `Use at least ${MIN_PASSWORD} characters.`;
    }
    if (confirmPassword !== password) {
      local.confirmPassword = "The passwords do not match.";
    }
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setBusy(false);
      return;
    }

    try {
      await customerReset({ accessToken: token, password, confirmPassword });
      setDone(true);
    } catch (error) {
      setFormError(error.message);
      if (error.fieldErrors) setErrors(error.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <section className={`section ${styles.page}`} aria-labelledby="account-title">
        <div className={`container ${styles.wrap}`}>
          <div className={styles.card}>
            <h1 id="account-title" className={styles.title}>
              Password updated
            </h1>
            <p className={styles.lead}>You can now log in with your new password.</p>
            <div className={styles.linkRow}>
              <a className={`btn btn--primary`} href={loginHref}>
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
            Set a new password
          </h1>
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
              id="reset-password"
              label="New Password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={errors.password}
              hint={`At least ${MIN_PASSWORD} characters.`}
              required
              autoFocus
            />
            <AccountField
              id="reset-confirm-password"
              label="Confirm New Password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              error={errors.confirmPassword}
              required
            />
            <div className={styles.actions}>
              <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 size={18} aria-hidden="true" /> Updating…
                  </>
                ) : (
                  "Update Password"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
