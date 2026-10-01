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
 *     renaming an `id` orphans the historical orders that carry it. `dev/checkDelivery.mjs`
 *     pins the whole list, so a rename fails the test suite rather than silently
 *     detaching the id from the label.
 *   * `name` is exactly what the customer reads, on the picker, in the server's
 *     error copy and in the admin dashboard. Change it only when JOC renames the
 *     place, and prefer changing the `name` and leaving the `id` alone.
 *
 * WHAT THIS LIST IS AND IS NOT
 *   It is a convenience list for the customer to pick from, and it is what the
 *   admin reads when deciding whether an order can be delivered. Choosing an area
 *   does NOT prove the address is within any particular distance of the store —
 *   nothing measures that, and the customer is not told it has. The customer's
 *   exact address plus their own confirmation is what is stored, and JOC confirms
 *   delivery before preparing the order.
 *
 *   There is deliberately no coordinates, no radius and no geocoding anywhere near
 *   this file. JOC decides what it delivers to by publishing this list, and the
 *   customer picks from it — not by an address being measured against a pin.
 */

/**
 * The areas, in the order they are offered. `id` is the stable key sent to the
 * server and stored on the order; `name` is the customer-facing label.
 *
 * These 22 localities and landmarks are the ones JOC supplied, in the order JOC
 * listed them. Some are neighbourhoods, some are junctions, and some are specific
 * landmarks — all of them are places a rider recognises, which is what makes the
 * list worth searching.
 */
export const DELIVERY_AREAS = [
  { id: "dixit-colony", name: "Dixit Colony" },
  { id: "shri-ram-college-rd", name: "Shri Ram College Rd" },
  { id: "shri-ram-college", name: "Shri Ram College" },
  { id: "rajeev-gandhi-nagar", name: "Rajeev Gandhi Nagar" },
  { id: "karmeta", name: "Karmeta" },
  { id: "katangi-rd", name: "Katangi Rd" },
  { id: "madhotal", name: "Madhotal" },
  { id: "bhola-chowk", name: "Bhola Chowk" },
  { id: "thana-madhotal", name: "Thana Madhotal" },
  { id: "shri-ram-institute-of-technology", name: "Shri Ram Institute of Technology" },
  { id: "tata-motors-madhotal", name: "Tata Motors, Madhotal" },
  { id: "rajiv-gandhi-chowk", name: "Rajiv Gandhi Chowk" },
  { id: "transport-nagar", name: "Transport Nagar" },
  { id: "sheetalpuri", name: "Sheetalpuri" },
  { id: "ranital-lake-jabalpur", name: "Ranital Lake Jabalpur" },
  { id: "vijay-nagar", name: "Vijay Nagar" },
  { id: "kanchan-vihar", name: "Kanchan Vihar" },
  { id: "kachnar-city-shiva-temple", name: "Kachnar City Shiva Temple" },
  { id: "sanatan-chowk", name: "Sanatan Chowk" },
  { id: "gayatri-temple-transport-nagar", name: "Gayatri Temple, Transport Nagar" },
  { id: "rani-durgavati-museum", name: "Rani Durgavati Museum" },
  { id: "pisanhari-ki-madiya", name: "Pisanhari Ki Madiya" },
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
 * Fold a label or a search query to bare words: lowercased, every run of
 * punctuation or whitespace collapsed to a single space.
 *
 * The query and the names go through this identically, which is what makes a
 * search for "gayatri temple, transport nagar" find "Gayatri Temple, Transport
 * Nagar": without the shared transform the comma becomes a space in one string
 * and not the other, and the comparison silently fails.
 */
const foldToWords = (value) => normaliseAreaId(value).replace(/[^a-z0-9]+/g, " ");

/**
 * Case- and whitespace-insensitive search, for the area picker.
 *
 * Matches anywhere in the name, so "temple" finds both temple entries and "rd"
 * finds the two roads. Returns every area when the query is empty so the customer
 * can see the whole list rather than an empty box that looks like a failure.
 *
 * The order of DELIVERY_AREAS is preserved in the results, so searching narrows
 * the list without reordering it.
 */
export function searchDeliveryAreas(query) {
  const needle = foldToWords(query).trim();
  if (!needle) return DELIVERY_AREAS;
  return DELIVERY_AREAS.filter((area) => foldToWords(area.name).includes(needle));
}
