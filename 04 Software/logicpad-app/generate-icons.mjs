import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COLORS = {
  bg: [0x12, 0x14, 0x1a],
  border: [0x2a, 0x2e, 0x38],
  gold: [0xf0, 0xd0, 0x60],
  cream: [0xe8, 0xe4, 0xd8],
};

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function inRoundRect(x, y, rx, ry, rw, rh, radius) {
  if (x < rx || y < ry || x >= rx + rw || y >= ry + rh) return false;
  const r = Math.min(radius, rw / 2, rh / 2);
  const left = rx + r;
  const right = rx + rw - r - 1;
  const top = ry + r;
  const bottom = ry + rh - r - 1;
  if (x >= left && x <= right) return true;
  if (y >= top && y <= bottom) return true;
  const cx = x < left ? left : right;
  const cy = y < top ? top : bottom;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function setPixel(pixels, w, x, y, color) {
  if (x < 0 || y < 0 || x >= w || y >= pixels.length / (3 * w)) return;
  const o = (y * w + x) * 3;
  pixels[o] = color[0];
  pixels[o + 1] = color[1];
  pixels[o + 2] = color[2];
}

function fillRoundRect(pixels, w, x, y, rw, rh, radius, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w - 1, Math.ceil(x + rw - 1));
  const y1 = Math.min(pixels.length / (3 * w) - 1, Math.ceil(y + rh - 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      if (inRoundRect(px, py, x, y, rw, rh, radius)) {
        setPixel(pixels, w, px, py, color);
      }
    }
  }
}

function strokeRoundRect(pixels, w, x, y, rw, rh, radius, color) {
  fillRoundRect(pixels, w, x, y, rw, rh, radius, color);
  fillRoundRect(pixels, w, x + 1, y + 1, rw - 2, rh - 2, Math.max(0, radius - 1), COLORS.bg);
}

function drawLogo(size) {
  const pixels = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const o = i * 3;
    pixels[o] = COLORS.bg[0];
    pixels[o + 1] = COLORS.bg[1];
    pixels[o + 2] = COLORS.bg[2];
  }

  const bodyPad = Math.max(1, Math.round(size * 0.047));
  const bodySize = size - bodyPad * 2;
  const bodyRadius = Math.max(2, Math.round(size * 0.125));
  strokeRoundRect(
    pixels,
    size,
    bodyPad,
    bodyPad,
    bodySize,
    bodySize,
    bodyRadius,
    COLORS.border,
  );

  const gridPad = Math.round(size * 0.156);
  const gridSize = size - gridPad * 2;
  const gap = Math.max(1, Math.round(size * 0.0625));
  const keySize = Math.floor((gridSize - gap * 2) / 3);
  const keyRadius = Math.max(1, Math.round(keySize * 0.25));

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = gridPad + col * (keySize + gap);
      const y = gridPad + row * (keySize + gap);
      const color = row === 1 && col === 1 ? COLORS.cream : COLORS.gold;
      fillRoundRect(pixels, size, x, y, keySize, keySize, keyRadius, color);
    }
  }

  return pixels;
}

function pngFromRgb(w, h, rgb) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgb.copy(raw, y * stride + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function icoFromPng(pngBuf, w, h) {
  const hdr = Buffer.alloc(22);
  hdr.writeUInt16LE(0, 0);
  hdr.writeUInt16LE(1, 2);
  hdr.writeUInt16LE(1, 4);
  hdr[6] = w >= 256 ? 0 : w;
  hdr[7] = h >= 256 ? 0 : h;
  hdr.writeUInt16LE(1, 10);
  hdr.writeUInt16LE(32, 12);
  hdr.writeUInt32LE(pngBuf.length, 14);
  hdr.writeUInt32LE(22, 18);
  return Buffer.concat([hdr, pngBuf]);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "src-tauri", "icons");
mkdirSync(dir, { recursive: true });

for (const size of [32, 128, 256]) {
  const rgb = drawLogo(size);
  const png = pngFromRgb(size, size, rgb);
  if (size === 32) writeFileSync(join(dir, "32x32.png"), png);
  if (size === 128) writeFileSync(join(dir, "128x128.png"), png);
  if (size === 256) {
    writeFileSync(join(dir, "128x128@2x.png"), png);
    writeFileSync(join(dir, "icon.ico"), icoFromPng(png, 256, 256));
    writeFileSync(join(dir, "icon.icns"), png);
  }
}

console.log("wrote icons in", dir);
