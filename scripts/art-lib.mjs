/**
 * Turning pictures into terminal art.
 *
 * The pipeline: greyscale → crop → resize to a grid of *dots* → tone curve
 * and sharpening → error-diffusion dithering → Braille cells (each one a 2×4
 * block of dots) → a grey per cell, snapped to the terminal's 24-step grey
 * ramp, so the picture keeps its shading as well as its line.
 *
 * Only the generator uses this (with sharp); the app ships the output.
 */
import sharp from 'sharp';

/* ----------------------------------------------------------------- input -- */

/**
 * Load an image as greyscale floats in [0, 1], `dotsW` × `dotsH` in size.
 * `crop` is a fractional rectangle { left, top, width, height } of the source.
 */
export async function loadGrey(path, { crop, dotsW, dotsH, sharpen = 1.2, channel = 'luma', mirror = false }) {
  // A painting's gold and red can share a luminance; its green channel
  // tells gilded armour from a red wall where plain greyscale cannot.
  let img = channel === 'luma' ? sharp(path).greyscale() : sharp(path).extractChannel(channel);
  const meta = await img.metadata();
  if (crop) {
    img = img.extract({
      left: Math.round(crop.left * meta.width),
      top: Math.round(crop.top * meta.height),
      width: Math.round(crop.width * meta.width),
      height: Math.round(crop.height * meta.height),
    });
  }
  if (mirror) img = img.flop();
  // Resize in two steps: a clean area-average down to the dot grid, then
  // sharpen at that size, where the arches actually have to survive.
  const buf = await img
    .resize(dotsW, dotsH, { fit: 'fill', kernel: 'lanczos3' })
    .sharpen({ sigma: 0.6, m1: sharpen, m2: sharpen * 2 })
    .toColourspace('b-w')
    .extractChannel(0)
    .raw()
    .toBuffer();
  const out = new Float32Array(dotsW * dotsH);
  for (let i = 0; i < out.length; i++) out[i] = buf[i] / 255;
  return out;
}

/** Stretch levels between two percentiles, then apply a gamma. */
export function tone(grey, { low = 0.02, high = 0.98, gamma = 1, invert = false } = {}) {
  const sorted = Float32Array.from(grey).sort();
  const lo = sorted[Math.floor(low * (sorted.length - 1))];
  const hi = sorted[Math.floor(high * (sorted.length - 1))];
  const span = Math.max(1e-6, hi - lo);
  const out = new Float32Array(grey.length);
  for (let i = 0; i < grey.length; i++) {
    let v = Math.min(1, Math.max(0, (grey[i] - lo) / span));
    if (invert) v = 1 - v;
    out[i] = Math.pow(v, gamma);
  }
  return out;
}

/** Fade the edges to black so a picture sits in the dark instead of on it. */
export function vignette(grey, w, h, { strength = 0.6, softness = 0.35 } = {}) {
  const out = new Float32Array(grey.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x / (w - 1)) * 2 - 1;
      const dy = (y / (h - 1)) * 2 - 1;
      const d = Math.sqrt(dx * dx * 0.8 + dy * dy * 1.2);
      const f = 1 - strength * Math.min(1, Math.max(0, (d - (1 - softness)) / softness));
      out[y * w + x] = grey[y * w + x] * f;
    }
  }
  return out;
}

/** A separable box blur, `radius` dots each way. */
export function boxBlur(grey, w, h, radius = 1) {
  const tmp = new Float32Array(grey.length);
  const out = new Float32Array(grey.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) { s += grey[y * w + xx]; n++; }
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/**
 * Find the sky: flood-fill from the top edge through bright pixels of a
 * blurred copy, so stonework texture cannot leak the fill into a building.
 */
export function skyMask(grey, w, h, { threshold = 0.6, radius = 1 } = {}) {
  const bl = boxBlur(grey, w, h, radius);
  const mask = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) {
    if (bl[x] > threshold) {
      mask[x] = 1;
      stack.push(x);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] && bl[j] > threshold) {
        mask[j] = 1;
        stack.push(j);
      }
    }
  }
  return mask;
}

/* ------------------------------------------------------------- dithering -- */

const KERNELS = {
  // Atkinson spreads only 6/8 of the error, so highlights and shadows stay
  // clean — the look of old Mac engravings, and right for Piranesi.
  atkinson: {
    div: 8,
    taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]],
  },
  floyd: {
    div: 16,
    taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  },
  stucki: {
    div: 42,
    taps: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
    ],
  },
};

