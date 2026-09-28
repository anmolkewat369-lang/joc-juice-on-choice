import { useCallback, useEffect, useState } from "react";
import { getSession, signIn, signOut, AdminRequestError } from "./api.js";
import AdminLogin from "./AdminLogin.jsx";
import AdminOrders from "./AdminOrders.jsx";
import styles from "./AdminApp.module.css";

/**
 * The admin shell: a session gate in front of the dashboard.
 *
 * It does not decide who the admin is — the server does, on every request. This
 * only asks the question once on load so the right screen is shown, and then
 * lets the dashboard's own calls fail closed if the session has since expired.
 */
export default function AdminApp() {
  const [session, setSession] = useState({ state: "loading", signedIn: false });
  const [signInError, setSignInError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getSession({ signal: controller.signal })
      .then((result) => setSession({ state: "ready", ...result }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSession({ state: "ready", signedIn: false, error: error.message });
      });
    return () => controller.abort();
  }, []);

  /**
   * Called by the dashboard when a request comes back 401. The session is gone
   * server-side; pretending otherwise would leave a frozen, useless screen.
   */
  const handleExpired = useCallback(() => {
    setSession({ state: "ready", signedIn: false, admin: null, expired: true });
  }, []);

  const handleSignIn = useCallback(async (email, password) => {
    setBusy(true);
    setSignInError(null);
    try {
      const result = await signIn(email, password);
      setSession({ state: "ready", signedIn: true, admin: result.admin, configured: true });
      return true;
    } catch (error) {
      setSignInError(
        error instanceof AdminRequestError
          ? error.message
          : "Sign-in failed. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
    } catch {
      /* the cookie is cleared either way once the server responds */
    } finally {
      setSession({ state: "ready", signedIn: false, admin: null, configured: true });
      setBusy(false);
    }
  }, []);

  if (session.state === "loading") {
    return (
      <div className={styles.screen} role="status">
        <p className={styles.muted}>Checking your session…</p>
      </div>
    );
  }

  /**
   * A server with no session secret reports itself rather than looking like a
   * failed login. Saying "wrong password" here would send an admin hunting for
   * a typo that does not exist.
   */
  if (session.configured === false) {
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <h1 className={styles.title}>Admin dashboard not configured</h1>
          <p className={styles.muted}>
            This deployment is missing the environment variables the admin dashboard needs. Set{" "}
            <code>JOC_ADMIN_SESSION_SECRET</code> (32+ random characters) and{" "}
            <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code>, then redeploy. No orders
            are at risk — the dashboard is simply unavailable until it is configured.
          </p>
        </div>
      </div>
    );
  }

  if (!session.signedIn) {
    return (
      <AdminLogin
        onSubmit={handleSignIn}
        busy={busy}
        error={signInError}
        expired={session.expired}
        configured={session.configured}
      />
    );
  }

  return (
    <AdminOrders
      admin={session.admin}
      busy={busy}
      onSignOut={handleSignOut}
      onSessionExpired={handleExpired}
    />
  );
}
