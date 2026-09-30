import "server-only";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { QuotationDocument } from "@/server/quotations/queries";

import { renderPdf } from "./render";
import { QuotationTemplate } from "./templates/quotation";

export function quotationHtml(doc: QuotationDocument): string {
  return `<!doctype html>${renderToStaticMarkup(createElement(QuotationTemplate, { doc }))}`;
}

export function renderQuotationPdf(doc: QuotationDocument): Promise<Buffer> {
  return renderPdf(quotationHtml(doc));
}
