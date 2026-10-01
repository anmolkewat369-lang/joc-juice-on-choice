/**
 * Footer QA — the footer must carry the WhatsApp and Contact actions on mobile.
 *
 * WHY THIS IS A SCRIPT AND NOT A GLANCE AT THE JSX
 *   The contact block used to live in the footer and was removed from the file,
 *   leaving the footer valid, building, linted, styled and rendered — with no
 *   contact on it anywhere, so a phone user who scrolled to the bottom had no way
 *   to start a conversation. Nothing failed. The only way to catch a whole section
 *   going missing is to render the component and read what it actually emits.
 *
 * HOW THE RENDER IS DONE
 *   The component is built with the project's own Vite config into a throwaway
 *   bundle, then rendered to static markup with react-dom/server. The assertions
 *   below therefore run against the real component, the real business config and
 *   the real markup a browser receives — not a regex over the source. The repo has
 *   no headless browser and needs none: the bug was absence from the tree, and
 *   absence is plain in the markup.
 *
 *   The bundle is written under node_modules/.cache (so its bare `react` and
 *   `lucide-react` imports resolve against the project's own node_modules) and is
 *   deleted afterwards. Git ignores node_modules, so nothing enters the
 *   repository. It runs as part of `npm test`.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}`);
    console.log(
      String(error && error.message ? error.message : error)
        .split("\n")
        .map((line) => `        ${line}`)
        .join("\n"),
    );
    process.exitCode = 1;
  }
}

/* ------------------------- render the real footer ------------------------- */

/** The number already configured for this project before any of this work. */
const CONFIGURED_NUMBER = "919630194023";

let html = "";
try {
  const bundleDir = join(ROOT, "node_modules", ".cache", "joc-footer-check");
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "node_modules", "vite", "bin", "vite.js"),
        "build",
        "--ssr",
        "src/components/Footer.jsx",
        "--outDir",
        bundleDir,
        "--logLevel",
        "silent",
        "--emptyOutDir",
      ],
      { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
    );
    const { default: Footer } = await import(pathToFileURL(join(bundleDir, "Footer.js")).href);
    html = renderToStaticMarkup(createElement(Footer));
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
} catch (error) {
  console.log(`FAIL  the footer could not be rendered`);
  console.log(String(error?.stdout || error?.message || error));
  process.exitCode = 1;
}

/* ----------------------- render the real sticky CTA ----------------------- */

let ctaHtml = "";
try {
  const bundleDir = join(ROOT, "node_modules", ".cache", "joc-sticky-check");
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "node_modules", "vite", "bin", "vite.js"),
        "build",
        "--ssr",
        "src/components/StickyCta.jsx",
        "--outDir",
        bundleDir,
        "--logLevel",
        "silent",
        "--emptyOutDir",
      ],
      { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
    );
    const { default: StickyCta } = await import(
      pathToFileURL(join(bundleDir, "StickyCta.js")).href
    );
    ctaHtml = renderToStaticMarkup(createElement(StickyCta));
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
} catch (error) {
  console.log("FAIL  the sticky CTA could not be rendered");
  console.log(String(error?.stdout || error?.message || error));
  process.exitCode = 1;
}

/* --------------------------- the contact block --------------------------- */

check("the footer renders the Contact Us details", () => {
  assert.ok(html.length > 200, "the footer rendered almost nothing");
  assert.match(html, /Contact Us/i, "there is no Contact Us section");
  assert.match(html, /Anmol Kewat/, "the contact name is missing");
  assert.match(html, /\+91 96301 94023/, "the contact number is missing");
  assert.match(html, /anmolkewat369@gmail\.com/, "the contact email is missing");
  assert.match(html, /not an official JOC contact/i, "the contact is not marked unofficial");
});

check("the footer's WhatsApp action opens the already-configured number", () => {
  const link = html.match(
    /href="(https:\/\/(?:wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)[^"]*)"/,
  );
  assert.ok(link, "there is no WhatsApp action in the footer");
  assert.ok(
    link[1].includes(CONFIGURED_NUMBER),
    `the WhatsApp action points at ${link[1]} instead of the configured ${CONFIGURED_NUMBER}`,
  );
  assert.match(link[1], /[?&]text=/, "the WhatsApp action opens a chat with no prefilled message");
});