/** Error-diffusion dither to one bit per dot, scanning in a serpentine. */
export function dither(grey, w, h, { method = 'atkinson', threshold = 0.5 } = {}) {
  const k = KERNELS[method];
  const buf = Float32Array.from(grey);
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ltr = y % 2 === 0;
    for (let i = 0; i < w; i++) {
      const x = ltr ? i : w - 1 - i;
      const idx = y * w + x;
      const old = buf[idx];
      const on = old >= threshold ? 1 : 0;
      bits[idx] = on;
      const err = old - on;
      for (const [dx, dy, wt] of k.taps) {
        const nx = x + (ltr ? dx : -dx);
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        buf[ny * w + nx] += (err * wt) / k.div;
      }
    }
  }
  return bits;
}

/* --------------------------------------------------------------- braille -- */

// Dot numbering in a Braille cell, as bit offsets from U+2800.
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/** xterm's 24-step grey ramp: 232 is darkest, 255 lightest. */
export const GREY_RAMP = Array.from({ length: 24 }, (_, i) => 8 + i * 10);

/**
 * Build Braille cells. Each cell gets a grey from the picture's local tone,
 * so a lit arch is drawn in bright dots and a shadowed one in dim dots: the
 * dithering carries the texture and the grey carries the light.
 */
export function braille(bits, grey, w, h, { floor = 0.25, lift = 1, blur = 1 } = {}) {
  const cols = Math.floor(w / 2);
  const rows = Math.floor(h / 4);
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      let code = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (bits[(r * 4 + dy) * w + c * 2 + dx]) code |= DOTS[dy][dx];
        }
      }
      // Tone from a slightly wider window than the cell, so neighbouring
      // cells do not flicker between greys.
      let sum = 0;
      let n = 0;
      for (let y = r * 4 - blur; y < r * 4 + 4 + blur; y++) {
        for (let x = c * 2 - blur; x < c * 2 + 2 + blur; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          sum += grey[y * w + x];
          n++;
        }
      }
      const t = Math.min(1, floor + (1 - floor) * Math.pow(sum / n, 1 / lift));
      const idx = Math.round(t * 23);
      row.push({ ch: String.fromCharCode(0x2800 + code), grey: idx });
    }
    cells.push(row);
  }
  return cells;
}

/* ---------------------------------------------------------------- output -- */

/** One ANSI string per row, a colour code only where the grey changes. */
export function ansiRows(cells) {
  return cells.map((row) => {
    let out = '';
    let last = -1;
    for (const cell of row) {
      // A blank cell needs no colour; keep whatever is current.
      if (cell.ch !== '⠀' && cell.ch !== ' ' && cell.grey !== last) {
        out += `\x1b[38;5;${232 + cell.grey}m`;
        last = cell.grey;
      }
      out += cell.ch === '⠀' ? ' ' : cell.ch;
    }
    return out + '\x1b[39m';
  });
}

/**
 * Draw cells the way a terminal would — dark ground, round dots — so the art
 * can be judged without a terminal. Cell size approximates a common
 * monospace font at 2:1.
 */
export async function preview(cells, path, { cw = 8, ch = 16, bg = 10 } = {}) {
  const rows = cells.length;
  const cols = cells[0].length;
  const W = cols * cw;
  const H = rows * ch;
  const px = Buffer.alloc(W * H * 3, bg);
  const r = cw * 0.2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = cells[y][x];
      const code = cell.ch.charCodeAt(0) - 0x2800;
      if (code <= 0 || code > 0xff) continue;
      const v = GREY_RAMP[cell.grey];
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (!(code & DOTS[dy][dx])) continue;
          const cx = x * cw + (dx === 0 ? 0.3 : 0.7) * cw;
          const cy = y * ch + (dy + 0.5) * (ch / 4);
          for (let py = Math.floor(cy - r - 1); py <= cy + r + 1; py++) {
            for (let pxx = Math.floor(cx - r - 1); pxx <= cx + r + 1; pxx++) {
              const d = Math.hypot(pxx + 0.5 - cx, py + 0.5 - cy);
              const a = Math.min(1, Math.max(0, r + 0.5 - d));
              if (a <= 0 || pxx < 0 || py < 0 || pxx >= W || py >= H) continue;
              const o = (py * W + pxx) * 3;
              const val = Math.round(px[o] * (1 - a) + v * a);
              px[o] = px[o + 1] = px[o + 2] = val;
            }
          }
        }
      }
    }
  }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path);
}
