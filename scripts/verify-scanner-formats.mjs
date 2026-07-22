// Verifies the ZXing fallback path the LiveScanner uses: that every requested symbology
// resolves to a real BarcodeFormat, and that QR codes actually decode end to end.
//
// 1D symbologies are asserted by enum resolution only — @zxing/library ships readers for
// them but no writers, so this harness cannot generate a Code128/EAN image to decode.
// Run: node scripts/verify-scanner-formats.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MultiFormatReader, DecodeHintType, BarcodeFormat,
  BinaryBitmap, HybridBinarizer, RGBLuminanceSource,
} = require("@zxing/library");
const QRCode = require("qrcode");

// Must stay in sync with ZXING_FORMAT_NAMES in src/views/staff/live-scanner.tsx.
const NAMES = [
  "QR_CODE", "CODE_128", "CODE_39", "EAN_13", "EAN_8", "UPC_A",
  "UPC_E", "ITF", "CODABAR", "DATA_MATRIX", "PDF_417", "AZTEC",
];

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`✗ ${name}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`); }
  else console.log(`✓ ${name}`);
};

// ── Every requested symbology must map to a real enum member ──
const unresolved = NAMES.filter((name) => BarcodeFormat[name] === undefined);
check("all 12 symbologies resolve to a BarcodeFormat", unresolved, []);

const formats = NAMES.map((name) => BarcodeFormat[name]);
check("no duplicate format ids", new Set(formats).size, NAMES.length);

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
hints.set(DecodeHintType.TRY_HARDER, true);

/** Decodes a QR bitmap rendered at `scale` pixels per module, with a quiet zone. */
function decodeQr(text, { scale = 4, margin = 4, invert = false } = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const width = (size + margin * 2) * scale;
  // ZXing expects a plain grayscale buffer of exactly width*height — passing RGBA here
  // silently misaligns every row, which is what made an earlier version of this harness
  // report false failures.
  const luminance = new Uint8ClampedArray(width * width).fill(invert ? 0 : 255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + margin) * scale + dx;
          const py = (y + margin) * scale + dy;
          luminance[py * width + px] = invert ? 255 : 0;
        }
      }
    }
  }
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  const source = new RGBLuminanceSource(luminance, width, width);
  return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText();
}

const attempt = (text, options) => {
  try { return decodeQr(text, options); } catch (err) { return `ERROR: ${err?.message ?? err}`; }
};

// ── Real payloads this system actually encodes ──
check("asset code decodes", attempt("AJN-A000123"), "AJN-A000123");
check("gallery share link decodes",
  attempt("https://ajn.example.com/gallery/a1b2c3d4e5f6a1b2c3d4e5f6"),
  "https://ajn.example.com/gallery/a1b2c3d4e5f6a1b2c3d4e5f6");
check("arabic payload survives the round trip", attempt("كوشة-٨٨٢١٤"), "كوشة-٨٨٢١٤");
check("long payload decodes", attempt("A".repeat(300)), "A".repeat(300));

// ── Framing conditions the field actually produces ──
check("small QR (2px per module) decodes", attempt("AJN-A000123", { scale: 2 }), "AJN-A000123");
check("large QR (12px per module) decodes", attempt("AJN-A000123", { scale: 12 }), "AJN-A000123");
check("tight quiet zone (1 module) still decodes",
  attempt("AJN-A000123", { scale: 6, margin: 1 }), "AJN-A000123");

// A white-on-black label needs an inversion pass ZXing does not do by default. Asserted so
// the limitation is recorded here rather than discovered in the warehouse.
const inverted = attempt("AJN-A000123", { invert: true });
check("inverted (white-on-black) QR is NOT read — known limitation",
  inverted.startsWith("ERROR:"), true);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