check("the number and email are tap targets, not just text", () => {
  assert.match(html, /href="tel:\+919630194023"/, "the number is not a tap-to-call link");
  assert.match(
    html,
    /href="mailto:anmolkewat369@gmail\.com\?subject=/,
    "the email address is not a mailto link",
  );
});

check("the contact block is not conditional on the viewport", () => {
  // The regression was a section that only rendered on wide screens, so it was
  // correctly absent from the mobile DOM. Nothing may hide it: not the markup and
  // not the component branching on width.
  for (const [, tag, attrs] of html.matchAll(/<(footer|div|section|address|nav)([^>]*)>/g)) {
    assert.doesNotMatch(attrs, /\shidden(\s|=|$)/i, `<${tag}> carries hidden: ${attrs}`);
    assert.doesNotMatch(
      attrs,
      /style="[^"]*display:\s*none/i,
      `<${tag}> is display:none inline: ${attrs}`,
    );
  }
  assert.doesNotMatch(
    html,
    /aria-hidden="true"[^>]*>\s*(Contact Us|WhatsApp|Anmol Kewat)/i,
    "the contact block is hidden from assistive tech",
  );

  const source = read("src/components/Footer.jsx");
  for (const banned of ["innerWidth", "matchMedia", "isDesktop", "showContact", "useMedia"]) {
    assert.equal(
      source.includes(banned),
      false,
      `Footer.jsx branches on ${banned} — contact details must render for every viewport`,
    );
  }
});

check("no stylesheet rule hides the contact block on a small screen", () => {
  const css = stripCssComments(read("src/components/Footer.module.css"));
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\bdisplay:\s*none/i.test(body)) continue;
    assert.doesNotMatch(
      selector,
      /\.(contact|whatsapp|devName|links)\b/,
      `"${selector.trim()}" hides the contact block with display:none`,
    );
  }
});

/* -------------------- footer content that must not vanish -------------------- */

check("the footer's pre-existing content and links are all still there", () => {
  for (const needle of [
    "JOC Juice and Cafe",
    "Explore",
    "Visit JOC",
    "Get directions",
    "https://maps.app.goo.gl/1eDZuaxy2joC5RTYA",
  ]) {
    assert.ok(html.includes(needle), `the footer lost: ${needle}`);
  }
  for (const label of ["Home", "Menu", "About", "Gallery", "Location"]) {
    assert.ok(html.includes(`>${label}<`), `the footer lost the ${label} link`);
  }
  assert.match(html, /Copyright \d{4} JOC Juice and Cafe\./, "the copyright line changed shape");
});

/* --------------- the footer and the sticky CTA cannot drift --------------- */

check("the footer reserves room for the fixed mobile Get Directions button", () => {
  // The CTA is position:fixed to the bottom of the viewport on every screen under
  // 900px. If the footer never adds clearance at that same breakpoint, the CTA
  // permanently covers the footer's last rows — which is where the contact block's
  // WhatsApp button and email sit on a phone.
  const cta = stripCssComments(read("src/components/StickyCta.module.css"));
  const hiddenAt = cta.match(/@media\s*\(min-width:\s*(\d+)px\)\s*\{\s*\.bar\s*\{[^}]*display:\s*none/);
  assert.ok(hiddenAt, "StickyCta.module.css no longer hides .bar at a min-width breakpoint");
  const barBreakpoint = Number(hiddenAt[1]);

  const footer = stripCssComments(read("src/components/Footer.module.css"));
  const clearance = [...footer.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)]
    .filter(([, width]) => Number(width) === barBreakpoint - 1)
    .some(([, , body]) => /padding-bottom:[^;]*\b(4rem|5rem|6rem|7rem)\b/.test(body));
  assert.ok(
    clearance,
    `Footer.module.css has no bottom-padding clearance at max-width:${barBreakpoint - 1}px, ` +
      `so the fixed CTA overlaps the footer below ${barBreakpoint}px`,
  );
});

