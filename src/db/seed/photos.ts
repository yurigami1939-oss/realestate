/**
 * Demo site photos (seed only): a building under construction drawn as a PNG — sky, ground, a
 * concrete frame whose built floors follow the progress, formwork on the top slab and a crane.
 * Encoded with node:zlib so the seed needs no image library.
 */
import { deflateSync } from "node:zlib";

const WIDTH = 640;
const HEIGHT = 400;
const GROUND = 318;

type Rgb = readonly [number, number, number];

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

/** 8-bit RGB pixels (row by row) → PNG bytes. */
function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, truecolour, deflate, no filter, no interlace
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

class Canvas {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  set(x: number, y: number, [r, g, b]: Rgb) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const i = (y * WIDTH + x) * 3;
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: Rgb) {
    for (let y = Math.max(0, y0); y < Math.min(HEIGHT, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(WIDTH, x1); x++) this.set(x, y, color);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: Rgb) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
      this.set(
        Math.round(x0 + ((x1 - x0) * i) / steps),
        Math.round(y0 + ((y1 - y0) * i) / steps),
        color,
      );
    }
  }
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * A site photo of a building of `floors` storeys whose works are `percent` done; `variant`
 * moves the point of view so the photos of a report differ.
 */
export function sitePhoto({
  floors,
  percent,
  variant = 0,
}: {
  floors: number;
  percent: number;
  variant?: number;
}): Uint8Array {
  const canvas = new Canvas();
  // Sky and ground.
  for (let y = 0; y < GROUND; y++) {
    canvas.rect(0, y, WIDTH, y + 1, mix([118, 176, 226], [214, 233, 246], y / GROUND));
  }
  for (let y = GROUND; y < HEIGHT; y++) {
    const shade = mix([176, 150, 116], [146, 120, 92], (y - GROUND) / (HEIGHT - GROUND));
    canvas.rect(
      0,
      y,
      WIDTH,
      y + 1,
      (y - GROUND) % 9 === 0 ? mix(shade, [120, 98, 76], 0.5) : shade,
    );
  }

  // The frame: built floors in concrete with their window openings, then the formwork.
  const floorHeight = Math.min(34, Math.floor((GROUND - 70) / floors));
  const left = 150 + variant * 40;
  const right = left + 270;
  const built = Math.max(1, Math.round((floors * percent) / 100));
  for (let f = 0; f < built; f++) {
    const bottom = GROUND - f * floorHeight;
    const top = bottom - floorHeight;
    canvas.rect(left, top, right, bottom, [188, 187, 181]);
    canvas.rect(left, top, right, top + 4, [150, 149, 144]); // slab edge
    // Openings are filled once the masonry is done (lower floors first).
    const closed = percent >= 100 || (percent > 55 && f < built - 2);
    for (let x = left + 14; x + 30 < right; x += 44) {
      canvas.rect(x, top + 10, x + 28, bottom - 6, closed ? [92, 122, 148] : [84, 86, 90]);
    }
  }
  const topSlab = GROUND - built * floorHeight;
  if (percent < 100) {
    // Formwork and rebars on the slab being cast.
    canvas.rect(left, topSlab - 6, right, topSlab, [206, 124, 58]);
    for (let x = left + 6; x < right; x += 12)
      canvas.line(x, topSlab - 6, x, topSlab - 18, [96, 70, 52]);
    // Scaffolding up the façade.
    for (let y = GROUND; y > topSlab; y -= 18)
      canvas.line(left - 14, y, left - 2, y, [210, 170, 70]);
    canvas.line(left - 14, GROUND, left - 14, topSlab - 10, [210, 170, 70]);
  }

  if (percent >= 100) return encodePng(WIDTH, HEIGHT, canvas.pixels);

  // Tower crane, gone once the building is finished.
  const mast = right + 60 - variant * 20;
  canvas.rect(mast, 52, mast + 10, GROUND, [236, 188, 40]);
  for (let y = GROUND; y > 60; y -= 16) canvas.line(mast, y, mast + 10, y - 16, [190, 150, 30]);
  canvas.rect(mast - 230, 52, mast + 70, 60, [236, 188, 40]);
  canvas.rect(mast + 40, 60, mast + 66, 78, [120, 120, 120]); // counterweight
  const hook = mast - 120;
  canvas.line(hook, 60, hook, topSlab - 40, [60, 60, 60]);
  canvas.rect(hook - 10, topSlab - 40, hook + 10, topSlab - 30, [140, 110, 70]);

  return encodePng(WIDTH, HEIGHT, canvas.pixels);
}
