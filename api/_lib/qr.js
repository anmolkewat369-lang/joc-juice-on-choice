/**
 * Minimal QR Code generator (byte mode, error correction level M).
 *
 * Why this exists rather than an image service or a dependency:
 *   * a UPI payment QR encodes a UPI ID and an amount. Sending that to a
 *     third-party image service would leak a live payment address to that
 *     third party on every render;
 *   * the amount must come from the server-side order total, and rendering it
 *     server-side keeps it authoritative;
 *   * a self-contained encoder adds no runtime dependency to the bundle.
 *
 * Scope is deliberately narrow and fails loudly rather than guessing: byte
 * mode, level M, versions 1-10 (up to 213 bytes of payload — a full UPI intent
 * URI with every field fits comfortably). Anything longer throws, so a caller
 * can never render a truncated payment URI that a customer would pay the wrong
 * amount towards.
 *
 * Verification: every payload length from 1 to 213 bytes, at several module
 * scales, was rasterised and decoded by an independent QR decoder
 * (jsQR) and matched the input byte for byte. See dev/checkQr.mjs, run with
 * `npm test`.
 *
 * Reference: ISO/IEC 18004.
 */

/* ----------------------------- spec constants ---------------------------- */

/** Total codewords per version (1-10). */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/** Level M: [ecCodewordsPerBlock, blockCount] per version. */
const EC_M = {
  1: [10, 1],
  2: [16, 1],
  3: [26, 1],
  4: [18, 2],
  5: [24, 2],
  6: [16, 4],
  7: [18, 4],
  8: [22, 4],
  9: [22, 5],
  10: [26, 5],
};

/** Centre coordinates of the alignment patterns, per version. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const EC_M_FORMAT_BITS = 0b00; // format information encodes level M as 00
const MAX_VERSION = 10;
const VERSION_INFO_MIN = 7; // versions 7+ carry an extra information block

function dataCodewords(version) {
  const [ec, blocks] = EC_M[version];
  return TOTAL_CODEWORDS[version] - ec * blocks;
}

/** Byte-mode payload capacity for a version, in bytes. */
function capacity(version) {
  // Versions 1-9 use an 8-bit character count, 10-26 use 16 bits.
  return dataCodewords(version) - (version < 10 ? 2 : 3);
}

/* ------------------------------ bit plumbing ----------------------------- */

class BitBuffer {
  constructor() {
    this.bits = [];
  }

  push(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length() {
    return this.bits.length;
  }
}

function toBytes(buffer) {
  const bytes = [];
  for (let i = 0; i < buffer.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (buffer.bits[i + j] ?? 0);
    bytes.push(byte);
  }
  return bytes;
}

/* ----------------------------- Galois field ------------------------------ */

/** GF(256) arithmetic with the QR primitive polynomial 0x11d. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error-correction codewords. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecCodewords(data, degree) {
  const gen = generatorPoly(degree);
  const remainder = new Array(data.length + degree).fill(0);
  for (let i = 0; i < data.length; i += 1) remainder[i] = data[i];
  for (let i = 0; i < data.length; i += 1) {
    const factor = remainder[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j += 1) {
      remainder[i + j] ^= gfMul(gen[j], factor);
    }
  }
  return remainder.slice(data.length);
}

/* -------------------------------- encoding ------------------------------- */

/**
 * Byte-mode bit stream for `text`: mode indicator, character count, data,
 * terminator, pad to a byte boundary, then alternating pad codewords.
 */
function encodeData(text, version) {
  const bytes = [...Buffer.from(text, "utf8")];
  if (bytes.length > capacity(version)) {
    throw new Error("Payload too long for the supported QR versions.");
  }

  const buffer = new BitBuffer();
  buffer.push(0b0100, 4); // byte mode
  buffer.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.push(byte, 8);
  const capacityBits = dataCodewords(version) * 8;
  buffer.push(0, Math.min(4, capacityBits - buffer.length)); // terminator
  while (buffer.length % 8 !== 0) buffer.push(0, 1);

  const codewords = toBytes(buffer);
  const padBytes = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCodewords(version); i += 1) {
    codewords.push(padBytes[i % 2]);
  }
  return codewords;
}

/**
 * Split into blocks, compute EC per block, then interleave both.
 *
 * The split is not arbitrary: the spec's tables list the *shorter* data blocks
 * first and the longer ones last, and a decoder reconstructs the block
 * structure from the version and error-correction level alone. Any other split
 * produces a symbol that scans as garbage.
 */
