/**
 * Resend transport — SERVER ONLY.
 *
 * One job: hand a message to Resend, and report honestly whether it went. This
 * module contains no knowledge of orders, statuses or tracking links — that
 * knowledge belongs in api/_lib/notify.js. The separation is what lets the
 * transport be reasoned about on its own: it can be broken, slow or unconfigured
 * without any of that changing how an order is created.
 *
 * THE ONE RULE: nothing here throws.
 *
 * An email is a courtesy to the customer and a convenience to the shop, not a
 * condition of the purchase. A Resend outage, a DNS failure, a 422 from a domain
 * that has not finished verifying, or a slow socket must never turn a placed
 * order into a failed request — the customer would see "something went wrong",
 * retry, and place a *second* order, which is the exact harm this whole system
 * is built to prevent. So every path returns a result object, and callers treat
 * `sent: false` as a log line, not an error.
 *
 * Timeout is not optional. Without one, a hung connection holds a serverless
 * function open until the platform kills it, which costs money and can hit the
 * concurrency limit for the whole site.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** 8s. Comfortably inside a typical serverless budget, short enough to not notice. */
const REQUEST_TIMEOUT_MS = 8_000;

const env = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * The shop's own receiving address.
 *
 * Defaults to the operator's address so that configuring Resend is enough to get
 * working order alerts — the alternative is a site that looks configured and is
 * not, because one variable is missing. Override with JOC_NOTIFY_EMAIL if the
 * shop ever wants alerts somewhere other than the owner's inbox.
 */
export const DEFAULT_ADMIN_EMAIL = "anmolkewat369@gmail.com";

/** How the customer opens the tracking page. Fragments are never sent to a server. */
export const siteBaseUrl = () => env("JOC_SITE_URL") || "https://joc.vercel.app";

/**
 * Why a send did not happen. Values are stable strings so a dashboard or a test
 * can assert on them.
 */
export const EMAIL_REASONS = {
  NOT_CONFIGURED: "not_configured",
  NO_RECIPIENT: "no_recipient",
  TIMEOUT: "timeout",
  NETWORK: "network",
  REJECTED: "rejected",
};

/**
 * Resend configuration.
 *
 * `apiKey` and `from` are both required. `from` is intentionally NOT defaulted:
 * Resend will only send from a domain verified in the Resend account, so a
 * guessed default could only ever fail, and failing with "no sender configured"
 * is a clearer instruction than failing with a 403 from the provider.
 */
export function emailConfig() {
  const apiKey = env("RESEND_API_KEY");
  const from = env("JOC_NOTIFY_FROM");
  return {
    apiKey: apiKey || null,
    from: from || null,
    /** Admin alerts. Customer mail always uses the address on the order. */
    adminTo: env("JOC_NOTIFY_EMAIL") || DEFAULT_ADMIN_EMAIL,
    configured: Boolean(apiKey && from),
  };
}

export const isEmailConfigured = () => emailConfig().configured;

/**
 * Send one message.
 *
 * @returns {Promise<{sent: boolean, reason: string|null, id: string|null, status: number|null}>}
 *          Never rejects. `sent: true` means Resend accepted it, not that it
 *          arrived — no provider can promise delivery, and pretending otherwise
 *          would mean a false claim in a log.
 */
export async function sendEmail({ to, subject, text, html = null }) {
  const config = emailConfig();

  if (!config.configured) {
    return fail(EMAIL_REASONS.NOT_CONFIGURED, null);
  }

  // A recipient is never guessed. There is no fallback address for a customer:
  // sending one order's details to someone else is not a failure mode worth
  // having a default for.
  const recipients = (Array.isArray(to) ? to : [to])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    return fail(EMAIL_REASONS.NO_RECIPIENT, null);
  }

  if (!subject || !text) {
    return fail(EMAIL_REASONS.REJECTED, null);
  }

  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: recipients,
        subject,
        text,
        ...(html ? { html } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout is worth distinguishing from a dead socket: one is "try again in
    // a moment", the other is "check the network". Neither is reported as success.
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return fail(timedOut ? EMAIL_REASONS.TIMEOUT : EMAIL_REASONS.NETWORK, null, error);
  }

  if (!response.ok) {
    // The provider's message can name the domain and the key id, never the key
    // itself, so logging it is safe. It is truncated because a full error payload
    // in a serverless log is noise that hides the real failure.
    const detail = await response.text().catch(() => "");
    console.error(
      `[joc-email] resend rejected a message (${response.status}): ${detail.slice(0, 300)}`,
    );
    return fail(EMAIL_REASONS.REJECTED, null, null, response.status);
  }

  const payload = await response.json().catch(() => null);
  return { sent: true, reason: null, id: payload?.id ?? null, status: response.status };
}

/** Log once, plainly, naming the variables to set and never their values. */
let missingConfigLogged = false;

export function logEmailConfigurationOnce() {
  if (missingConfigLogged) return;
  const config = emailConfig();
  if (config.configured) return;
  missingConfigLogged = true;
  const missing = [];
  if (!config.apiKey) missing.push("RESEND_API_KEY");
  if (!config.from) missing.push("JOC_NOTIFY_FROM");
  console.warn(
    `[joc-email] email is off — set ${missing.join(" and ")} to enable it. ` +
      "Orders, delivery checks and the admin dashboard are unaffected.",
  );
}

function fail(reason, error, status = null, httpStatus = null) {
  if (error) console.error(`[joc-email] send failed (${reason}):`, error?.message ?? error);
  return { sent: false, reason, id: null, status: httpStatus ?? status };
}
