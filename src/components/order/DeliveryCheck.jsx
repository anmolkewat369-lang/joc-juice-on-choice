import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, MapPin, MapPinCheck } from "lucide-react";
import { checkDelivery, getDeliveryConfig } from "../../lib/api.js";
import { DELIVERY_OUTCOME } from "../../../shared/delivery.js";
import styles from "./DeliveryCheck.module.css";

/**
 * How long to wait after the last keystroke before asking the server.
 *
 * Long enough that typing a full address does not fire a Google request per
 * character, short enough that the answer feels attached to the form. There is a
 * second, server-side rate limit behind this; debouncing is a courtesy to the
 * budget, not the defence.
 */
const DEBOUNCE_MS = 900;

/** Below this, the address is too vague to geocode and the answer is noise. */
const MIN_ADDRESS_LENGTH = 12;

/** Outcomes where we know the address is not deliverable, rather than unknown. */
const DETERMINATE_REFUSALS = new Set([
  DELIVERY_OUTCOME.OUT_OF_RANGE,
  DELIVERY_OUTCOME.ADDRESS_NOT_FOUND,
  DELIVERY_OUTCOME.ADDRESS_AMBIGUOUS,
]);

/**
 * Live delivery availability for the address being typed.
 *
 * This is a PREVIEW and the component never says otherwise, because the customer
 * does not care about the distinction — they care whether they can order. The
 * honest architecture is that the order route re-checks independently, so nothing
 * rendered here can grant permission. It exists so nobody fills in the whole form
 * only to be refused at the end.
 *
 * Every non-available outcome is rendered in the same visually serious style.
 * "We could not reach the maps service" and "you are too far away" call for
 * different explanations, and inventing a certainty we do not have would be worse
 * than a uniform, slightly over-cautious warning.
 */
export default function DeliveryCheck({ address, landmark, disabled = false }) {
  const [rule, setRule] = useState(null);
  /**
   * The last answer, tagged with the exact input it describes.
   *
   * Tagging rather than clearing is what makes this component correct under fast
   * typing: an in-flight response for an address the customer has already edited
   * is still in `state`, but it no longer matches `key` and is therefore ignored
   * on render. It also means the "address is too short" case needs no state reset
   * at all — the stale answer simply stops matching.
   */
  const [answer, setAnswer] = useState({ key: null, delivery: null, failed: false });

  const controller = useRef(null);

  useEffect(() => {
    const active = new AbortController();
    getDeliveryConfig({ signal: active.signal })
      .then(setRule)
      // A failed config read only costs the up-front copy of the rule. The order
      // route still enforces the real limit; this component is a preview.
      .catch(() => {});
    return () => active.abort();
  }, []);

  const query = String(address ?? "").trim();
  const usable = !disabled && query.length >= MIN_ADDRESS_LENGTH;
  const key = `${query}|${String(landmark ?? "").trim()}`;

  useEffect(() => {
    if (!usable) {
      controller.current?.abort();
      controller.current = null;
      return undefined;
    }

    const timer = setTimeout(async () => {
      const active = new AbortController();
      controller.current?.abort();
      controller.current = active;

      try {
        const delivery = await checkDelivery(
          { address: query, landmark },
          { signal: active.signal },
        );
        if (!active.signal.aborted) setAnswer({ key, delivery, failed: false });
      } catch {
        if (active.signal.aborted) return;
        // The question could not be answered. Report that, rather than anything
        // that implies the address is fine.
        setAnswer({ key, delivery: null, failed: true });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `key` covers both inputs; depending on them separately would double-fire.
  }, [key, usable, query, landmark]);

  // Abort the last request if the component unmounts mid-flight.
  useEffect(() => () => controller.current?.abort(), []);

  if (!usable) {
    return rule?.rule ? (
      <p className={styles.note}>
        <MapPin size={15} aria-hidden="true" />
        {rule.rule}
      </p>
    ) : null;
  }

  // An answer for a different (address, landmark) is not an answer for this one.
  const current = answer.key === key ? answer : null;
  const result = current?.delivery ?? null;

  return (
    <div className={styles.box} aria-live="polite">
      {!result && !current?.failed ? (
        <p className={styles.pending}>
          <Loader2 className={styles.spin} size={15} aria-hidden="true" />
          Checking delivery distance…
        </p>
      ) : null}

      {result ? (
        <p className={result.eligible ? styles.ok : styles.no}>
          {result.eligible ? (
            <MapPinCheck size={16} aria-hidden="true" />
          ) : (
            <AlertTriangle size={16} aria-hidden="true" />
          )}
          <span>{result.message}</span>
        </p>
      ) : null}

      {!result && current?.failed ? (
        <p className={styles.no}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            We couldn&rsquo;t check delivery for this address just now. We will confirm it when
            you place the order — if it&rsquo;s outside our range we&rsquo;ll tell you straight
            away.
          </span>
        </p>
      ) : null}

      {result && !result.eligible && DETERMINATE_REFUSALS.has(result.outcome) ? (
        <p className={styles.detail}>
          Our store is in Marhatal, Jabalpur, so an address closer to the store is the one most
          likely to be in range.
        </p>
      ) : null}
    </div>
  );
}
