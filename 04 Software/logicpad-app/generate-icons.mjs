import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function png(w, h, r, g, b) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      const edge = x < 4 || y < 4 || x >= w - 4 || y >= h - 4;
      raw[o] = edge ? 0x12 : r;
      raw[o + 1] = edge ? 0x14 : g;
      raw[o + 2] = edge ? 0x1a : b;
    }
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
const gold = [0xf0, 0xd0, 0x60];
const p32 = png(32, 32, ...gold);
const p128 = png(128, 128, ...gold);
const p256 = png(256, 256, ...gold);
writeFileSync(join(dir, "32x32.png"), p32);
writeFileSync(join(dir, "128x128.png"), p128);
writeFileSync(join(dir, "128x128@2x.png"), p256);
writeFileSync(join(dir, "icon.ico"), icoFromPng(p256, 256, 256));
writeFileSync(join(dir, "icon.icns"), p256);
console.log("wrote icons in", dir);
