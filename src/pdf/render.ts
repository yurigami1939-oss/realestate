import "server-only";

import { type Browser, chromium } from "playwright-core";

/**
 * HTML → PDF with headless Chromium (CLAUDE.md §12: chosen over @react-pdf/renderer, which
 * mis-orders mixed Arabic/Latin text). Runs in the worker; one browser per process.
 * Chromium comes from `playwright install chromium` (dev, CI, worker image).
 */
let browser: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  browser ??= chromium.launch({ args: ["--font-render-hinting=none"] });
  return browser;
}

/** Page size and margins come from the document's CSS `@page` rule. */
export async function renderPdf(html: string): Promise<Buffer> {
  const context = await (await getBrowser()).newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  const pending = browser;
  browser = null;
  if (pending) await (await pending).close();
}
