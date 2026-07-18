/**
 * Client-side document scanning primitives: corner detection, projective
 * (perspective) correction, enhancement and quality analysis.
 *
 * Everything here runs in the browser on a <canvas>. Identity documents are
 * never uploaded for processing — the pixels stay on the device unless the user
 * explicitly saves.
 *
 * Deliberately conservative: enhancement adjusts illumination and contrast only.
 * Nothing here invents, reconstructs or beautifies detail that is not already in
 * the source image.
 */

export type Point = { x: number; y: number };
/** Corners in source-image pixel coordinates, ordered TL, TR, BR, BL. */
export type Corners = [Point, Point, Point, Point];

export type ScanMode =
  | "original"
  | "color"
  | "enhanced"
  | "grayscale"
  | "bw"
  | "photo";

export const SCAN_MODES: Array<{ value: ScanMode; label: string }> = [
  { value: "original", label: "الأصلي" },
  { value: "color", label: "مسح ملوّن" },
  { value: "enhanced", label: "ملوّن محسّن" },
  { value: "grayscale", label: "تدرّج رمادي" },
  { value: "bw", label: "أبيض وأسود" },
  { value: "photo", label: "جودة صورة" },
];

export type Adjustments = {
  brightness: number; // -100..100
  contrast: number; // -100..100
  sharpness: number; // 0..100
  saturation: number; // -100..100
  shadows: number; // 0..100 (illumination flattening strength)
  denoise: number; // 0..100
  rotation: number; // fine rotation in degrees, -15..15
};

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  sharpness: 0,
  saturation: 0,
  shadows: 0,
  denoise: 0,
  rotation: 0,
};

/** Per-mode starting point. The user can still override every slider. */
export function presetFor(mode: ScanMode): Adjustments {
  switch (mode) {
    case "color":
      return { ...DEFAULT_ADJUSTMENTS, contrast: 8, sharpness: 18, shadows: 25 };
    case "enhanced":
      return { ...DEFAULT_ADJUSTMENTS, brightness: 4, contrast: 16, sharpness: 28, saturation: 10, shadows: 45 };
    case "grayscale":
      return { ...DEFAULT_ADJUSTMENTS, contrast: 12, sharpness: 20, shadows: 40 };
    case "bw":
      return { ...DEFAULT_ADJUSTMENTS, contrast: 20, sharpness: 10, shadows: 60 };
    case "photo":
      return { ...DEFAULT_ADJUSTMENTS, sharpness: 6 };
    default:
      return { ...DEFAULT_ADJUSTMENTS };
  }
}

// ─── Canvas helpers ─────────────────────────────────────────────────────────

export function canvasFrom(image: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = "naturalWidth" in image ? image.naturalWidth : image.width;
  c.height = "naturalHeight" in image ? image.naturalHeight : image.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز مساحة الرسم");
  ctx.drawImage(image, 0, 0);
  return c;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    img.src = src;
  });
}

/** Downscales for analysis so detection stays fast on large phone photos. */
function downscale(source: HTMLCanvasElement, maxWidth: number) {
  const scale = Math.min(1, maxWidth / source.width);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز مساحة الرسم");
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas: c, scale };
}

function toGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

/** Separable 3x3 box blur, repeated to approximate a Gaussian. */
function blur(src: Float32Array, w: number, h: number, passes = 1): Float32Array {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(w - 1, x + 1);
        tmp[y * w + x] = (cur[y * w + x0] + cur[y * w + x] + cur[y * w + x1]) / 3;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        out[y * w + x] = (tmp[y0 * w + x] + tmp[y * w + x] + tmp[y1 * w + x]) / 3;
      }
    }
    cur = out;
  }
  return cur;
}

// ─── Corner detection ───────────────────────────────────────────────────────

export type DetectionResult = {
  corners: Corners;
  /** 0..1 — how strongly the detected quad looks like a real document. */
  confidence: number;
};

/**
 * Heuristic document-corner detection.
 *
 * Sobel gradient magnitude → threshold to an edge cloud → pick the four extreme
 * points by the rotating-calipers trick (max of x+y, x−y, −x+y, −x−y). This
 * finds a convincing quad when the document contrasts with its background.
 *
 * It is an ASSIST, not OpenCV-grade contour analysis: when confidence is low the
 * caller should fall back to manual corner placement rather than trusting it.
 */