function interleave(dataCodewordList, version) {
  const [ecPerBlock, blockCount] = EC_M[version];
  const short = Math.floor(dataCodewordList.length / blockCount);
  const longerBlocks = dataCodewordList.length % blockCount;

  const blocks = [];
  let cursor = 0;
  for (let i = 0; i < blockCount; i += 1) {
    const length = i < blockCount - longerBlocks ? short : short + 1;
    blocks.push(dataCodewordList.slice(cursor, cursor + length));
    cursor += length;
  }

  const ecBlocks = blocks.map((block) => ecCodewords(block, ecPerBlock));
  const out = [];
  for (let i = 0; i < short + 1; i += 1) {
    for (const block of blocks) {
      if (i < block.length) out.push(block[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* --------------------------------- matrix -------------------------------- */

class Matrix {
  constructor(size) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
    this.reserved = Array.from({ length: size }, () => new Uint8Array(size));
  }
}

function placeFinder(modules, reserved, row, col, size) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const inRing =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      modules[rr][cc] = inRing ? 1 : 0;
      reserved[rr][cc] = 1;
    }
  }
}

function placeAlignment(modules, reserved, centres) {
  const last = centres.length - 1;
  for (let i = 0; i < centres.length; i += 1) {
    for (let j = 0; j < centres.length; j += 1) {
      // Skip the three corners already occupied by finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const centreR = centres[i];
      const centreC = centres[j];
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const onRing = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          modules[centreR + r][centreC + c] = onRing ? 1 : 0;
          reserved[centreR + r][centreC + c] = 1;
        }
      }
    }
  }
}

function placeTiming(modules, reserved, size) {
  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0 ? 1 : 0;
    if (modules[6][i] === -1 && !reserved[6][i]) {
      modules[6][i] = value;
      reserved[6][i] = 1;
    }
    if (modules[i][6] === -1 && !reserved[i][6]) {
      modules[i][6] = value;
      reserved[i][6] = 1;
    }
  }
}

/** Dark module, always at (4 * version + 9, 8). */
function placeDarkModule(modules, reserved, version) {
  modules[4 * version + 9][8] = 1;
  reserved[4 * version + 9][8] = 1;
}

/**
 * The 18-bit version information block carried by versions 7 and above:
 * BCH(18,6) of the version number, generator 0x1f25, no masking. It is written
 * twice, above the bottom-left finder and to the right of the top-right one.
 */
function placeVersionBits(modules, reserved, version, size) {
  if (version < VERSION_INFO_MIN) return;

  let rem = version << 12;
  for (let i = 0; i < 12; i += 1) {
    if (rem & (1 << (17 - i))) rem ^= 0x1f25 << (5 - i);
  }
  const value = (version << 12) | (rem & 0xfff);

  for (let i = 0; i < 18; i += 1) {
    const bit = (value >>> i) & 1;
    const offset = size - 11;
    // Bottom-left block: three rows of six, then the top-right mirror of it.
    const r1 = size - 11 + (i % 3);
    const c1 = Math.floor(i / 3);
    modules[r1][c1] = bit;
    reserved[r1][c1] = 1;
    const r2 = Math.floor(i / 3);
    const c2 = offset + (i % 3);
    modules[r2][c2] = bit;
    reserved[r2][c2] = 1;
  }
}

/** Reserve the format-information areas plus the dark module beside them. */
function reserveFormatAreas(modules, reserved, size) {
  for (let i = 0; i < 9; i += 1) {
    if (modules[8][i] === -1) reserved[8][i] = 1;
    if (modules[i][8] === -1) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i += 1) {
    if (modules[8][size - 1 - i] === -1) reserved[8][size - 1 - i] = 1;
    if (modules[size - 1 - i][8] === -1) reserved[size - 1 - i][8] = 1;
  }
}

/**
 * The 15 format bits (error-correction level + mask), BCH(15,5)-protected and
 * XORed with 0x5412, written to both copies of the symbol.
 *
 * Bit 0 is the least significant bit of the 15-bit format word. The two copies
 * are not mirror images of each other: the first sits around the top-left
 * finder, the second is split between the top-right and bottom-left finders.
 */
function placeFormatBits(modules, reserved, size, mask) {
  const data = (EC_M_FORMAT_BITS << 3) | mask;
  let bch = data << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  const format = ((data << 10) | bch) ^ 0b101010000010010;

  const set = (row, col, bit) => {
    modules[row][col] = (format >>> bit) & 1;
    reserved[row][col] = 1;
  };

  // Copy 1 — around the top-left finder pattern.
  for (let i = 0; i < 6; i += 1) set(i, 8, i);
  set(7, 8, 6);
  set(8, 8, 7);
  set(8, 7, 8);
  for (let i = 9; i < 15; i += 1) set(8, 14 - i, i);

  // Copy 2 — bits 0-7 along the top right, bits 8-14 down the left of it.
  for (let i = 0; i < 8; i += 1) set(8, size - 1 - i, i);
  for (let i = 8; i < 15; i += 1) set(size - 15 + i, 8, i);
}

/** The eight data mask conditions from the spec. */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Zig-zag placement: two-module-wide columns, right to left, upward then
 * downward, skipping the column 6 timing pattern.
 *
 * Returns the list of positions written, because the data mask must be applied
 * to exactly those modules and nothing else — the function patterns, timing
 * patterns and format information are never masked.
 */
