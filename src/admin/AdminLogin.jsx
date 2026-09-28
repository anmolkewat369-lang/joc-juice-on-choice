import { useState } from "react";
import { Eye, EyeOff, Loader2, LogIn, ShieldAlert } from "lucide-react";
import styles from "./AdminApp.module.css";

/**
 * Sign-in form.
 *
 * The password is posted to the server and immediately forgotten — it is never
 * stored in state beyond the submit, never written to storage, and never placed
 * in a URL. `autoComplete="current-password"` lets a password manager offer it,
 * but nothing here reads it back.
 */
export default function AdminLogin({ onSubmit, busy, error, expired, configured }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    onSubmit(email.trim(), password).then((ok) => {
      // Clear the password from component state as soon as it is no longer needed,
      // so it does not linger in memory or in a React DevTools snapshot.
      if (ok) setPassword("");
    });
  };

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>JOC Admin</h1>
        <p className={styles.muted}>
          Sign in to review orders and confirm UPI payments. This account is managed by Supabase.
        </p>

        {expired ? (
          <p className={styles.notice} role="status">
            <ShieldAlert size={16} aria-hidden="true" />
            Your session expired. Please sign in again.
          </p>
        ) : null}

        {configured === false ? (
          <p className={styles.error} role="alert">
            The admin dashboard is not configured on this server.
          </p>
        ) : null}

        <form onSubmit={submit} className={styles.form}>
          <label className={styles.label} htmlFor="admin-email">
            Email
          </label>
          <input
            id="admin-email"
            className={styles.input}
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />

          <label className={styles.label} htmlFor="admin-password">
            Password
          </label>
          <div className={styles.passwordRow}>
            <input
              id="admin-password"
              className={styles.input}
              type={reveal ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className={styles.reveal}
              onClick={() => setReveal((value) => !value)}
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
            >
              {reveal ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? (
              <Loader2 className={styles.spin} size={17} aria-hidden="true" />
            ) : (
              <LogIn size={17} aria-hidden="true" />
            )}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
