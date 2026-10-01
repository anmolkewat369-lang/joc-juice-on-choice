/**
 * JOC delivery areas — the single, editable list of everywhere JOC delivers.
 *
 * THIS IS THE ONLY PLACE THE LIST LIVES. The checkout renders it, the server
 * validates against it, and the admin dashboard and order emails label an order
 * with it, so an area can never exist on screen but not in the API's rule.
 *
 * EDITING IT
 *   To add or remove an area, change the list below and nothing else. There is no
 *   environment variable, no database table and no admin screen to keep in step.
 *
 *   * `id` is permanent once an area has been used. It is stored on orders, so
 *     renaming an `id` orphans the historical orders that carry it.
 *   * `name` is what the customer reads. Change it freely.
 *
 * PROVISIONAL — CONFIRM WITH JOC BEFORE LAUNCH
 *   These names were compiled from the store's own locality (Dixit Colony,
 *   Marhatal, Jabalpur) and JOC's existing ~4 km coverage. They are a working
 *   list, not a promise JOC has made. Confirm the real set with JOC and edit this
 *   file; nothing else needs to change when you do.
 *
 * There is deliberately no coordinates, no radius and no geocoding anywhere near
 * this file. JOC decides what it delivers to by publishing this list, and the
 * customer picks from it — not by an address being measured against a pin.
 */

/**
 * The areas, in the order they are offered. `id` is the stable key sent to the
 * server and stored on the order; `name` is the customer-facing label.
 *
 * A `note` is optional extra context shown under the name (e.g. the landmark a
 * rider should head for). Keep it short — this is a one-line list on a phone.
 */
export const DELIVERY_AREAS = [
  { id: "marhatal", name: "Marhatal" },
  { id: "dixit-colony", name: "Dixit Colony" },
  { id: "rajeeev-gandhi-nagar", name: "Rajeev Gandhi Nagar" },
  { id: "wright-town", name: "Wright Town" },
  { id: "ranital", name: "Ranital" },
  { id: "napier-town", name: "Napier Town" },
  { id: "civil-lines", name: "Civil Lines" },
  { id: "cantoment", name: "Cantoment" },
  { id: "vijay-nagar", name: "Vijay Nagar" },
  { id: "sadar", name: "Sadar" },
  { id: "badi-bukaltan", name: "Badi Bukaltan" },
  { id: "adhartal", name: "Adhartal" },
  { id: "gadarwara", name: "Gadarwara" },
  { id: "maharana-pratap-nagar", name: "Maharana Pratap Nagar" },
  { id: "ranji-crossroad", name: "Ranji Crossroad" },
  { id: "sarvodaya-nagar", name: "Sarvodaya Nagar" },
  { id: "chandralok", name: "Chandralok Colony" },
  { id: "bayasi", name: "Bayasi" },
  { id: "belha", name: "Belha" },
  { id: "pani-ki-mandi", name: "Pani Ki Mandi" },
  { id: "sanjeevani-nagar", name: "Sanjeevani Nagar" },
  { id: "gomohu", name: "Gomohu" },
];

/** Fast membership lookup, so the server's check is not a linear scan. */
const AREAS_BY_ID = new Map(DELIVERY_AREAS.map((area) => [area.id, area]));

/**
 * Normalise a submitted area id.
 *
 * `String(value).trim().toLowerCase()` accepts what a well-behaved browser
 * sends, what a hand-written request sends, and what a customer would type into a
 * search box, and collapses them all onto the same key. Anything else — an
 * object, an array, `null` — becomes the empty string and is refused by
 * `isDeliveryArea`, never coerced into something that looks valid.
 */
export const normaliseAreaId = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** Is this one of JOC's configured areas? The single membership test. */
export const isDeliveryArea = (value) => AREAS_BY_ID.has(normaliseAreaId(value));

/** The configured area for an id, or null. Label text comes from here. */
export const deliveryAreaFor = (value) => AREAS_BY_ID.get(normaliseAreaId(value)) ?? null;

/**
 * Case- and whitespace-insensitive search, for the area picker.
 *
 * Returns every area when the query is empty so the customer can see the whole
 * list rather than an empty box that looks like a failure.
 */
export function searchDeliveryAreas(query) {
  const needle = normaliseAreaId(query).replace(/[^a-z0-9]+/g, " ");
  if (!needle.trim()) return DELIVERY_AREAS;
  return DELIVERY_AREAS.filter((area) => normaliseAreaId(area.name).includes(needle));
}