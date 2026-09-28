/**
 * Order flow orchestration: details -> order -> payment -> confirmation.
 *
 * One place owns the state machine so the checkout form, the confirmation
 * screen and the payment retry buttons cannot disagree about what is happening.
 *
 *   idle ─submit─▶ submitting ─COD──────────────▶ done
 *                       │ ONLINE
 *                       ▼
 *                    paying ──paid──▶ verifying ──▶ done
 *                       │
 *                       └──failed / dismissed──▶ failed
 *
 * The idempotency key is minted once per attempt and reused for every retry of
 * that attempt, so a double click, a refresh or a network retry resolves to the
 * same order instead of a second one.
 */

import { useCallback, useRef, useState } from "react";
import {
  createOrder,
  startPayment,
  verifyPayment,
  abandonPayment,
  newIdempotencyKey,
  ApiRequestError,
} from "./api.js";
import { PAYMENT_METHOD } from "../../shared/ordering.js";
import { openCheckout } from "./razorpay.js";

export const FLOW = {
  IDLE: "idle",
  SUBMITTING: "submitting",
  PAYING: "paying",
  VERIFYING: "verifying",
  FAILED: "failed",
};

export const isBusy = (flow) =>
  flow === FLOW.SUBMITTING || flow === FLOW.PAYING || flow === FLOW.VERIFYING;

export function useOrderFlow({ onComplete }) {
  const [flow, setFlow] = useState(FLOW.IDLE);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [testMode, setTestMode] = useState(false);
  /**
   * An online order was created but the payment could not be started (for
   * example no gateway is configured). The order exists server-side, so the
   * checkout can offer to convert it to COD instead of pretending it never
   * happened or letting the customer tap Pay Now again into the same wall.
   */
  const [pendingOrderId, setPendingOrderId] = useState(null);
  const idempotencyKey = useRef(null);
  const inFlight = useRef(false);

  const fail = useCallback((caught) => {
    setFlow(FLOW.FAILED);
    setError(
      caught instanceof ApiRequestError
        ? caught
        : new ApiRequestError("Something went wrong. Please try again.", {
            code: "unexpected_error",
          }),
    );
  }, []);

  /* ----------------------------- place an order ---------------------------- */

  const placeOrder = useCallback(
    async ({ items, details }) => {
      if (inFlight.current) return null; // hard stop on a double click
      inFlight.current = true;
      idempotencyKey.current ??= newIdempotencyKey();
      setError(null);
      setMessage(null);
      setFlow(FLOW.SUBMITTING);

      try {
        const result = await createOrder(
          {
            items: items.map(({ id, qty }) => ({ id, qty })),
            name: details.name,
            phone: details.phone,
            address: details.address,
            landmark: details.landmark,
            instructions: details.instructions,
            paymentMethod: details.paymentMethod,
          },
          idempotencyKey.current,
        );

        const { order, created, storage } = result;
        if (!created) setMessage("We already had this order, so nothing was duplicated.");

        if (details.paymentMethod === PAYMENT_METHOD.COD) {
          setFlow(FLOW.IDLE);
          onComplete?.({ order, outcome: null, storage });
          return order;
        }

        const paid = await runPayment({
          orderId: order.orderId,
          setPendingOrderId,
          ui: { setFlow, setMessage, setTestMode, fail, setError, onComplete },
        });
        return paid.order;
      } catch (caught) {
        fail(caught);
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [fail, onComplete],
  );

  /* ------------------------------ online payment --------------------------- */

  const retryPayment = useCallback(
    async (orderId) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setError(null);
      setMessage(null);
      setFlow(FLOW.PAYING);
      try {
        return await runPayment({
          orderId,
          setPendingOrderId,
          ui: { setFlow, setMessage, setTestMode, fail, setError, onComplete },
        });
      } catch (caught) {
        fail(caught);
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [fail, onComplete],
  );

  /** An online order the customer cannot pay for becomes a cash order, in place. */
  const switchToCod = useCallback(
    async (orderId) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setError(null);
      setFlow(FLOW.SUBMITTING);
      try {
        const order = await abandonPayment({ orderId, paymentMethod: PAYMENT_METHOD.COD });
        setFlow(FLOW.IDLE);
        setPendingOrderId(null);
        onComplete?.({ order, outcome: null, switchedToCod: true });
        return order;
      } catch (caught) {
        fail(caught);
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [fail, onComplete],
  );

  /** Called after a confirmed order so the next order gets a fresh key. */
  const reset = useCallback(() => {
    idempotencyKey.current = null;
    setFlow(FLOW.IDLE);
    setError(null);
    setMessage(null);
    setPendingOrderId(null);
  }, []);

  return { flow, error, message, testMode, pendingOrderId, placeOrder, retryPayment, switchToCod, reset };
}

/* -------------------------------- internals ------------------------------- */

/**
 * Opens Razorpay Checkout and settles when the payment reaches a terminal
 * state. Resolves `{ order, outcome }` rather than throwing, because a dismissed
 * popup is a normal outcome and not an error.
 */
async function runPayment({ orderId, setPendingOrderId, ui }) {
  const session = await startPayment(orderId).catch((caught) => {
    // The order exists but the customer cannot pay right now (typically no
    // gateway configured). Remember the order so the UI can convert it to COD.
    if (caught?.code === "payments_unavailable") setPendingOrderId(orderId);
    ui.fail(caught);
    return null;
  });
  if (!session) return { order: { orderId }, outcome: null };

  ui.setTestMode(Boolean(session.testMode));
  setPendingOrderId(null);

  return new Promise((resolve) => {
    openCheckout(session, {
      async onPaid({ gatewayOrderId, paymentId, signature }) {
        ui.setFlow(FLOW.VERIFYING);
        try {
          const paid = await verifyPayment({ orderId, gatewayOrderId, paymentId, signature });
          ui.setFlow(FLOW.IDLE);
          const result = { order: paid, outcome: null };
          ui.onComplete?.(result);
          resolve(result);
        } catch (caught) {
          // Verification failed. The order is left FAILED — never PAID.
          ui.fail(caught);
          const current = await abandonPayment({ orderId }).catch(() => null);
          const result = {
            order: current ?? { orderId },
            outcome: {
              status: "failed",
              description:
                "We could not confirm your payment, so it has not been recorded as paid.",
            },
          };
          ui.onComplete?.(result);
          resolve(result);
        }
      },

      async onFailed({ description }) {
        ui.setError(null);
        const current = await abandonPayment({ orderId }).catch(() => null);
        ui.setFlow(FLOW.FAILED);
        const result = {
          order: current ?? { orderId },
          outcome: { status: "failed", description: description || "The payment did not go through." },
        };
        ui.onComplete?.(result);
        resolve(result);
      },

      async onDismissed() {
        const current = await abandonPayment({ orderId }).catch(() => null);
        ui.setFlow(FLOW.FAILED);
        const result = {
          order: current ?? { orderId },
          outcome: { status: "cancelled", description: "You closed the payment window." },
        };
        ui.onComplete?.(result);
        resolve(result);
      },
    });
  });
}
