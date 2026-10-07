/**
 * Draws the installable app's icons into public/ (CLAUDE.md §3): a dark rounded square with
 * three white buildings, the content kept inside the central 80 % so the icon also serves as
 * « maskable ». PNG encoded with node:zlib (no image library). Run: pnpm exec tsx
 * scripts/generate-icons.ts — the files are committed.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

type Rgb = readonly [number, number, number];

const BACKGROUND: Rgb = [23, 23, 23];
const WHITE: Rgb = [255, 255, 255];
const ACCENT: Rgb = [16, 185, 129];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size: number, pixels: Uint8Array): Buffer {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Shapes in a 100 × 100 space, drawn at `size` pixels. */
function draw(size: number, rounded: boolean): Buffer {
  const pixels = new Uint8Array(size * size * 3);
  const unit = size / 100;
  const paint = (x0: number, y0: number, x1: number, y1: number, color: Rgb) => {
    for (let y = Math.round(y0 * unit); y < Math.round(y1 * unit); y++) {
      for (let x = Math.round(x0 * unit); x < Math.round(x1 * unit); x++) {
        pixels.set(color, (y * size + x) * 3);
      }
    }
  };
  // Background: a rounded square for « any », the full square for « maskable ».
  pixels.fill(255);
  const radius = rounded ? 22 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / unit;
      const v = (y + 0.5) / unit;
      const cx = Math.min(Math.max(u, radius), 100 - radius);
      const cy = Math.min(Math.max(v, radius), 100 - radius);
      if ((u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2) pixels.set(BACKGROUND, (y * size + x) * 3);
    }
  }
  // Three buildings on a ground line, windows cut out; a green accent on the tallest.
  paint(22, 40, 38, 74, WHITE);
  paint(42, 26, 58, 74, WHITE);
  paint(62, 48, 78, 74, WHITE);
  paint(42, 22, 58, 26, ACCENT);
  for (const [x0, top] of [
    [22, 40],
    [42, 26],
    [62, 48],
  ] as const) {
    for (let y = top + 5; y < 68; y += 8) {
      paint(x0 + 3, y, x0 + 7, y + 4, BACKGROUND);
      paint(x0 + 9, y, x0 + 13, y + 4, BACKGROUND);
    }
  }
  paint(18, 74, 82, 78, WHITE);
  return encodePng(size, pixels);
}

writeFileSync("public/icon-192.png", draw(192, true));
writeFileSync("public/icon-512.png", draw(512, true));
writeFileSync("public/icon-maskable-512.png", draw(512, false));
writeFileSync("public/apple-icon.png", draw(180, false));
console.log("icons written to public/");
