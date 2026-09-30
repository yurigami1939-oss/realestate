import "server-only";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { renderPdf } from "./render";
import { type ReceiptData, ReceiptTemplate } from "./templates/receipt";

export type { ReceiptData };

export function receiptHtml(data: ReceiptData): string {
  return `<!doctype html>${renderToStaticMarkup(createElement(ReceiptTemplate, { data }))}`;
}

export function renderReceiptPdf(data: ReceiptData): Promise<Buffer> {
  return renderPdf(receiptHtml(data));
}
