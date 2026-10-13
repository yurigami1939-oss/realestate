/**
 * Draws the app's icons (CLAUDE.md §3): the brand mark after Sayroura's logo — white and gold
 * towers under a white roof with a gold window, on a navy square (the same drawing as
 * src/components/brand/brand-mark.tsx) — written as the favicon (src/app/icon.svg) and rendered
 * by Chromium (playwright-core, already used for the PDFs) into public/: rounded with transparent
 * corners for « any », full bleed for iOS, full bleed with the drawing inside the central 80 % for
 * « maskable ». Run: pnpm exec tsx scripts/generate-icons.ts — the files are committed.
 */
import { writeFileSync } from "node:fs";

import { chromium } from "playwright-core";

/** The mark in a 100 × 100 space: `radius` of the square's corners, `scale` of the drawing. */
export function markSvg({ radius = 22.5, scale = 1 } = {}): string {
  const drawing = `
    <rect x="25" y="31" width="11" height="40" fill="url(#s-gold)"/>
    <rect x="39" y="18" width="17" height="53" fill="#ffffff"/>
    <rect x="59" y="37" width="11" height="34" fill="#ffffff" fill-opacity="0.82"/>
    <path d="M14 79 50 55 86 79V100H14Z" fill="url(#s-bg)"/>
    <path d="M18 78.5 50 57 82 78.5" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <g fill="url(#s-gold)">
      <rect x="46" y="66" width="3.6" height="3.6" rx="0.4"/>
      <rect x="50.4" y="66" width="3.6" height="3.6" rx="0.4"/>
      <rect x="46" y="70.4" width="3.6" height="3.6" rx="0.4"/>
      <rect x="50.4" y="70.4" width="3.6" height="3.6" rx="0.4"/>
    </g>`;
  const placed =
    scale === 1
      ? drawing
      : `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${drawing}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="s-bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
      <stop offset="0" stop-color="#253f80"/>
      <stop offset="1" stop-color="#101c42"/>
    </linearGradient>
    <linearGradient id="s-gold" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="80">
      <stop offset="0" stop-color="#ecc77f"/>
      <stop offset="1" stop-color="#bd8729"/>
    </linearGradient>
    <clipPath id="s-clip"><rect width="100" height="100" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#s-clip)">
    <rect width="100" height="100" fill="url(#s-bg)"/>${placed}
  </g>
</svg>
`;
}

const icons = [
  { file: "public/icon-192.png", size: 192, svg: markSvg() },
  { file: "public/icon-512.png", size: 512, svg: markSvg() },
  { file: "public/icon-maskable-512.png", size: 512, svg: markSvg({ radius: 0, scale: 0.8 }) },
  { file: "public/apple-icon.png", size: 180, svg: markSvg({ radius: 0 }) },
];

writeFileSync("src/app/icon.svg", markSvg());
const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const src = `data:image/svg+xml;base64,${Buffer.from(icon.svg).toString("base64")}`;
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="${src}" width="${icon.size}" height="${icon.size}" style="display:block"></body>`,
    );
    await page.screenshot({ path: icon.file, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("icons written to public/ and src/app/icon.svg");
