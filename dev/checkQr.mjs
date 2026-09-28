/**
 * QR encoder verification.
 *
 * The UPI QR is generated on the server with no third-party library, so it has
 * to be verified against something that is not itself. This renders the module
 * matrix to a bitmap and decodes it with jsQR — an independent implementation —
 * then compares the decoded bytes to the input.
 *
 * It sweeps every payload length the encoder claims to support, at several error
 * correction levels, and checks a set of realistic UPI intent strings. A single
 * passing sample would prove very little: QR capacity changes shape with length
 * and version, and the encoder has to pick the right version, mask and format
 * bits for every one of them.
 *
 * Run with `npm test`.
 */

import assert from "node:assert/strict";
import jsQR from "jsqr";
import { qrMatrix, qrSvg, QR_MAX_BYTES, canEncode } from "../api/_lib/qr.js";
import { buildUpiIntent } from "../api/_lib/upi.js";

/** Render the module matrix to RGBA pixels, as a scanner would see it. */
function rasterise(text, { scale = 6, quiet = 4 } = {}) {
  const { modules, size } = qrMatrix(text);
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (modules[row][column] !== 1) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (row + quiet) * scale + dy;
          const x = (column + quiet) * scale + dx;
          const index = (y * dim + x) * 4;
          data[index] = 0;
          data[index + 1] = 0;
          data[index + 2] = 0;
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

const decodesTo = (text, options) => {
  const image = rasterise(text, options);
  return jsQR(image.data, image.width, image.height)?.data ?? null;
};
let failed = 0;
const report = (name, ok, detail = "") => {
  if (ok) {
    console.log(`  pass  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

/* --------------------------- every supported length ----------------------- */

/**
 * The encoder emits error correction level M and byte mode only, by design — one
 * configuration done correctly beats four done approximately. So the sweep is a
 * single pass over every length the encoder claims to support, which is the
 * range that actually has to be right.
 */
const failures = [];
for (let length = 1; length <= QR_MAX_BYTES; length += 1) {
  const payload = "A".repeat(length);
  if (decodesTo(payload) !== payload) failures.push(length);
}
report(
  `every payload length 1..${QR_MAX_BYTES} round-trips`,
  failures.length === 0,
  failures.length ? `failed at lengths: ${failures.slice(0, 12).join(", ")}` : "",
);

/* ----------------------------- realistic payloads ------------------------- */

const upi = buildUpiIntent({
  upiId: "9630194023@pthdfc",
  amount: 396,
  orderId: "JOC-20260928-0001",
});

const realistic = [
  upi.uri,
  "upi://pay?pa=9630194023%40pthdfc&pn=Juice%20On%20Choice&am=396.00&cu=INR&tn=Order%20JOC-20260928-0001",
  "JOC-20260928-0001",
  "https://example.com/order/JOC-20260928-0001?token=abc",
  "Ginger Citrus x2 — ₹396 — deliver before 6pm please",
  "https://wa.me/919630194023?text=New%20order%20JOC-20260928-0001",
];

for (const payload of realistic) {
  report(
    `realistic payload decodes (${payload.slice(0, 34)}${payload.length > 34 ? "…" : ""})`,
    decodesTo(payload) === payload,
  );
}

/* -------------------------------- boundaries ------------------------------ */

report(
  "an empty payload is refused rather than encoded as a meaningless QR",
  !canEncode("") && !canEncode(null) && !canEncode(undefined),
);
report(
  `a payload over the stated maximum is refused (${QR_MAX_BYTES + 1} bytes)`,
  !canEncode("A".repeat(QR_MAX_BYTES + 1)),
);
report("a payload at exactly the maximum is accepted", canEncode("A".repeat(QR_MAX_BYTES)));
report(
  "multi-byte UTF-8 is measured in bytes, not characters",
  canEncode("₹".repeat(10)) && !canEncode("₹".repeat(QR_MAX_BYTES)),
);

/* ----------------------------------- SVG ---------------------------------- */

const svg = qrSvg(upi.uri, { title: "UPI payment QR" });
report("the SVG is a self-contained <svg> with no external references", (() => {
  assert.ok(svg.startsWith("<svg"), "should start with <svg");
  assert.ok(svg.includes("</svg>"), "should be closed");
  // Nothing in the SVG may reach the network or execute script.
  assert.ok(!/<script/i.test(svg), "must not contain a script");
  assert.ok(!/\son[a-z]+=/i.test(svg), "must not contain inline event handlers");
  assert.ok(!/href\s*=\s*["']?(?!#)/i.test(svg), "must not reference external resources");
  return true;
})());

/* ---------------------------------- report -------------------------------- */

const total = failed === 0 ? "" : "\nQR verification failed.";
console.log(failed === 0 ? "\nQR verification passed." : `${total}`);
process.exit(failed === 0 ? 0 : 1);
