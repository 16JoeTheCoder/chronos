// Generates build/icon.png (512x512): a ring with 12 tick marks and one orange
// "now" notch on a near-black rounded square. Dependency-free: rasterises with
// 4x4 supersampling and writes the PNG with zlib. `node scripts/make-icon.mjs --tray`
// prints the 32 px version as a base64 data URL (embedded in src/main/main.ts).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BG = [13, 14, 16]; // ink #0D0E10
const RING = [243, 242, 238]; // paper #F3F2EE
const NOW = [255, 91, 31]; // accent #FF5B1F

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour at normalised (x, y) in [0,1], or null for transparent. */
function shade(x, y, small) {
  if (!insideRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)) return null;
  const dx = x - 0.5, dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI); // 0 at 12 o'clock, clockwise
  // Now notch: a short constant-width orange bar crossing the ring at 2 o'clock.
  const nowA = Math.PI / 3;
  if (Math.abs(a - nowA) < Math.PI / 2 && r * Math.sin(Math.abs(a - nowA)) < (small ? 0.045 : 0.022) && r > 0.22 && r < 0.42) return NOW;
  const ring = small ? [0.27, 0.34] : [0.29, 0.325];
  if (r >= ring[0] && r <= ring[1]) return RING;
  if (!small) {
    const step = Math.PI / 6;
    const off = Math.abs(((a + step / 2) % step) - step / 2);
    if (off * r < 0.008 && r > 0.355 && r < 0.4) return RING;
  }
  return BG;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, size <= 64);
          if (c) { a++; r += c[0]; g += c[1]; b += c[2]; }
        }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(size) {
  const px = render(size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv.includes('--tray')) {
  console.log(`data:image/png;base64,${png(32).toString('base64')}`);
} else {
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png(512));
  console.log(`-> wrote ${out}`);
}
