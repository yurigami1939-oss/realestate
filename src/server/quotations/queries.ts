import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Tx } from "@/db/client";
import { building, lead, project, quotation, quotationLine, unit, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { visibleLeads } from "@/server/crm/access";
import { loadCompanyLetterhead } from "@/server/organizations/settings";

const canceller = alias(user, "canceller");

/** Everything printed on a quotation, or shown on its page. `scope` limits by lead visibility. */
async function loadQuotation(tx: Tx, quotationId: string, ctx?: TenantCtx) {
  const [row] = await tx
    .select({
      quotation,
      leadName: lead.fullName,
      leadPhone: lead.phone,
      projectName: project.name,
      projectAddress: project.address,
      projectCommune: project.commune,
      projectWilaya: project.wilaya,
      buildingName: building.name,
      unitCode: unit.code,
      unitType: unit.type,
      unitFloor: unit.floor,
      unitTypology: unit.typology,
      unitLivingArea: unit.livingArea,
      unitUsableArea: unit.usableArea,
      issuerName: user.name,
      cancellerName: canceller.name,
    })
    .from(quotation)
    .innerJoin(lead, eq(lead.id, quotation.leadId))
    .innerJoin(project, eq(project.id, quotation.projectId))
    .innerJoin(unit, eq(unit.id, quotation.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(user, eq(user.id, quotation.issuedBy))
    .leftJoin(canceller, eq(canceller.id, quotation.cancelledBy))
    .where(and(eq(quotation.id, quotationId), ctx ? visibleLeads(ctx) : undefined));
  if (!row) return null;
  const lines = await tx
    .select({
      position: quotationLine.position,
      label: quotationLine.label,
      shareBp: quotationLine.shareBp,
      amount: quotationLine.amount,
      trigger: quotationLine.trigger,
      dueOn: quotationLine.dueOn,
      milestoneName: quotationLine.milestoneName,
    })
    .from(quotationLine)
    .where(eq(quotationLine.quotationId, quotationId))
    .orderBy(asc(quotationLine.position));
  const { quotation: q, ...rest } = row;
  return { ...q, ...rest, lines };
}

/** Quotation page: details and lines, for a lead the member may see. */
export async function getQuotation(ctx: TenantCtx, quotationId: string) {
  assertCan(ctx, "lead:read");
  if (!isUuid(quotationId)) return null;
  return withTenant(ctx, (tx) => loadQuotation(tx, quotationId, ctx));
}

export type QuotationDetail = NonNullable<Awaited<ReturnType<typeof getQuotation>>>;

/** For the PDF job (no member context): the quotation plus the company's legal identity. */
export async function loadQuotationDocument(tx: Tx, orgId: string, quotationId: string) {
  const detail = await loadQuotation(tx, quotationId);
  if (!detail) return null;
  return { ...detail, company: await loadCompanyLetterhead(tx, orgId) };
}

export type QuotationDocument = NonNullable<Awaited<ReturnType<typeof loadQuotationDocument>>>;

/** Quotations of a lead, newest first (lead sheet). */
export async function listLeadQuotations(ctx: TenantCtx, leadId: string) {
  assertCan(ctx, "lead:read");
  if (!isUuid(leadId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: quotation.id,
        number: quotation.number,
        issuedAt: quotation.issuedAt,
        validUntil: quotation.validUntil,
        price: quotation.price,
        discount: quotation.discount,
        status: quotation.status,
        unitCode: unit.code,
        projectName: project.name,
      })
      .from(quotation)
      .innerJoin(lead, eq(lead.id, quotation.leadId))
      .innerJoin(unit, eq(unit.id, quotation.unitId))
      .innerJoin(project, eq(project.id, quotation.projectId))
      .where(and(eq(quotation.leadId, leadId), visibleLeads(ctx)))
      .orderBy(desc(quotation.issuedAt)),
  );
}
