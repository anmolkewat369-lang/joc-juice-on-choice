import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * New-order alerting.
 *
 * Two channels, both local to this browser tab:
 *
 *   desktop notification   via the Notification API, only after the admin
 *                          explicitly allows it — the browser requires a user
 *                          gesture, so this is never requested on page load
 *   sound                  a short Web Audio chime, generated in code so there is
 *                          no audio file to fetch and nothing to autoplay-block
 *
 * Neither is a delivery guarantee. They are conveniences layered on top of the
 * 15-second poll, and both are silent when the tab is closed — which is exactly
 * why the optional Resend email exists as a separate channel.
 *
 * The sound is muted by default. An unrequested noise on someone's desk is a
 * nuisance, so enabling it is a deliberate act.
 */
const NewOrderAlert = forwardRef(function NewOrderAlert({ enabled, whatsappNumber }, ref) {
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [toast, setToast] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") return;
    // Only ever ask once, and only as a result of this explicit click.
    const ask = () => {
      Notification.requestPermission().then((result) => setPermission(result));
    };
    window.addEventListener("joc:enable-notifications", ask, { once: true });
    return () => window.removeEventListener("joc:enable-notifications", ask);
  }, []);

  /**
   * A short two-note chime, built on demand.
   *
   * The AudioContext is created inside the gesture-triggered path and reused, so
   * repeated alerts do not accumulate contexts. If the browser blocks audio
   * entirely, this fails silently — a sound is never important enough to break
   * the dashboard over.
   */
  const chime = useCallback(() => {
    if (!enabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioRef.current ??= new AudioContext();
      const context = audioRef.current;
      if (context.state === "suspended") context.resume();

      const now = context.currentTime;
      for (const [index, frequency] of [880, 1174.66].entries()) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.14, now + index * 0.16 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.16 + 0.26);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + index * 0.16);
        oscillator.stop(now + index * 0.16 + 0.28);
      }
    } catch {
      /* audio unavailable — the dashboard is unaffected */
    }
  }, [enabled]);

  useImperativeHandle(
    ref,
    () => ({
      announce(orders) {
        const [first, ...rest] = orders;
        if (!first) return;
        chime();

        const title =
          orders.length === 1
            ? `New order ${first.orderId}`
            : `${orders.length} new orders`;
        const body =
          orders.length === 1
            ? `${first.customerName} • ${first.paymentStatus.replaceAll("_", " ").toLowerCase()}`
            : `Newest: ${first.orderId} • ${first.customerName}`;

        setToast({ title, body, count: orders.length, extra: rest.length });

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const notification = new Notification(title, {
            body,
            tag: "joc-new-order",
            requireInteraction: false,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        }
      },
    }),
    [chime],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      {permission === "default" ? (
        <button
          type="button"
          className="joc-admin-toast-action"
          onClick={() => window.dispatchEvent(new Event("joc:enable-notifications"))}
        >
          Enable desktop notifications
        </button>
      ) : null}

      {toast ? (
        <div className="joc-admin-toast" role="status" aria-live="polite">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
          {whatsappNumber ? (
            <span className="joc-admin-toast-note">
              Notifications only work while this tab is open. WhatsApp is a manual step.
            </span>
          ) : null}
          <button
            type="button"
            className="joc-admin-toast-close"
            onClick={() => setToast(null)}
            aria-label="Dismiss new order alert"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
});

export default NewOrderAlert;
