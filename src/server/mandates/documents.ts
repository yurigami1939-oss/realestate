import "server-only";

import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ownerStatement, propertyOwner } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import { type OwnerStatementData, OwnerStatementTemplate } from "@/pdf/templates/owner-statement";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

import { OWNER_ENTITY } from "./service";

export function ownerStatementHtml(data: OwnerStatementData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(OwnerStatementTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (owner_statement): rendered once, filed under its owner. */
export async function renderAndStoreOwnerStatement(
  organizationId: string,
  statementId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const [row] = await tx
      .select({ statement: ownerStatement, owner: propertyOwner })
      .from(ownerStatement)
      .innerJoin(propertyOwner, eq(propertyOwner.id, ownerStatement.ownerId))
      .where(eq(ownerStatement.id, statementId));
    if (!row || row.statement.pdfFileId) return null;
    const s = row.statement;
    const data: OwnerStatementData = {
      number: s.number,
      issuedOn: s.issuedOn,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      owner: {
        name: row.owner.name,
        nameAr: row.owner.nameAr,
        address: row.owner.address,
        rib: row.owner.rib,
      },
      lines: s.lines.map((l) => ({ ...l, amount: BigInt(l.amount), fee: BigInt(l.fee) })),
      extras: s.extras.map((e) => ({ label: e.label, amount: BigInt(e.amount) })),
      collected: s.collected,
      fees: s.fees,
      deductions: s.deductions,
      net: s.net,
    };
    return { data, ownerId: s.ownerId, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(ownerStatementHtml(loaded.data, loaded.company)));
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: ownerStatement.pdfFileId })
      .from(ownerStatement)
      .where(eq(ownerStatement.id, statementId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the owner: the leases' readers (`lease:read`) download it.
        entityType: OWNER_ENTITY,
        entityId: loaded.ownerId,
        upload: { fileName: `${loaded.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(ownerStatement)
      .set({ pdfFileId: stored.id })
      .where(eq(ownerStatement.id, statementId));
    return "stored";
  });
}
