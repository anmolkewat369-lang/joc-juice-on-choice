import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { loadPushStatus, enablePush, disablePush } from "../lib/push";
import styles from "./account.module.css";

/**
 * One Web Push on/off control, used by both My Orders (audience="customer") and
 * the admin dashboard (audience="admin").
 *
 * The role is NOT sent to the server: the API derives it from the session
 * cookie. `audience` only changes the words on the screen.
 *
 * Permission is requested from the click that enables notifications, never on
 * mount. A denied state is explained and left alone — there is no prompt loop,
 * because a site cannot re-prompt once it has been blocked.
 */
export default function NotificationToggle({ audience = "customer" }) {
  const [status, setStatus] = useState({ state: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPushStatus().then((next) => {
      if (alive) setStatus({ state: "ready", ...next });
    });
    return () => {
      alive = false;
    };
  }, []);

  const title = "Order notifications";
  const note =
    audience === "admin"
      ? "Get a push on this device when a new order arrives."
      : "Get a push when JOC confirms your order.";

  const onEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await enablePush();
      if (!result.ok && result.reason === "denied") {
        setStatus((current) => ({ ...current, permission: "denied", subscribed: false }));
      } else {
        setStatus({ state: "ready", ...(await loadPushStatus()) });
      }
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await disablePush();
      setStatus({ state: "ready", ...(await loadPushStatus()) });
    } finally {
      setBusy(false);
    }
  };

  if (status.state === "loading") {
    return (
      <div className={styles.toggle} role="status">
        <Loader2 size={18} aria-hidden="true" />
        <span className={styles.muted}>Checking notification settings…</span>
      </div>
    );
  }

  if (!status.supported) {
    return (
      <div className={styles.toggle}>
        <BellOff size={18} aria-hidden="true" />
        <div className={styles.toggleText}>
          <p className={styles.toggleTitle}>{title}</p>
          <p className={styles.toggleNote}>This browser does not support order notifications.</p>
        </div>
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className={styles.toggle}>
        <BellOff size={18} aria-hidden="true" />
        <div className={styles.toggleText}>
          <p className={styles.toggleTitle}>{title}</p>
          <p className={styles.toggleNote}>Order notifications are not available right now.</p>
        </div>
      </div>
    );
  }

  if (status.permission === "denied") {
    return (
      <div className={styles.toggle}>
        <BellOff size={18} aria-hidden="true" />
        <div className={styles.toggleText}>
          <p className={styles.toggleTitle}>{title}</p>
          <p className={styles.toggleNote}>
            Notifications are blocked in your browser. Enable them in your browser/site settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.toggle}>
      {status.subscribed ? <Bell size={18} aria-hidden="true" /> : <BellOff size={18} aria-hidden="true" />}
      <div className={styles.toggleText}>
        <p className={styles.toggleTitle}>{title}</p>
        <p className={styles.toggleNote}>
          {status.subscribed ? "Enabled on this device." : note}
        </p>
      </div>
      {status.subscribed ? (
        <button type="button" className="btn btn--ghost" onClick={onDisable} disabled={busy}>
          {busy ? "Turning off…" : "Disable"}
        </button>
      ) : (
        <button type="button" className="btn btn--primary" onClick={onEnable} disabled={busy}>
          {busy ? "Enabling…" : "Enable Notifications"}
        </button>
      )}
    </div>
  );
}