export function detectDocumentCorners(source: HTMLCanvasElement): DetectionResult | null {
  const { canvas, scale } = downscale(source, 480);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const gray = blur(toGray(img.data, w, h), w, h, 2);

  // Sobel magnitude.
  const mag = new Float32Array(w * h);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag < 1e-3) return null;

  // Keep only strong edges. The threshold is relative so it adapts to contrast.
  const threshold = maxMag * 0.28;
  let tl = { x: 0, y: 0, s: Infinity };
  let br = { x: 0, y: 0, s: -Infinity };
  let tr = { x: 0, y: 0, s: -Infinity };
  let bl = { x: 0, y: 0, s: Infinity };
  let count = 0;

  // Ignore a thin frame so the photo's own border is not mistaken for the document.
  const pad = Math.round(Math.min(w, h) * 0.02);
  for (let y = pad; y < h - pad; y++) {
    for (let x = pad; x < w - pad; x++) {
      if (mag[y * w + x] < threshold) continue;
      count++;
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.s) tl = { x, y, s: sum };
      if (sum > br.s) br = { x, y, s: sum };
      if (diff > tr.s) tr = { x, y, s: diff };
      if (diff < bl.s) bl = { x, y, s: diff };
    }
  }
  if (count < 200) return null;

  const inv = 1 / scale;
  const corners: Corners = [
    { x: tl.x * inv, y: tl.y * inv },
    { x: tr.x * inv, y: tr.y * inv },
    { x: br.x * inv, y: br.y * inv },
    { x: bl.x * inv, y: bl.y * inv },
  ];

  // Confidence: how much of the frame the quad covers, and how non-degenerate
  // it is. A sliver or a near-full-frame quad both mean "not found".
  const area = polygonArea(corners);
  const frameArea = source.width * source.height;
  const coverage = area / frameArea;
  const sides = [
    dist(corners[0], corners[1]),
    dist(corners[1], corners[2]),
    dist(corners[2], corners[3]),
    dist(corners[3], corners[0]),
  ];
  const minSide = Math.min(...sides);
  const maxSide = Math.max(...sides);
  const shapeOk = minSide > 0 && maxSide / minSide < 8;
  if (!shapeOk || coverage < 0.12) return null;

  const confidence = Math.max(0, Math.min(1, coverage > 0.95 ? 0.35 : coverage));
  return { corners, confidence };
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(pts: Corners): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** A sensible default quad (10% inset) for manual placement. */
export function defaultCorners(width: number, height: number): Corners {
  const ix = width * 0.1;
  const iy = height * 0.1;
  return [
    { x: ix, y: iy },
    { x: width - ix, y: iy },
    { x: width - ix, y: height - iy },
    { x: ix, y: height - iy },
  ];
}

/** Orders an arbitrary set of four points as TL, TR, BR, BL. */
export function orderCorners(pts: Point[]): Corners {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // atan2 ordering starts at the left; rotate so the top-left comes first.
  let startIndex = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const s = p.x + p.y;
    if (s < best) {
      best = s;
      startIndex = i;
    }
  });
  const ordered = [...sorted.slice(startIndex), ...sorted.slice(0, startIndex)];
  return [ordered[0], ordered[1], ordered[2], ordered[3]] as Corners;
}

// ─── Perspective correction ─────────────────────────────────────────────────

/**
 * Solves the projective transform mapping the destination rectangle
 * (0,0)-(w,0)-(w,h)-(0,h) onto the four source corners, then samples the source
 * for every destination pixel (bilinear). Because we map dest→src directly no
 * matrix inversion is needed.
 *
 * Returns the 8 homography coefficients [a..h] where
 *   sx = (a*x + b*y + c) / (g*x + h*y + 1)
 *   sy = (d*x + e*y + f) / (g*x + h*y + 1)
 */
function solveHomography(dstW: number, dstH: number, src: Corners): number[] | null {
  const d: Point[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];
  // 8x8 linear system.
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = d[i];
    const { x: u, y: v } = src[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    B.push(v);
  }
  return gaussianSolve(A, B);
}

