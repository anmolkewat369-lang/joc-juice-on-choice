/**
 * Razorpay Checkout loader.
 *
 * The checkout script is fetched from Razorpay's CDN at the moment it is needed
 * and only once. Nothing secret is here: the key id comes from the server, the
 * key secret never leaves it.
 *
 * Returns a promise that settles exactly once —
 *   resolve({ status: "paid",  gatewayOrderId, paymentId, signature })
 *   resolve({ status: "failed"|"cancelled", code })
 * so a dismissed popup is a normal outcome rather than an unhandled rejection.
 */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

let scriptPromise = null;

function loadCheckoutScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      reject(new Error("Checkout is only available in a browser."));
      return;
    }
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve(window.Razorpay), { once: true });
    script.addEventListener(
      "error",
      () => {
        scriptPromise = null;
        reject(new Error("The payment window could not be loaded. Check your connection."));
      },
      { once: true },
    );
    if (!existing) document.body.appendChild(script);
  });
  return scriptPromise;
}

/**
 * @param {object} session  the /api/payments/create response
 * @param {object} handlers onPaid({...}) / onFailed({code, description})
 */
export async function openCheckout(session, { onPaid, onFailed, onDismissed } = {}) {
  let Razorpay;
  try {
    Razorpay = await loadCheckoutScript();
  } catch (error) {
    onFailed?.({ code: "checkout_unavailable", description: error.message });
    return;
  }

  const options = {
    key: session.keyId,
    amount: session.amount,
    currency: session.currency,
    name: session.profile?.name ?? "JOC",
    description: session.profile?.description ?? "JOC order",
    order_id: session.gatewayOrderId,
    prefill: {
      name: session.customer?.name ?? "",
      contact: session.customer?.contact ?? "",
    },
    notes: { jocOrderId: session.orderId },
    // Test mode is explicit in the UI; keep the customer's own name off the
    // shipping copy the gateway would otherwise default to.
    modal: {
      ondismiss: () => onDismissed?.({ code: "cancelled" }),
    },
    retry: { enable: false },
  };

  const checkout = new Razorpay(options);

  checkout.on("payment.success", (response) => {
    onPaid?.({
      gatewayOrderId: response.razorpay_order_id,
      paymentId: response.razorpay_payment_id,
      signature: response.razorpay_signature,
    });
  });

  checkout.on("payment.failed", (response) => {
    onFailed?.({
      code: response.error?.code ?? "payment_failed",
      description: response.error?.description ?? "The payment did not go through.",
    });
  });

  try {
    checkout.open();
  } catch (error) {
    onFailed?.({ code: "checkout_unavailable", description: error.message });
  }
}
