import "server-only";

import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { chequeDeposit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import { type ChequeDepositData, ChequeDepositTemplate } from "@/pdf/templates/cheque-deposit";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

import { loadChequeDepositDocument } from "./deposits";

export function chequeDepositHtml(data: ChequeDepositData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(ChequeDepositTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (cheque_deposit): rendered once, filed under its account. */
export async function renderAndStoreChequeDeposit(
  organizationId: string,
  depositId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const doc = await loadChequeDepositDocument(tx, depositId);
    if (!doc || doc.deposit.pdfFileId) return null;
    const data: ChequeDepositData = {
      number: doc.deposit.number,
      depositedOn: doc.deposit.depositedOn,
      accountName: doc.accountName,
      bankName: doc.bankName,
      accountNumber: doc.accountNumber,
      total: doc.deposit.total,
      cheques: doc.items.map((i) => ({
        chequeNumber: i.chequeNumber,
        bank: i.bank,
        payerName: i.payerName,
        receivedOn: i.receivedOn,
        amount: i.amount,
      })),
    };
    return {
      data,
      accountId: doc.deposit.accountId,
      company: await loadCompanyLetterhead(tx, organizationId),
    };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(chequeDepositHtml(loaded.data, loaded.company)));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: chequeDeposit.pdfFileId })
      .from(chequeDeposit)
      .where(eq(chequeDeposit.id, depositId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the account: its readers (`treasury:read`) download it.
        entityType: "treasury_account",
        entityId: loaded.accountId,
        upload: { fileName: `${loaded.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(chequeDeposit)
      .set({ pdfFileId: stored.id })
      .where(eq(chequeDeposit.id, depositId));
    return "stored";
  });
}