/** Gaussian elimination with partial pivoting. */
function gaussianSolve(A: number[][], B: number[]): number[] | null {
  const n = B.length;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Warps the quad defined by `corners` into a flat `outW × outH` canvas.
 * Bilinear sampling keeps text edges smooth without inventing detail.
 */
export function warpPerspective(
  source: HTMLCanvasElement,
  corners: Corners,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const H = solveHomography(outW, outH, corners);
  if (!H) throw new Error("تعذر تصحيح المنظور — تحقّق من مواضع الزوايا");
  const [a, b, c, dd, e, f, g, h] = H;

  const sctx = source.getContext("2d");
  if (!sctx) throw new Error("تعذر تجهيز مساحة الرسم");
  const sImg = sctx.getImageData(0, 0, source.width, source.height);
  const sData = sImg.data;
  const sw = source.width;
  const sh = source.height;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("تعذر تجهيز مساحة الرسم");
  const oImg = octx.createImageData(outW, outH);
  const oData = oImg.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = g * x + h * y + 1;
      const sx = (a * x + b * y + c) / denom;
      const sy = (dd * x + e * y + f) / denom;
      const o = (y * outW + x) * 4;

      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        oData[o] = 255;
        oData[o + 1] = 255;
        oData[o + 2] = 255;
        oData[o + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = sData[i00 + k] * (1 - fx) + sData[i10 + k] * fx;
        const bottom = sData[i01 + k] * (1 - fx) + sData[i11 + k] * fx;
        oData[o + k] = top * (1 - fy) + bottom * fy;
      }
      oData[o + 3] = 255;
    }
  }
  octx.putImageData(oImg, 0, 0);
  return out;
}

