import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { receiptHtml } from "@/pdf/receipt";
import { CompanyNote } from "@/pdf/templates/company-note";

import { addMember, createTenantCtx } from "../../../tests/factories";

import { documentTextsSchema } from "./schemas";
import { getCompanySettings, loadCompanyLetterhead, saveDocumentTexts } from "./settings";

afterAll(async () => {
  await stopEnqueue();
});

describe("the organization's wording on its documents", () => {
  it("keeps a paragraph per kind and prints it on the documents", async () => {
    const owner = await createTenantCtx();
    const cashier = await addMember(owner.orgId, ["cashier"]);
    const input = documentTextsSchema.parse({
      texts: {
        receipt: { fr: "Caisse ouverte de 8 h à 15 h.", ar: "الصندوق مفتوح من 8 إلى 15." },
        payment_call: { fr: "Virement au RIB 002 00012 3456789012 34.", ar: "" },
        quotation: { fr: "  ", ar: "" },
      },
    });
    await expect(saveDocumentTexts(cashier, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(() =>
      documentTextsSchema.parse({ texts: { receipt: { fr: "x".repeat(1001), ar: "" } } }),
    ).toThrow();
    await saveDocumentTexts(owner, input);
    // Blank kinds are not kept.
    expect((await getCompanySettings(owner)).documentTexts).toEqual({
      receipt: { fr: "Caisse ouverte de 8 h à 15 h.", ar: "الصندوق مفتوح من 8 إلى 15." },
      payment_call: { fr: "Virement au RIB 002 00012 3456789012 34.", ar: "" },
    });
    const company = await withTenant(owner, (tx) => loadCompanyLetterhead(tx, owner.orgId));

    // A payment call carries its note, a quotation none.
    const call = renderToStaticMarkup(
      createElement(CompanyNote, { company, kind: "payment_call" }),
    );
    expect(call).toContain('data-company-note="payment_call"');
    expect(call).toContain("Virement au RIB");
    expect(call).not.toContain('dir="rtl"');
    expect(renderToStaticMarkup(createElement(CompanyNote, { company, kind: "quotation" }))).toBe(
      "",
    );

    // Receipts print the receipts' note, French then Arabic.
    const html = receiptHtml({
      number: "REC-2026-000001",
      issuedAt: new Date(),
      organization: {
        legalName: "SARL",
        address: "",
        rcNumber: "",
        nif: "",
        nis: "",
        aiNumber: "",
        note: company.documentTexts.receipt ?? null,
      },
      payer: { fr: "Karim", ar: "كريم" },
      reference: { fr: "Réservation", ar: "حجز" },
      method: { fr: "Espèces", ar: "نقداً" },
      amount: 1_000_000n,
      cashier: "Amina",
    });
    expect(html).toContain("Caisse ouverte de 8 h à 15 h.");
    expect(html).toContain("الصندوق مفتوح من 8 إلى 15.");

    const audits = await withTenant(owner, (tx) => tx.select().from(auditLog));
    expect(audits.filter((a) => a.action === "organization.document_texts")).toHaveLength(1);
  });
});
