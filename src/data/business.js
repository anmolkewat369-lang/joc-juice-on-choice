/**
 * Business information.
 *
 * VERIFIED  — taken from the business's public listing / Google Maps location.
 * DEMO      — placeholder or concept content that MUST be confirmed with the
 *             client before the site goes live.
 */

export const BRAND = {
  name: "JOC Juice and Cafe",
  wordmark: "JOC",
  tagline: "Juice On Choice",
  // Temporary text wordmark. Swap for the client's real logo file when supplied.
  logoNote: "Temporary text wordmark — replace with the official JOC logo when available.",
  categoryLine: "Fresh juices • Shakes • Coffee • Quick Bites",
  fssai: "21426170001578",
};

export const ADDRESS = {
  line1: "Plot No. 207, Dixit Colony, Marhatal",
  line2: "Jabalpur, Madhya Pradesh — 482002",
  country: "India",
};

export const LINKS = {
  maps: "https://maps.app.goo.gl/1eDZuaxy2joC5RTYA",
  // Source used to compile menu entries from a public listing. Not affiliated with Swiggy.
  menuSource:
    "https://www.swiggy.com/city/jabalpur/joc-juice-and-cafe-dixit-colony-shri-ram-college-rest1447626",
};

/** Internal/content note — surfaced quietly on the menu section. */
export const PRICING_NOTE =
  "Menu and prices are based on the current public listing and may change.";

export const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Menu", href: "#menu" },
  { label: "About", href: "#about" },
  { label: "Gallery", href: "#gallery" },
  { label: "Location", href: "#location" },
];
