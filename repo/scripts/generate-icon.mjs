#!/usr/bin/env node
/**
 * Генерация иконки приложения (1024x1024 PNG) без внешних зависимостей.
 *
 * Рисуется фирменный знак Infinity (два сомкнутых кольца) на градиентном
 * фоне — тот же мотив, что и в scripts/build-installer.ps1 (System.Drawing).
 *
 *   node scripts/generate-icon.mjs [output.png]
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const SIZE = 1024;
const out = process.argv[2] || "app-icon.png";

// ---------------------------------------------------------------- helpers
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Signed distance to an ellipse ring (approximation via scaling trick).
function ringDist(px, py, cx, cy, rx, ry, thickness) {
  // Map point onto unit circle space, measure radial distance.
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  const r = Math.sqrt(dx * dx + dy * dy);
  const avgRad = (rx + ry) / 2;
  const d = Math.abs(r - 1) * avgRad;
  return Math.max(0, d - thickness / 2);
}

// Smooth alpha for anti-aliasing over ~1.5 px.
function coverage(dist) {
  if (dist >= 0.75) return 0;
  if (dist <= -0.75) return 1;
  return 0.5 - dist / 1.5;
}

// ---------------------------------------------------------------- render
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4)); // scanlines with filter byte

const bgA = [108, 133, 255]; // #6c85ff
const bgB = [178, 122, 255]; // #b27aff
const dark = [10, 12, 18];

// Two touching rings forming the infinity glyph (geometry mirrors hooks in
// build-installer.ps1: ellipses at (190,380,340,264) and (494,380,340,264)).
const rings = [
  { cx: 190 + 170, cy: 380 + 132, rx: 170, ry: 132 },
  { cx: 494 + 170, cy: 380 + 132, rx: 170, ry: 132 },
];
const STROKE = 74;

let o = 0;
for (let y = 0; y < SIZE; y++) {
  raw[o++] = 0; // filter: None
  for (let x = 0; x < SIZE; x++) {
    // Background: rounded square filled with diagonal gradient.
    const corner = 180;
    let inside = true;
    const qx = x < corner ? corner - x : x > SIZE - corner ? x - (SIZE - corner) : 0;
    const qy = y < corner ? corner - y : y > SIZE - corner ? y - (SIZE - corner) : 0;
    if (qx > 0 && qy > 0) inside = qx * qx + qy * qy <= corner * corner;

    let r, g, b, a;
    if (!inside) {
      r = g = b = a = 0;
    } else {
      const t = (x + y) / (2 * SIZE);
      r = lerp(bgA[0], bgB[0], t);
      g = lerp(bgA[1], bgB[1], t);
      b = lerp(bgA[2], bgB[2], t);
      a = 255;

      // Glyph: white rings, drawn as two overlapping ellipses outlines.
      let d = Infinity;
      for (const ring of rings) d = Math.min(d, ringDist(x, y, ring.cx, ring.cy, ring.rx, ring.ry, STROKE));
      const cov = coverage(d - 0.75);
      if (cov > 0) {
        r = lerp(r, 255, cov);
        g = lerp(g, 255, cov);
        b = lerp(b, 255, cov);
      }
    }
    raw[o++] = clamp(r);
    raw[o++] = clamp(g);
    raw[o++] = clamp(b);
    raw[o++] = a;
  }
}

// ---------------------------------------------------------------- PNG wrap
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  c = 0xffffffff;
  for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(out, png);
console.log(`Icon written: ${out} (${(png.length / 1024).toFixed(1)} KB)`);
