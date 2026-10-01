import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { loadPushStatus, enablePush, disablePush, PUSH_REASON } from "../lib/push";
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
 *
 * Every unavailable state names its actual cause. A single "not available right
 * now" used to cover a browser without push, a blocked permission, a domain
 * without a service worker, a missing VAPID key and an unreachable endpoint —
 * so a fixable configuration problem looked like a dead feature.
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
  const intro =
    audience === "admin"
      ? "Get a push on this device when a new order arrives."
      : "Get a push when JOC confirms your order.";

  const onEnable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await enablePush();
      if (!result.ok) {
        // Keep whatever the last good status knew (role, permission) and record
        // the specific reason so the copy below explains it.
        setStatus((current) => ({ ...current, subscribed: false, reason: result.reason }));
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

  // Fully working and subscribed: the only state with a "Disable" action.
  if (status.configured && status.subscribed && status.reason !== PUSH_REASON.DENIED) {
    return (
      <Frame icon={<Bell size={18} aria-hidden="true" />} title={title} note="Enabled on this device.">
        <button type="button" className="btn btn--ghost" onClick={onDisable} disabled={busy}>
          {busy ? "Turning off…" : "Disable"}
        </button>
      </Frame>
    );
  }

  const blocked = blockedState(status.reason, audience);
  if (blocked) {
    return (
      <Frame icon={<BellOff size={18} aria-hidden="true" />} title={title} note={blocked.note}>
        {blocked.retry ? (
          <button type="button" className="btn btn--primary" onClick={onEnable} disabled={busy}>
            {busy ? "Enabling…" : "Try Again"}
          </button>
        ) : null}
      </Frame>
    );
  }

  // Nothing wrong: prompt the person to turn it on. Permission is only requested
  // from this click.
  return (
    <Frame icon={<BellOff size={18} aria-hidden="true" />} title={title} note={intro}>
      <button type="button" className="btn btn--primary" onClick={onEnable} disabled={busy}>
        {busy ? "Enabling…" : "Enable Order Notifications"}
      </button>
    </Frame>
  );
}

function Frame({ icon, title, note, children }) {
  return (
    <div className={styles.toggle}>
      {icon}
      <div className={styles.toggleText}>
        <p className={styles.toggleTitle}>{title}</p>
        <p className={styles.toggleNote}>{note}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * The specific explanation for a non-working state, or null when the toggle is
 * ready to be enabled. `retry: true` means "Try Again" is worth offering, so a
 * transient endpoint failure is not a dead end.
 */
function blockedState(reason, audience) {
  switch (reason) {
    case PUSH_REASON.UNSUPPORTED:
      return {
        note: "This browser does not support order notifications.",
        retry: false,
      };
    case PUSH_REASON.SERVICE_WORKER:
      return {
        note: "Notifications could not start on this device. Reload the page, or try a different browser.",
        retry: false,
      };
    case PUSH_REASON.AUTH:
      return {
        note: "Your sign-in has expired. Sign in again to manage notifications.",
        retry: false,
      };
    case PUSH_REASON.SERVER:
      return {
        note: "We could not reach the notification service just now. Please try again.",
        retry: true,
      };
    case PUSH_REASON.NOT_CONFIGURED:
      return {
        note:
          audience === "admin"
            ? "Order notifications are not set up on this server yet — the VAPID keys are missing."
            : "Order notifications are not available yet. You can still follow your order under My Orders.",
        retry: false,
      };
    case PUSH_REASON.DENIED:
      return {
        note: "Notifications are blocked in your browser. Allow them for this site in your browser settings, then reload this page.",
        retry: false,
      };
    case PUSH_REASON.SUBSCRIPTION_FAILED:
      return {
        note: "Your browser could not create a notification subscription. Check that notifications are allowed for this site, then try again.",
        retry: true,
      };
    default:
      return null;
  }
}
