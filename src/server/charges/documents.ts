import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  building,
  chargeCall,
  chargeCallLine,
  chargePeriod,
  residence,
  residenceUnit,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { periodLabels } from "@/lib/charges";
import { renderPdf } from "@/pdf/render";
import { type ChargeCallData, ChargeCallTemplate } from "@/pdf/templates/charge-call";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** Everything printed on a charge call (null if unknown). */
export async function loadChargeCallData(
  tx: Tx,
  callId: string,
): Promise<{ data: ChargeCallData; pdfFileId: string | null; residenceId: string } | null> {
  const [row] = await tx
    .select({
      call: chargeCall,
      period: chargePeriod,
      residenceName: residence.name,
      residenceAddress: residence.address,
      commune: residence.commune,
      wilaya: residence.wilaya,
      shareBasis: residence.shareBasis,
      unitCode: unit.code,
      buildingName: building.name,
      share: residenceUnit.share,
    })
    .from(chargeCall)
    .innerJoin(chargePeriod, eq(chargePeriod.id, chargeCall.periodId))
    .innerJoin(residence, eq(residence.id, chargeCall.residenceId))
    .innerJoin(unit, eq(unit.id, chargeCall.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(residenceUnit, eq(residenceUnit.unitId, chargeCall.unitId))
    .where(eq(chargeCall.id, callId));
  if (!row) return null;
  const lines = await tx
    .select({
      label: chargeCallLine.label,
      labelAr: chargeCallLine.labelAr,
      amount: chargeCallLine.amount,
    })
    .from(chargeCallLine)
    .where(eq(chargeCallLine.callId, callId))
    .orderBy(asc(chargeCallLine.position));

  const c = row.call;
  return {
    pdfFileId: c.pdfFileId,
    residenceId: c.residenceId,
    data: {
      number: c.number,
      issuedOn: row.period.issuedOn,
      dueOn: c.dueOn,
      residenceName: row.residenceName,
      residenceAddress: [row.residenceAddress, row.commune, row.wilaya].filter(Boolean).join(", "),
      buildingName: row.buildingName,
      unitCode: row.unitCode,
      share: row.share,
      shareBasis: row.shareBasis,
      period: periodLabels(row.period.frequency, row.period.year, row.period.periodIndex),
      year: row.period.year,
      addressee: c.addresseeName
        ? { name: c.addresseeName, nameAr: c.addresseeNameAr, address: c.addresseeAddress }
        : null,
      lines,
      amount: c.amount,
    },
  };
}

export function chargeCallHtml(data: ChargeCallData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(createElement(ChargeCallTemplate, { data, company }))}`;
}

/** `pdf.document` (charge_call): rendered once, filed under its residence. */
export async function renderAndStoreChargeCall(
  organizationId: string,
  callId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const call = await loadChargeCallData(tx, callId);
    if (!call || call.pdfFileId) return null;
    return { call, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(await renderPdf(chargeCallHtml(loaded.call.data, loaded.company)));

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ pdfFileId: chargeCall.pdfFileId })
      .from(chargeCall)
      .where(eq(chargeCall.id, callId))
      .for("update");
    if (!current || current.pdfFileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        // Filed under the residence: readers need `charge:read`.
        entityType: "residence",
        entityId: loaded.call.residenceId,
        upload: { fileName: `${loaded.call.data.number}.pdf`, bytes },
        contentType: "application/pdf",
      },
    );
    await tx.update(chargeCall).set({ pdfFileId: stored.id }).where(eq(chargeCall.id, callId));
    return "stored";
  });
}
