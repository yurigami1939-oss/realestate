/**
 * Draws the installable app's icons into public/ (CLAUDE.md §3): the brand mark — a white house
 * with an arched door on a blue gradient (src/components/brand/brand-mark.tsx,
 * src/app/icon.svg) — on a rounded square for « any » (transparent corners) and full bleed for
 * « maskable » and iOS, the house inside the central 80 %. PNG encoded with node:zlib (no image library), edges smoothed by
 * 4 × 4 supersampling. Run: pnpm exec tsx scripts/generate-icons.ts — the files are committed.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

type Rgb = readonly [number, number, number];

const TOP: Rgb = [59, 155, 255];
const BOTTOM: Rgb = [0, 98, 224];
const WHITE: Rgb = [255, 255, 255];

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

/** RGBA pixels → PNG (color type 6). */
function encodePng(size: number, pixels: Uint8Array): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Inside the rounded square of the background (100 × 100 space). */
function inBackground(u: number, v: number, radius: number): boolean {
  const cx = Math.min(Math.max(u, radius), 100 - radius);
  const cy = Math.min(Math.max(v, radius), 100 - radius);
  return (u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2;
}

/** An arch: straight sides from `bottom` up to its semicircle of center (50, `cy`). */
function inArch(u: number, v: number, halfWidth: number, cy: number, bottom: number): boolean {
  if (v > bottom || Math.abs(u - 50) > halfWidth) return false;
  return v >= cy || (u - 50) ** 2 + (v - cy) ** 2 <= halfWidth ** 2;
}

/** Even-odd test of a point against a polygon. */
function inPolygon(u: number, v: number, points: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] ?? [0, 0];
    const [xj, yj] = points[j] ?? [0, 0];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The house of the mark: its roof overhanging the walls, and its arched door cut out. */
const HOUSE = [
  [50, 23],
  [78, 47],
  [73, 47],
  [73, 78],
  [27, 78],
  [27, 47],
  [22, 47],
] as const;

function inMark(u: number, v: number): boolean {
  return inPolygon(u, v, HOUSE) && !inArch(u, v, 7, 63, 78);
}

function draw(size: number, rounded: boolean): Buffer {
  const pixels = new Uint8Array(size * size * 4);
  const unit = size / 100;
  const samples = 4;
  const radius = rounded ? 22.5 : 0;
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const fill = TOP.map((c, i) => Math.round(c + ((BOTTOM[i] ?? c) - c) * t));
    for (let x = 0; x < size; x++) {
      let background = 0;
      let mark = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / unit;
          const v = (y + (sy + 0.5) / samples) / unit;
          if (!inBackground(u, v, radius)) continue;
          background++;
          if (inMark(u, v)) mark++;
        }
      }
      const total = samples * samples;
      const share = background === 0 ? 0 : mark / background;
      const color = fill.map((c, i) => Math.round(c + ((WHITE[i] ?? c) - c) * share));
      pixels.set([...color, Math.round((background / total) * 255)], (y * size + x) * 4);
    }
  }
  return encodePng(size, pixels);
}

writeFileSync("public/icon-192.png", draw(192, true));
writeFileSync("public/icon-512.png", draw(512, true));
writeFileSync("public/icon-maskable-512.png", draw(512, false));
writeFileSync("public/apple-icon.png", draw(180, false));
console.log("icons written to public/");
