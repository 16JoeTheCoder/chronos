// Generates the web app icons in public-web/ from build/icon.png (the desktop icon), with
// built-ins only: decodes the 512 px PNG (our own encoder writes filter 0), box-downsamples,
// and re-encodes. Maskable icons are full-bleed ink with the artwork at 70 % (safe zone).
// Run: node scripts/make-web-icons.mjs   (output is committed; rerun only if the icon changes)
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INK = [13, 14, 16];

function decode(buf) {
  let off = 8, w = 0, h = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected 8-bit RGBA non-interlaced'); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    if (raw[y * (w * 4 + 1)] !== 0) throw new Error('unsupported PNG filter (re-encode with scripts/make-icon.mjs)');
    raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  }
  return { w, h, px };
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
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
function encode(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Box-filter the source into a size x size square placed at (ox, oy) of dst (premultiplied by alpha). */
function blit(src, dst, dstSize, size, ox, oy) {
  const k = src.w / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * k); sy < Math.ceil((y + 1) * k); sy++) {
        for (let sx = Math.floor(x * k); sx < Math.ceil((x + 1) * k); sx++) {
          const i = (sy * src.w + sx) * 4, al = src.px[i + 3];
          r += src.px[i] * al; g += src.px[i + 1] * al; b += src.px[i + 2] * al; a += al; n++;
        }
      }
      const al = a / n / 255, o = ((oy + y) * dstSize + ox + x) * 4;
      // composite over what is already in dst (opaque ink for maskable, transparent otherwise)
      const bgA = dst[o + 3] / 255;
      const outA = al + bgA * (1 - al);
      for (let c = 0; c < 3; c++) {
        const fg = a ? [r, g, b][c] / a : 0;
        dst[o + c] = outA ? (fg * al + dst[o + c] * bgA * (1 - al)) / outA : 0;
      }
      dst[o + 3] = Math.round(outA * 255);
    }
  }
}

const src = decode(readFileSync(join(root, 'build', 'icon.png')));
const out = join(root, 'public-web');
mkdirSync(out, { recursive: true });

function icon(file, size, { maskable = false } = {}) {
  const dst = Buffer.alloc(size * size * 4);
  let inner = size, off = 0;
  if (maskable) {
    for (let i = 0; i < size * size; i++) { dst[i * 4] = INK[0]; dst[i * 4 + 1] = INK[1]; dst[i * 4 + 2] = INK[2]; dst[i * 4 + 3] = 255; }
    inner = Math.round(size * 0.7);
    off = Math.round((size - inner) / 2);
  }
  blit(src, dst, size, inner, off, off);
  writeFileSync(join(out, file), encode(size, dst));
  console.log('->', file);
}

icon('icon-192.png', 192);
icon('icon-512.png', 512);
icon('icon-maskable-512.png', 512, { maskable: true });
icon('apple-touch-icon.png', 180, { maskable: true });
icon('favicon-32.png', 32);
