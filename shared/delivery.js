/**
 * Shared delivery contract.
 *
 * JOC decides what it delivers to by PUBLISHING A LIST OF AREAS, and the customer
 * picks one from it. There is no coordinate, no radius and no measured distance
 * anywhere in this file or in the API — the address a customer types is never
 * compared to a pin. The delivery question is answered by two facts instead:
 *
 *   1. the customer chose an area from the configured list (src/data/deliveryAreas.js)
 *   2. the customer explicitly confirmed the address they typed is correct and
 *      inside JOC's delivery area
 *
 * Both are enforced server-side by validateCheckout in shared/ordering.js. The
 * first is checked against the list rather than trusted, so a tampered request
 * cannot claim an area JOC does not serve. The second is stored on the order as an
 * audited fact, not as a convenience flag.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *   It cannot tell you whether an address is really inside an area. Nothing in
 *   this codebase can. That judgement is JOC's, made by the person who confirms
 *   the order, which is why an order lands as RECEIVED and waits for an admin.
 *
 * Imported by BOTH the React frontend and the Vercel serverless functions, so the
 * wording a customer reads and the wording the server enforces are the same
 * strings.
 */

import {
  DELIVERY_AREAS,
  deliveryAreaFor,
  isDeliveryArea,
  normaliseAreaId,
  searchDeliveryAreas,
} from "../src/data/deliveryAreas.js";

export {
  DELIVERY_AREAS,
  deliveryAreaFor,
  isDeliveryArea,
  normaliseAreaId,
  searchDeliveryAreas,
};

/* ------------------------------- The wording ------------------------------- */

/**
 * The customer-facing sentences, as shared constants rather than inline JSX.
 *
 * These strings are shown on the checkout, returned by the server when it refuses
 * a request, and echoed in the confirmation screen. Writing them once means the
 * sentence the customer agreed to is the sentence the server enforces.
 */

/** Stated above the address fields, before the customer has chosen an area. */
export const DELIVERY_AREA_NOTE =
  "JOC currently delivers within approximately 4 km by road. " +
  "Please select your area and enter your complete delivery address. " +
  "JOC will confirm delivery availability before preparing your order.";

/**
 * The required acknowledgement, verbatim in the UI, the server error and the
 * test that pins it.
 */
export const DELIVERY_AREA_CONFIRM_LABEL =
  "I confirm that the delivery address entered above is correct and is within JOC's delivery area.";

/** Shown when the customer tries to continue without ticking the box. */
export const DELIVERY_AREA_CONFIRM_REQUIRED =
  "Please confirm that your delivery address is correct and within JOC's delivery area.";

/** Shown when nothing has been chosen yet. */
export const DELIVERY_AREA_REQUIRED = "Please select your area from the list.";

/**
 * Shown when the submitted area is not one JOC serves.
 *
 * Deliberately does not name the areas JOC does not serve, and does not say
 * "that area is too far" — a customer outside the area is still a customer, and
 * this message is about correcting the selection, not refusing the order.
 */
export const DELIVERY_AREA_UNSUPPORTED =
  "That area is not in JOC's delivery list. Please choose an area from the list, or contact JOC.";

/** Label for the picker itself. */
export const DELIVERY_AREA_LABEL = "Delivery area";

/** Hint under the picker. */
export const DELIVERY_AREA_HINT = "Search and select the area you live in.";

/** What the customer sees once they have chosen, on the order summary. */
export const DELIVERY_AREA_SELECTED = (name) => `Area: ${name}`;

/**
 * The pending state, in one place.
 *
 * JOC has NOT verified that an address is deliverable when the customer orders.
 * It knows the customer picked an area and confirmed their address. Saying
 * anything stronger on the confirmation screen would be a claim nobody has made.
 */
export const DELIVERY_AREA_PENDING_LABEL = "Delivery confirmation pending";

export const DELIVERY_AREA_PENDING_NOTE =
  "We have your area and address. JOC will confirm delivery availability before preparing your order.";

/* ------------------------------ The rule ----------------------------------- */

/**
 * Validate the delivery area and the acknowledgement together.
 *
 * Returns the same `{ errors, valid, value }` shape as validateCheckout so the
 * checkout form, the server and the tests all read the same way. `area` is the
 * NORMALISED id and `areaName` is the label from the list — the label is resolved
 * here, from the configured data, so it can never be a client-supplied string that
 * reaches the admin dashboard or an email.
 *
 * The confirmation is compared to `true` exactly. `"true"`, `1` and `{}` are all
 * refusals: a string or number reaching this field means something is writing
 * orders from a source that does not understand the contract, and it does not get
 * to decide that the customer agreed to something.
 */
export function validateDeliveryArea(input) {
  const errors = {};

  const submitted = normaliseAreaId(input?.deliveryArea);
  const area = deliveryAreaFor(submitted);

  if (!submitted) {
    errors.deliveryArea = DELIVERY_AREA_REQUIRED;
  } else if (!area) {
    errors.deliveryArea = DELIVERY_AREA_UNSUPPORTED;
  }

  if (input?.deliveryAreaConfirmed !== true) {
    errors.deliveryAreaConfirmed = DELIVERY_AREA_CONFIRM_REQUIRED;
  }

  const valid = Object.keys(errors).length === 0;
  return {
    errors,
    valid,
    value: valid ? { area: area.id, areaName: area.name, confirmed: true } : null,
  };
}

/**
 * How the admin dashboard labels the delivery area on an order.
 *
 * An order with no area predates the list (it was placed under the old road-distance
 * rule) and says so plainly. `pending` is a genuine state, not an error: the order
 * has arrived and is waiting for JOC to confirm the address is deliverable.
 */
export function deliveryAreaStatusLabel(order) {
  if (!order?.deliveryArea) return "Not recorded";
  return order.deliveryAreaConfirmed === true
    ? "Confirmed by customer"
    : DELIVERY_AREA_PENDING_LABEL;
}

/**
 * The one-line delivery area as an admin reads it on a list row.
 *
 * Area + confirmation only. It never states a distance, because none is known.
 *
 * The label comes from the configured list when the area is still in it. If the area
 * has since been renamed or removed, the stored id is shown instead: an admin needs
 * to recognise that an id far more than they need a pretty name, and silently
 * dropping the area would hide the one order most likely to need a human decision.
 */
export function deliveryAreaSummary(order) {
  const area = order?.deliveryArea;
  if (!area) return "No area recorded";
  const confirmation = order?.deliveryAreaConfirmed === true ? "address confirmed" : "confirmation pending";
  return `${deliveryAreaFor(area)?.name ?? area} · ${confirmation}`;
}