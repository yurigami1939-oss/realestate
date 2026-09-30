import { afterAll, describe, expect, it } from "vitest";

import { closePdfBrowser } from "./render";
import { type ReceiptData, receiptHtml, renderReceiptPdf } from "./receipt";

const sample: ReceiptData = {
  number: "REC-2026-000123",
  issuedAt: new Date("2026-09-30T10:00:00Z"),
  organization: {
    legalName: "SARL El Bahdja Immobilier",
    address: "12, rue Didouche Mourad, Alger",
    rcNumber: "16/00-1234567B19",
    nif: "001916123456789",
    nis: "001916010012345",
    aiNumber: "16012345678",
  },
  payer: { fr: "Mohamed Benali", ar: "محمد بن علي" },
  reference: { fr: "Échéance 2/6 · Appt A-03-12", ar: "القسط 2/6 · شقة A-03-12" },
  method: { fr: "Chèque n° 4521877 (BNA)", ar: "صك رقم 4521877 (BNA)" },
  amount: 125_000_050n,
  cashier: "Amina Haddad",
};

afterAll(async () => {
  await closePdfBrowser();
});

describe("receipt document", () => {
  it("puts Arabic in isolated RTL blocks and prints both amounts in words", () => {
    const html = receiptHtml(sample);
    expect(html).toContain('dir="rtl" lang="ar"');
    expect(html).toContain("<bdi>صك رقم 4521877 (BNA)</bdi>");
    expect(html).toContain("un million deux cent cinquante mille dinars algériens");
    expect(html).toContain("مليون ومائتان وخمسون ألف دينار جزائري");
    expect(html).toContain("REC-2026-000123");
  });

  it("renders a one-page PDF with Chromium", async () => {
    const pdf = await renderReceiptPdf(sample);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages).toHaveLength(1);
  });
});