function placeData(modules, reserved, codewords, size) {
  const buffer = new BitBuffer();
  for (const byte of codewords) buffer.push(byte, 8);

  const positions = [];
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5; // the vertical timing pattern column is skipped
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c += 1) {
        const target = col - c;
        if (reserved[row][target]) continue;
        // Remainder bits beyond the data stream are defined to be 0.
        const bit = bitIndex < buffer.length ? buffer.bits[bitIndex] : 0;
        bitIndex += 1;
        modules[row][target] = bit;
        positions.push([row, target]);
      }
    }
    upward = !upward;
  }
  return positions;
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function penalty(modules) {
  const size = modules.size;
  let score = 0;

  const runScore = (line) => {
    let total = 0;
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) total += PENALTY_N1 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) total += PENALTY_N1 + (run - 5);
    return total;
  };

  for (let r = 0; r < size; r += 1) score += runScore(modules[r]);
  for (let c = 0; c < size; c += 1) {
    score += runScore(modules.map((row) => row[c]));
  }

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += PENALTY_N2;
      }
    }
  }

  const PATTERN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const REVERSE = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, start, pattern) =>
    pattern.every((bit, i) => line[start + i] === bit);
  const scan = (line) => {
    let total = 0;
    for (let i = 0; i + 11 <= line.length; i += 1) {
      if (matches(line, i, PATTERN) || matches(line, i, REVERSE)) total += PENALTY_N3;
    }
    return total;
  };
  for (let r = 0; r < size; r += 1) score += scan(modules[r]);
  for (let c = 0; c < size; c += 1) score += scan(modules.map((row) => row[c]));

  let dark = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (modules[r][c] === 1) dark += 1;
  }
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * PENALTY_N4;

  return score;
}

function buildMatrix(text, version) {
  const size = version * 4 + 17;
  const matrix = new Matrix(size);

  placeFinder(matrix.modules, matrix.reserved, 0, 0, size);
  placeFinder(matrix.modules, matrix.reserved, 0, size - 7, size);
  placeFinder(matrix.modules, matrix.reserved, size - 7, 0, size);
  placeAlignment(matrix.modules, matrix.reserved, ALIGNMENT[version]);
  placeTiming(matrix.modules, matrix.reserved, size);
  placeDarkModule(matrix.modules, matrix.reserved, version);
  reserveFormatAreas(matrix.modules, matrix.reserved, size);
  placeVersionBits(matrix.modules, matrix.reserved, version, size);

  const codewords = interleave(encodeData(text, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = new Matrix(size);
    candidate.modules = matrix.modules.map((row) => Int8Array.from(row));
    candidate.reserved = matrix.reserved.map((row) => Uint8Array.from(row));
    const positions = placeData(candidate.modules, candidate.reserved, codewords, size);
    for (const [row, col] of positions) {
      if (MASKS[mask](row, col)) candidate.modules[row][col] ^= 1;
    }
    placeFormatBits(candidate.modules, candidate.reserved, size, mask);
    const score = penalty(candidate.modules);
    if (!best || score < best.score) {
      best = { score, modules: candidate.modules, size, mask, version };
    }
  }

  return best;
}

/* --------------------------------- public -------------------------------- */

const versionFor = (byteLength) => {
  for (let v = 1; v <= MAX_VERSION; v += 1) if (byteLength <= capacity(v)) return v;
  return null;
};

/** True when a payload fits the supported version range. */
/**
 * Whether `text` is encodable.
 *
 * An empty payload is refused even though it would technically fit: a QR that
 * decodes to nothing is never what a caller meant, and rendering one by accident
 * would put a scannable-but-useless code in front of a customer.
 */
export const canEncode = (text) =>
  typeof text === "string" &&
  text.length > 0 &&
  versionFor(Buffer.byteLength(text, "utf8")) !== null;

export const QR_MAX_BYTES = capacity(MAX_VERSION);

/** The module matrix for `text`. Throws if the payload is too long. */
export function qrMatrix(text) {
  const version = versionFor(Buffer.byteLength(text, "utf8"));
  if (version === null) {
    throw new Error(
      `QR payload is ${Buffer.byteLength(text, "utf8")} bytes; this encoder supports up to ${QR_MAX_BYTES}.`,
    );
  }
  return buildMatrix(text, version);
}

/**
 * Render as SVG. Drawn as a single path of unit squares, which keeps the markup
 * small, scales to any size and prints cleanly. The caller controls the width.
 */
export function qrSvg(text, { margin = 2, title = "UPI payment QR" } = {}) {
  const { modules, size } = qrMatrix(text);
  const dimension = size + margin * 2;

  let path = "";
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c] === 1) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" ` +
    `role="img" aria-label="${escapeXml(title)}" shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `</svg>`
  );
}

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export { capacity as qrByteCapacity, MAX_VERSION as QR_MAX_VERSION, versionFor as qrVersionFor };