/** Rotates a canvas by a multiple of 90°, or any fine angle (white padding). */
export function rotateCanvas(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = Math.round(source.width * cos + source.height * sin);
  const h = Math.round(source.width * sin + source.height * cos);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز مساحة الرسم");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

// ─── Enhancement ────────────────────────────────────────────────────────────

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Applies the selected mode + manual adjustments.
 *
 * Order matters: illumination flattening and white balance first (they fix the
 * capture), then tone, then a mild unsharp mask last so we never sharpen noise
 * that later steps would amplify.
 */
export function enhance(
  source: HTMLCanvasElement,
  mode: ScanMode,
  adj: Adjustments,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext("2d");
  const sctx = source.getContext("2d");
  if (!ctx || !sctx) throw new Error("تعذر تجهيز مساحة الرسم");
  const img = sctx.getImageData(0, 0, source.width, source.height);
  const data = img.data;
  const w = source.width;
  const h = source.height;

  if (mode === "original") {
    ctx.putImageData(img, 0, 0);
    return out;
  }

  // 1) Shadow / uneven-illumination reduction: divide by a heavily blurred
  //    luminance so a lamp gradient flattens without touching local detail.
  if (adj.shadows > 0) {
    const strength = adj.shadows / 100;
    const lum = toGray(data, w, h);
    const illum = blur(lum, w, h, 6);
    let mean = 0;
    for (let i = 0; i < illum.length; i++) mean += illum[i];
    mean /= illum.length || 1;
    for (let p = 0, i = 0; p < illum.length; p++, i += 4) {
      const base = illum[p] < 1 ? 1 : illum[p];
      const gain = 1 + strength * (mean / base - 1);
      data[i] = clamp255(data[i] * gain);
      data[i + 1] = clamp255(data[i + 1] * gain);
      data[i + 2] = clamp255(data[i + 2] * gain);
    }
  }

  // 2) Gray-world white balance — removes the yellow cast of indoor lighting
  //    without shifting the document's own colours.
  if (mode !== "photo") {
    let rs = 0, gs = 0, bs = 0;
    const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      rs += data[i];
      gs += data[i + 1];
      bs += data[i + 2];
    }
    const rm = rs / n || 1;
    const gm = gs / n || 1;
    const bm = bs / n || 1;
    const grayMean = (rm + gm + bm) / 3;
    // Damped so a genuinely coloured document is not neutralised.
    const kr = 1 + 0.6 * (grayMean / rm - 1);
    const kg = 1 + 0.6 * (grayMean / gm - 1);
    const kb = 1 + 0.6 * (grayMean / bm - 1);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp255(data[i] * kr);
      data[i + 1] = clamp255(data[i + 1] * kg);
      data[i + 2] = clamp255(data[i + 2] * kb);
    }
  }

  // 3) Light denoise (3x3 average blended by strength) before sharpening.
  if (adj.denoise > 0) {
    const amount = (adj.denoise / 100) * 0.7;
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += copy[((y + dy) * w + (x + dx)) * 4 + k];
            }
          }
          data[i + k] = clamp255(copy[i + k] * (1 - amount) + (sum / 9) * amount);
        }
      }
    }
  }

  // 4) Tone: brightness, contrast, saturation.
  const bAdd = (adj.brightness / 100) * 80;
  const cF = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
  const sat = 1 + adj.saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = clamp255(cF * (data[i] + bAdd - 128) + 128);
    let g = clamp255(cF * (data[i + 1] + bAdd - 128) + 128);
    let b = clamp255(cF * (data[i + 2] + bAdd - 128) + 128);
    if (sat !== 1) {
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = clamp255(luma + (r - luma) * sat);
      g = clamp255(luma + (g - luma) * sat);
      b = clamp255(luma + (b - luma) * sat);
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  // 5) Mild unsharp mask. Capped at 0.9 and blended against a blurred copy so
  //    text gains definition without the halo that ruins scanned IDs.
  if (adj.sharpness > 0) {
    const amount = Math.min(0.9, (adj.sharpness / 100) * 0.9);
    const copy = new Uint8ClampedArray(data);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += copy[((y + dy) * w + (x + dx)) * 4 + k];
            }
          }
          const blurred = sum / 9;
          data[i + k] = clamp255(copy[i + k] + amount * (copy[i + k] - blurred));
        }
      }
    }
  }

  // 6) Mode-specific final pass.
  if (mode === "grayscale") {
    for (let i = 0; i < data.length; i += 4) {
      const luma = clamp255(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = luma;
    }
  } else if (mode === "bw") {
    // Adaptive threshold against a local mean — keeps thin Arabic strokes that a
    // global threshold would erase.
    const lum = toGray(data, w, h);
    const local = blur(lum, w, h, 5);
    for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
      const v = lum[p] < local[p] - 8 ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

// ─── Quality analysis ───────────────────────────────────────────────────────

export type QualityIssue = {
  key: string;
  message: string;
  severity: "warn" | "error";
};

export type QualityReport = {
  issues: QualityIssue[];
  /** Sharpness score (variance of Laplacian). Higher is crisper. */
  sharpnessScore: number;
  meanBrightness: number;
  clippedHighlights: number;
  width: number;
  height: number;
};

/**
 * Inspects a captured image and reports concrete, actionable problems.
 * Nothing here modifies the image — it only tells the user what to fix.
 */
export function analyzeQuality(source: HTMLCanvasElement, minLongEdge = 1000): QualityReport {
  const { canvas } = downscale(source, 640);
  const ctx = canvas.getContext("2d");
  const issues: QualityIssue[] = [];
  if (!ctx) {
    return {
      issues, sharpnessScore: 0, meanBrightness: 0, clippedHighlights: 0,
      width: source.width, height: source.height,
    };
  }
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const gray = toGray(img.data, w, h);

  // Variance of the Laplacian → blur / camera-shake detector.
  let mean = 0;
  const lap = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lap[i] = v;
      mean += v;
    }
  }
  const n = (w - 2) * (h - 2) || 1;
  mean /= n;
  let variance = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const d = lap[y * w + x] - mean;
      variance += d * d;
    }
  }
  const sharpnessScore = variance / n;

  let lumSum = 0;
  let clipped = 0;
  for (let p = 0; p < gray.length; p++) {
    lumSum += gray[p];
    if (gray[p] > 250) clipped++;
  }
  const meanBrightness = lumSum / (gray.length || 1);
  const clippedHighlights = clipped / (gray.length || 1);

  if (sharpnessScore < 60)
    issues.push({ key: "blur", message: "الصورة غير واضحة أو مهزوزة — يُفضّل إعادة التصوير", severity: "error" });
  else if (sharpnessScore < 140)
    issues.push({ key: "soft", message: "حدة الصورة منخفضة قليلاً", severity: "warn" });

  if (meanBrightness < 70)
    issues.push({ key: "dark", message: "الإضاءة ضعيفة — صوّر في مكان أفضل إضاءة", severity: "warn" });
  if (meanBrightness > 225)
    issues.push({ key: "bright", message: "الصورة ساطعة جداً وقد تفقد التفاصيل", severity: "warn" });
  if (clippedHighlights > 0.06)
    issues.push({ key: "glare", message: "يوجد انعكاس ضوئي على المستمسك — غيّر زاوية التصوير", severity: "warn" });

  const longEdge = Math.max(source.width, source.height);
  if (longEdge < minLongEdge)
    issues.push({ key: "resolution", message: "دقة الصورة منخفضة، يُفضّل إعادة التصوير", severity: "error" });

  return {
    issues,
    sharpnessScore,
    meanBrightness,
    clippedHighlights,
    width: source.width,
    height: source.height,
  };
}

/**
 * Output pixel size for a physical target at a given DPI.
 * 300 DPI over 85.6 mm ≈ 1011 px — the print baseline for an ID-1 card.
 */
export function pixelsForMm(mm: number, dpi = 300): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Effective DPI a source image would deliver when printed at `mm` wide. */
export function effectiveDpi(pixels: number, mm: number): number {
  if (mm <= 0) return 0;
  return Math.round(pixels / (mm / 25.4));
}

export function canvasToDataUrl(canvas: HTMLCanvasElement, quality = 0.95): string {
  return canvas.toDataURL("image/jpeg", quality);
}
