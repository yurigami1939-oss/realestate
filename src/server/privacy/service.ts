import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";

import {
  buyer,
  buyerDocument,
  followUp,
  lead,
  leadActivity,
  payment,
  project,
  quotation,
  receipt,
  reservation,
  reservationBuyer,
  unit,
  visit,
  whatsappMessage,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ANONYMIZED_NAME } from "@/lib/privacy";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleBuyer } from "@/server/buyers/access";
import { loadVisibleLead } from "@/server/crm/access";
import type { ExportResult, Translate } from "@/server/exports/builders";
import { exportFileName } from "@/server/exports/xlsx";

import type { anonymizeLeadSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const fieldRows = (t: Translate, prefix: string, record: Record<string, unknown>) =>
  Object.entries(record).flatMap(([key, value]) =>
    value === null || value === undefined || value === "" || typeof value === "object"
      ? []
      : [[t(`${prefix}.${key}`), String(value)]],
  );

/** WhatsApp messages sent to these numbers (the log keeps the recipient's number). */
async function messagesTo(tx: Parameters<Parameters<typeof withTenant>[1]>[0], phones: string[]) {
  if (phones.length === 0) return [];
  return tx
    .select({
      createdAt: whatsappMessage.createdAt,
      kind: whatsappMessage.kind,
      status: whatsappMessage.status,
      recipient: whatsappMessage.recipient,
    })
    .from(whatsappMessage)
    .where(inArray(whatsappMessage.recipient, phones))
    .orderBy(desc(whatsappMessage.createdAt));
}

/**
 * What the organization holds about one person (Loi 18-07, right of access), as a workbook:
 * a buyer file (identity, documents, sales, payments, WhatsApp messages) or a prospect
 * (identity, timeline, visits, follow-ups, quotations). `personal_data:export` (gérant,
 * directeur commercial), within their visibility; the export is audited like every export.
 */
export async function personExport(
  ctx: TenantCtx,
  params: { buyer?: string; lead?: string },
  t: Translate,
): Promise<ExportResult> {
  assertCan(ctx, "personal_data:export");
  if (!params.buyer === !params.lead) throw new AppError("VALIDATION", "privacy.errors.onePerson");
  return withTenant(ctx, async (tx) => {
    if (params.buyer) {
      const found = await loadVisibleBuyer(tx, ctx, params.buyer);
      const documents = await tx
        .select({
          kind: buyerDocument.kind,
          status: buyerDocument.status,
          note: buyerDocument.note,
        })
        .from(buyerDocument)
        .where(eq(buyerDocument.buyerId, found.id));
      const sales = await tx
        .select({
          id: reservation.id,
          number: reservation.number,
          status: reservation.status,
          reservedOn: reservation.reservedOn,
          price: reservation.price,
          unitCode: unit.code,
          projectName: project.name,
        })
        .from(reservationBuyer)
        .innerJoin(reservation, eq(reservation.id, reservationBuyer.reservationId))
        .innerJoin(unit, eq(unit.id, reservation.unitId))
        .innerJoin(project, eq(project.id, reservation.projectId))
        .where(eq(reservationBuyer.buyerId, found.id))
        .orderBy(asc(reservation.reservedOn));
      const payments =
        sales.length === 0
          ? []
          : await tx
              .select({
                paidOn: payment.paidOn,
                amount: payment.amount,
                method: payment.method,
                status: payment.status,
                receipt: receipt.number,
                saleNumber: reservation.number,
              })
              .from(payment)
              .innerJoin(reservation, eq(reservation.id, payment.reservationId))
              .leftJoin(receipt, eq(receipt.paymentId, payment.id))
              .where(
                inArray(
                  payment.reservationId,
                  sales.map((s) => s.id),
                ),
              )
              .orderBy(asc(payment.paidOn));
      const messages = await messagesTo(tx, [found.phone]);
      const {
        id: _id,
        organizationId: _org,
        leadId: _lead,
        ownerUserId: _owner,
        createdAt: _created,
        updatedAt: _updated,
        createdBy: _createdBy,
        deletedAt: _deleted,
        deletedBy: _deletedBy,
        ...identity
      } = found;
      return {
        file: exportFileName(`donnees-${found.lastName}-${found.firstName}`, "loi-18-07"),
        rows: documents.length + sales.length + payments.length + messages.length,
        sheets: [
          {
            name: t("privacy.sheets.identity"),
            columns: [
              { header: t("privacy.columns.field"), width: 28 },
              { header: t("privacy.columns.value"), width: 48 },
            ],
            rows: fieldRows(t, "buyers.fields", identity),
          },
          {
            name: t("privacy.sheets.documents"),
            columns: [
              { header: t("privacy.columns.document"), width: 30 },
              { header: t("privacy.columns.status"), width: 16 },
              { header: t("privacy.columns.note"), width: 40 },
            ],
            rows: documents.map((d) => [
              t(`buyers.documents.kind.${d.kind}`),
              t(`buyers.documents.status.${d.status}`),
              d.note,
            ]),
          },
          {
            name: t("privacy.sheets.sales"),
            columns: [
              { header: t("privacy.columns.number"), width: 18 },
              { header: t("privacy.columns.unit"), width: 30 },
              { header: t("privacy.columns.date"), kind: "date" },
              { header: t("privacy.columns.amount"), kind: "money" },
              { header: t("privacy.columns.status"), width: 16 },
            ],
            rows: sales.map((s) => [
              s.number,
              `${s.unitCode} · ${s.projectName}`,
              s.reservedOn,
              s.price,
              t(`sales.status.${s.status}`),
            ]),
          },
          {
            name: t("privacy.sheets.payments"),
            columns: [
              { header: t("privacy.columns.date"), kind: "date" },
              { header: t("privacy.columns.number"), width: 18 },
              { header: t("privacy.columns.sale"), width: 18 },
              { header: t("privacy.columns.method"), width: 16 },
              { header: t("privacy.columns.amount"), kind: "money" },
              { header: t("privacy.columns.status"), width: 14 },
            ],
            rows: payments.map((p) => [
              p.paidOn,
              p.receipt,
              p.saleNumber,
              t(`payments.method.${p.method}`),
              p.amount,
              t(`exports.${p.status}`),
            ]),
          },
          {
            name: t("privacy.sheets.messages"),
            columns: [
              { header: t("privacy.columns.date"), kind: "date" },
              { header: t("privacy.columns.message"), width: 30 },
              { header: t("privacy.columns.status"), width: 14 },
            ],
            rows: messages.map((m) => [
              m.createdAt,
              t(`whatsapp.kind.${m.kind}`),
              t(`whatsapp.status.${m.status}`),
            ]),
          },
        ],
      };
    }

    const found = await loadVisibleLead(tx, ctx, params.lead ?? "");
    const activities = await tx
      .select({ type: leadActivity.type, createdAt: leadActivity.createdAt })
      .from(leadActivity)
      .where(eq(leadActivity.leadId, found.id))
      .orderBy(asc(leadActivity.createdAt));
    const visits = await tx
      .select({ scheduledAt: visit.scheduledAt, status: visit.status, notes: visit.notes })
      .from(visit)
      .where(eq(visit.leadId, found.id))
      .orderBy(asc(visit.scheduledAt));
    const followUps = await tx
      .select({ dueAt: followUp.dueAt, channel: followUp.channel, note: followUp.note })
      .from(followUp)
      .where(eq(followUp.leadId, found.id))
      .orderBy(asc(followUp.dueAt));
    const quotations = await tx
      .select({
        number: quotation.number,
        netPrice: quotation.price,
        createdAt: quotation.issuedAt,
      })
      .from(quotation)
      .where(eq(quotation.leadId, found.id))
      .orderBy(asc(quotation.issuedAt));
    return {
      file: exportFileName(`donnees-${found.fullName}`, "loi-18-07"),
      rows: activities.length + visits.length + followUps.length + quotations.length,
      sheets: [
        {
          name: t("privacy.sheets.identity"),
          columns: [
            { header: t("privacy.columns.field"), width: 28 },
            { header: t("privacy.columns.value"), width: 48 },
          ],
          rows: fieldRows(t, "crm.leads.fields", {
            fullName: found.fullName,
            phone: found.phone,
            email: found.email,
            city: found.city,
            notes: found.notes,
          }),
        },
        {
          name: t("privacy.sheets.timeline"),
          columns: [
            { header: t("privacy.columns.date"), kind: "date" },
            { header: t("privacy.columns.event"), width: 36 },
          ],
          rows: activities.map((a) => [a.createdAt, t(`crm.leads.activity.${a.type}`)]),
        },
        {
          name: t("privacy.sheets.visits"),
          columns: [
            { header: t("privacy.columns.date"), kind: "date" },
            { header: t("privacy.columns.status"), width: 16 },
            { header: t("privacy.columns.note"), width: 40 },
          ],
          rows: [
            ...visits.map((v) => [v.scheduledAt, t(`crm.visitStatus.${v.status}`), v.notes]),
            ...followUps.map((f) => [f.dueAt, t(`crm.channel.${f.channel}`), f.note]),
          ],
        },
        {
          name: t("privacy.sheets.quotations"),
          columns: [
            { header: t("privacy.columns.number"), width: 18 },
            { header: t("privacy.columns.date"), kind: "date" },
            { header: t("privacy.columns.amount"), kind: "money" },
          ],
          rows: quotations.map((q) => [q.number, q.createdAt, q.netPrice]),
        },
      ],
    };
  });
}

/**
 * Erases a prospect who never became a buyer (Loi 18-07, right to erasure; `personal_data:erase`):
 * the name becomes « Prospect anonymisé », the phone, e-mail, city and notes go, as do the
 * notes of its visits, follow-ups and timeline; what is not personal (source, stage, dates,
 * project, budget) stays for the statistics. Refused once a buyer file comes from the prospect
 * (contracts are kept as the law requires). Audited without the erased values.
 */
export async function anonymizeLead(ctx: TenantCtx, input: In<typeof anonymizeLeadSchema>) {
  assertCan(ctx, "personal_data:erase");
  await withTenant(ctx, async (tx) => {
    const found = await loadVisibleLead(tx, ctx, input.leadId, { forUpdate: true });
    if (found.fullName === ANONYMIZED_NAME) {
      throw new AppError("CONFLICT", "privacy.errors.alreadyAnonymized");
    }
    const [linked] = await tx
      .select({ id: buyer.id })
      .from(buyer)
      .where(and(eq(buyer.leadId, found.id), isNull(buyer.deletedAt)))
      .limit(1);
    if (linked) throw new AppError("CONFLICT", "privacy.errors.leadHasBuyer");
    await tx
      .update(lead)
      .set({
        fullName: ANONYMIZED_NAME,
        phone: `anonyme-${found.id.slice(0, 8)}`,
        phone2: null,
        email: null,
        city: null,
        notes: null,
        lostNote: null,
        sourceDetail: null,
      })
      .where(eq(lead.id, found.id));
    await tx.update(visit).set({ notes: null, outcome: null }).where(eq(visit.leadId, found.id));
    await tx
      .update(followUp)
      .set({ note: null, outcome: null })
      .where(eq(followUp.leadId, found.id));
    await tx.update(leadActivity).set({ data: null }).where(eq(leadActivity.leadId, found.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "lead.anonymize",
      entityType: "lead",
      entityId: found.id,
      reason: input.reason,
    });
  });
}