check("no long contact value can force the page into a sideways scroll", () => {
  const css = stripCssComments(read("src/components/Footer.module.css"));
  // The narrow layout is a single implicit grid column; the multi-column desktop
  // layout only appears inside a min-width query. If the base rule ever gains a
  // fixed multi-column template, a long email can push the page sideways on a phone.
  const baseTop = css.match(/\.top\s*\{([^}]*)\}/);
  assert.ok(baseTop, ".top has no base rule");
  assert.match(baseTop[1], /display:\s*grid/, ".top is not a grid");
  assert.doesNotMatch(
    baseTop[1],
    /grid-template-columns:\s*[^;]*\b1fr\b[^;}]*\b1fr\b/,
    ".top sets multiple base columns outside a media query",
  );
  assert.match(css, /@media\s*\(min-width:[^)]+\)\s*\{[\s\S]*?grid-template-columns/, "no desktop layout");
  assert.match(css, /overflow-wrap:\s*anywhere|word-break:\s*break-word/, "no wrap protection");
  assert.match(css, /\.contact\s*\{[^}]*min-width:\s*0/, ".contact can still stretch past its track");
});

/* ------------- one number, in the one place it is configured ------------- */

check("the number in the footer is the one this project already used", () => {
  const business = read("src/data/business.js");
  assert.match(
    business,
    new RegExp(`phoneDigits:\\s*"${CONFIGURED_NUMBER}"`),
    "src/data/business.js no longer carries the configured number",
  );
  assert.ok(
    read(".env.example").includes(`JOC_WHATSAPP_NUMBER=${CONFIGURED_NUMBER}`),
    ".env.example must document the same number the footer shows",
  );
});

/* ------------- the mobile sticky bar offers both key actions ------------- */

check("the mobile sticky CTA carries WhatsApp and Get Directions", () => {
  assert.ok(ctaHtml.length > 100, "the sticky CTA rendered almost nothing");
  const wa = ctaHtml.match(/href="(https:\/\/wa\.me[^"]*)"/);
  assert.ok(wa, "the sticky CTA has no WhatsApp action");
  assert.ok(
    wa[1].includes(CONFIGURED_NUMBER),
    `the sticky WhatsApp action points at ${wa[1]} instead of ${CONFIGURED_NUMBER}`,
  );
  assert.match(wa[1], /[?&]text=/, "the sticky WhatsApp action has no prefilled message");
  assert.match(wa[1], /%20/, "the sticky WhatsApp message is not URL-encoded");
  assert.match(
    ctaHtml,
    /href="https:\/\/maps\.app\.goo\.gl\/[^"]*"/,
    "the sticky CTA lost its Get Directions action",
  );
  assert.match(ctaHtml, /Get Directions/);
});

check("every WhatsApp action builds from the one helper, without an order token", () => {
  assert.match(
    read("src/data/business.js"),
    /export const whatsappUrl\b/,
    "business.js has no shared whatsappUrl helper",
  );
  const tracking = read("src/components/order/OrderConfirmation.jsx");
  assert.match(tracking, /whatsappUrl\(/, "the tracking page uses no shared WhatsApp helper");
  assert.doesNotMatch(tracking, /wa\.me/, "the tracking page hard-codes a wa.me number");
  assert.doesNotMatch(
    tracking,
    /whatsappUrl\([^)]*trackingToken/,
    "the tracking page puts the tracking token in a WhatsApp message",
  );
  const mine = read("src/account/MyOrdersView.jsx");
  assert.match(mine, /whatsappUrl\(/, "My Orders uses no shared WhatsApp helper");
  assert.doesNotMatch(mine, /wa\.me/, "My Orders hard-codes a wa.me number");
});

const TOTAL = 11;
console.log(`\n${passed}/${TOTAL} footer checks passed`);
if (process.exitCode) console.log("footer checks FAILED");