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
  // Source used to build the demo menu dataset. Not affiliated with Swiggy.
  menuSource:
    "https://www.swiggy.com/city/jabalpur/joc-juice-and-cafe-dixit-colony-shri-ram-college-rest1447626",
};

/**
 * Temporary developer contact details.
 * These are NOT official JOC contact details — the business contact number and
 * email are not publicly verified, so the demo routes enquiries to the
 * developer who built the concept.
 */
export const CONTACT = {
  isOfficial: false,
  label: "Temporary demo contact",
  name: "Anmol Kewat",
  role: "Website concept by",
  phoneDisplay: "+91 96301 94023",
  phoneRaw: "+919630194023",
  /** Digits only, international format without the "+" — wa.me requires this. */
  phoneDigits: "919630194023",
  email: "anmolkewat369@gmail.com",
  whatsappMessage:
    "Hi Anmol, I saw the JOC Juice and Cafe website demo and would like to know more about the website.",
};

export const WHATSAPP_URL = `https://wa.me/${CONTACT.phoneDigits}?text=${encodeURIComponent(
  CONTACT.whatsappMessage,
)}`;

export const MAILTO_URL = `mailto:${CONTACT.email}?subject=${encodeURIComponent(
  "Enquiry about the JOC Juice and Cafe website concept",
)}&body=${encodeURIComponent(
  "Hi Anmol,\n\nI saw the JOC Juice and Cafe website demo and would like to know more about the website.\n\n",
)}`;

/** Visible but deliberately understated. */
export const DISCLAIMER_SHORT =
  "Concept website prepared for demonstration purposes.";

/** Full wording used in the footer. */
export const DISCLAIMER_FULL =
  "Concept website prepared for demonstration purposes. Menu, pricing, branding and business information should be confirmed with JOC before production launch.";

/** Internal/content note — surfaced quietly on the menu section. */
export const PRICING_NOTE =
  "Demo menu and prices are taken from the current public listing. Please confirm the final menu and pricing with the business before launch.";

export const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Menu", href: "#menu" },
  { label: "About", href: "#about" },
  { label: "Gallery", href: "#gallery" },
  { label: "Location", href: "#location" },
];
