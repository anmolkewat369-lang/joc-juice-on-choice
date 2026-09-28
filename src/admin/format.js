/**
 * Formatting for the dashboard.
 *
 * Kept separate from the storefront's formatting so the admin bundle does not
 * import menu data, prices or anything customer-facing it has no use for.
 */

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export const formatPrice = (amount) => currency.format(Number(amount ?? 0));

const dateTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Tolerant of a missing or malformed timestamp — the admin should never crash. */
export const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
};
