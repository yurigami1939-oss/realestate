import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  buyerDocument,
  commission,
  commissionRate,
  installment,
  lead,
  project,
  reservation,
  reservationBuyer,
  unit,
  unitOption,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { applyRate } from "@/lib/money";
import {
  buildSchedule,
  checkVspLimits,
  milestoneDueOn,
  netPrice,
  type VspWarning,
} from "@/lib/payment-plans";
import { AppError } from "@/lib/result";
import { requiredBuyerDocuments } from "@/lib/sales";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadVisibleBuyer } from "@/server/buyers/access";
import { recordLeadActivity } from "@/server/crm/activity";
import { advanceLeadStage } from "@/server/crm/leads";
import { assertDiscountAllowed } from "@/server/discounts/service";
import { checkUpload, discardFile, storeFile, type Upload } from "@/server/files/service";
import { transitionUnit } from "@/server/inventory/transition-unit";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";
import { loadSalesSettings } from "@/server/organizations/settings";
import { loadMilestones, loadPaymentPlans } from "@/server/payment-plans/queries";

import { loadVisibleReservation } from "./access";
import type {
  createReservationSchema,
  recordSaleSchema,
  reservationContractSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

function assertNotFuture(date: CalendarDate, field: string) {
  if (date > todayInAlgiers()) throw invalid(field, "sales.errors.futureDate");
}

/** Required documents still missing for these buyers (highlighted, never blocking). */
export async function countMissingDocuments(tx: Tx, buyerIds: string[]) {
  const rows = await tx
    .select({ buyerId: buyerDocument.buyerId, kind: buyerDocument.kind })
    .from(buyerDocument)
    .where(
      and(
        inArray(buyerDocument.buyerId, buyerIds),
        inArray(buyerDocument.kind, [...requiredBuyerDocuments]),
        inArray(buyerDocument.status, ["received", "verified"]),
      ),
    );
  return buyerIds.length * requiredBuyerDocuments.length - rows.length;
}

/**
 * Signs a reservation (CLAUDE.md §7): buyers (1–3, main first), an available unit — or one
 * optioned for one of these buyers' lead —, a payment plan of the unit's project and a discount
 * (managers, or a commercial up to a discount approved for the sale's lead and unit).
 * Snapshots the prices, builds the installments, numbers it RES-…, moves the unit to reserved
 * and the lead to won, and enqueues the reservation sheet PDF.
 */
export async function createReservation(
  ctx: TenantCtx,
  input: In<typeof createReservationSchema>,
): Promise<{ id: string; number: string; warnings: VspWarning[]; missingDocuments: number }> {
  assertCan(ctx, "sale:create");
  assertNotFuture(input.reservedOn, "reservedOn");

  return withTenant(ctx, async (tx) => {
    const buyers = [];
    for (const buyerId of input.buyerIds) buyers.push(await loadVisibleBuyer(tx, ctx, buyerId));
    const buyerLeadIds = buyers.map((b) => b.leadId).filter((id): id is string => id !== null);

    const [target] = await tx
      .select({
        code: unit.code,
        status: unit.status,
        projectId: unit.projectId,
        listPrice: unit.listPrice,
        plannedDeliveryOn: project.plannedDeliveryOn,
      })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(eq(unit.id, input.unitId))
      .for("update", { of: unit });
    if (!target) throw new AppError("NOT_FOUND");
    const [option] =
      target.status === "optioned"
        ? await tx
            .select()
            .from(unitOption)
            .where(and(eq(unitOption.unitId, input.unitId), eq(unitOption.status, "active")))
            .for("update")
        : [];
    if (target.status === "optioned") {
      // Only the holder's lead can reserve an optioned unit (CLAUDE.md §12).
      if (!option || !buyerLeadIds.includes(option.leadId)) {
        throw new AppError("CONFLICT", "sales.errors.optionedForAnother");
      }
    } else if (target.status !== "available") {
      throw new AppError("CONFLICT", "sales.errors.unitNotAvailable");
    }
    if (target.listPrice === null)
      throw new AppError("CONFLICT", "quotations.errors.unitNotPriced");
    if (input.discount > target.listPrice) {
      throw invalid("discount", "quotations.errors.discountTooHigh");
    }

    const [plan] = await loadPaymentPlans(tx, target.projectId, [input.paymentPlanId]);
    if (!plan) throw invalid("paymentPlanId", "quotations.errors.planNotFound");
    const milestones = await loadMilestones(tx, target.projectId);
    const settings = await loadSalesSettings(tx, ctx.orgId);

    // The sale belongs to the lead that held the option, else the main buyer's lead.
    const leadId = option?.leadId ?? buyers[0]?.leadId ?? null;
    const [leadRow] = leadId
      ? await tx.select().from(lead).where(eq(lead.id, leadId)).for("update")
      : [];
    const commercialUserId = leadRow?.assignedTo ?? buyers[0]?.ownerUserId ?? ctx.userId;
    // Managers discount freely; a commercial up to a discount approved for the sale's lead.
    await assertDiscountAllowed(
      tx,
      ctx,
      "sale:discount",
      input.discount,
      leadId ? [leadId] : [],
      input.unitId,
    );

    const price = netPrice(target.listPrice, input.discount);
    const lines = buildSchedule(price, plan.steps, input.reservedOn, milestones);
    const { number } = await nextDocumentNumber(tx, ctx, "reservation");

    const [row] = await tx
      .insert(reservation)
      .values({
        organizationId: ctx.orgId,
        number,
        unitId: input.unitId,
        projectId: target.projectId,
        leadId,
        commercialUserId,
        paymentPlanId: plan.id,
        listPrice: target.listPrice,
        discount: input.discount,
        price,
        reservedOn: input.reservedOn,
        reservationNotary: input.notary,
        reservationReference: input.reference,
        // The contract's delivery date starts as the project's planned delivery (Loi 11-04).
        deliveryDueOn: target.plannedDeliveryOn,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: reservation.id });
    if (!row) throw new Error("createReservation: no row returned");
    await tx.insert(reservationBuyer).values(
      input.buyerIds.map((buyerId, index) => ({
        organizationId: ctx.orgId,
        reservationId: row.id,
        buyerId,
        position: index + 1,
      })),
    );
    await tx.insert(installment).values(
      lines.map((line, index) => {
        const step = plan.steps[index];
        const milestone = milestones.find((m) => m.id === step?.milestoneId);
        return {
          organizationId: ctx.orgId,
          reservationId: row.id,
          position: line.position,
          label: line.label,
          shareBp: line.shareBp,
          amount: line.amount,
          trigger: line.trigger,
          months: step?.months ?? null,
          milestoneId: step?.milestoneId ?? null,
          // A milestone installment is due once its milestone is validated (+ company delay),
          // never before the signing (a milestone already reached is due at signing).
          dueOn:
            line.trigger === "milestone"
              ? milestone?.validatedOn
                ? milestoneDueOn(
                    milestone.validatedOn,
                    settings.paymentCallDelayDays,
                    input.reservedOn,
                  )
                : null
              : line.dueOn,
        };
      }),
    );

    if (option) {
      await tx
        .update(unitOption)
        .set({ status: "converted", endedAt: new Date(), endedBy: ctx.userId })
        .where(eq(unitOption.id, option.id));
    }
    await transitionUnit(tx, ctx, input.unitId, "reserved", {
      refType: "reservation",
      refId: row.id,
    });
    if (leadRow) {
      if (option) {
        await recordLeadActivity(tx, ctx, leadRow.id, "option_ended", {
          optionId: option.id,
          unitCode: target.code,
          reason: "converted",
        });
      }
      await recordLeadActivity(tx, ctx, leadRow.id, "reserved", {
        reservationId: row.id,
        number,
        unitCode: target.code,
      });
      await advanceLeadStage(tx, ctx, leadRow, "won");
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "reservation.create",
      entityType: "reservation",
      entityId: row.id,
      after: {
        number,
        unit: target.code,
        buyers: input.buyerIds,
        plan: plan.name,
        listPrice: target.listPrice,
        discount: input.discount,
        price,
        reservedOn: input.reservedOn,
      },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "reservation_sheet", id: row.id },
      { singletonKey: `reservation_sheet:${row.id}` },
    );

    return {
      id: row.id,
      number,
      warnings: checkVspLimits(
        plan.steps,
        milestones.map((m) => ({ id: m.id, stage: m.stage })),
        settings.vspLimits,
      ),
      missingDocuments: await countMissingDocuments(tx, input.buyerIds),
    };
  });
}

/** Notary and reference of the reservation contract. */
export async function updateReservationContract(
  ctx: TenantCtx,
  input: In<typeof reservationContractSchema>,
) {
  assertCan(ctx, "sale:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadVisibleReservation(tx, ctx, input.reservationId, {
      forUpdate: true,
    });
    if (current.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const after = {
      notary: input.notary,
      reference: input.reference,
      deliveryDueOn: input.deliveryDueOn,
      guaranteeNumber: input.guaranteeNumber,
      guaranteeIssuedOn: input.guaranteeIssuedOn,
      guaranteePremium: input.guaranteePremium,
    };
    await tx
      .update(reservation)
      .set({
        reservationNotary: after.notary,
        reservationReference: after.reference,
        deliveryDueOn: after.deliveryDueOn,
        guaranteeNumber: after.guaranteeNumber,
        guaranteeIssuedOn: after.guaranteeIssuedOn,
        guaranteePremium: after.guaranteePremium,
      })
      .where(eq(reservation.id, input.reservationId));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "reservation.update_contract",
      entityType: "reservation",
      entityId: input.reservationId,
      before: {
        notary: current.reservationNotary,
        reference: current.reservationReference,
        deliveryDueOn: current.deliveryDueOn,
        guaranteeNumber: current.guaranteeNumber,
        guaranteeIssuedOn: current.guaranteeIssuedOn,
        guaranteePremium: current.guaranteePremium,
      },
      after,
    });
  });
}

const scanPurposes = {
  contract: "reservation.contract",
  deed: "reservation.deed",
  guarantee: "reservation.guarantee",
} as const;

/**
 * Attaches the signed scan of the reservation contract, of the VSP deed, or of the FGCMPI
 * guarantee certificate.
 */
export async function setReservationScan(
  ctx: TenantCtx,
  input: { reservationId: string; kind: "contract" | "deed" | "guarantee"; upload: Upload },
) {
  assertCan(ctx, "sale:update");
  const purpose = scanPurposes[input.kind];
  const contentType = checkUpload(purpose, input.upload);
  return withTenant(ctx, async (tx) => {
    const current = await loadVisibleReservation(tx, ctx, input.reservationId, {
      forUpdate: true,
    });
    if (input.kind === "deed" && current.status !== "sold") {
      throw new AppError("CONFLICT", "sales.errors.notSold");
    }
    if (current.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const stored = await storeFile(tx, ctx, {
      entityType: "reservation",
      entityId: input.reservationId,
      upload: input.upload,
      contentType,
    });
    const previous = {
      contract: current.reservationScanFileId,
      deed: current.saleScanFileId,
      guarantee: current.guaranteeScanFileId,
    }[input.kind];
    const set = {
      contract: { reservationScanFileId: stored.id },
      deed: { saleScanFileId: stored.id },
      guarantee: { guaranteeScanFileId: stored.id },
    }[input.kind];
    await tx.update(reservation).set(set).where(eq(reservation.id, input.reservationId));
    if (previous) await discardFile(tx, previous);
    return { fileId: stored.id };
  });
}

/**
 * VSP signed at the notary (CLAUDE.md §7): reserved → sold, VSP-… reference, and the
 * commercial's commission earned on the net price at their rate (company default otherwise).
 */
export async function recordSale(ctx: TenantCtx, input: In<typeof recordSaleSchema>) {
  assertCan(ctx, "sale:sign");
  assertNotFuture(input.signedOn, "signedOn");
  return withTenant(ctx, async (tx) => {
    const current = await loadVisibleReservation(tx, ctx, input.reservationId, {
      forUpdate: true,
    });
    if (current.status !== "reserved") throw new AppError("CONFLICT", "sales.errors.notReserved");
    if (input.signedOn < current.reservedOn)
      throw invalid("signedOn", "sales.errors.beforeReservation");

    const { number: saleNumber } = await nextDocumentNumber(tx, ctx, "sale_contract");
    await tx
      .update(reservation)
      .set({
        status: "sold",
        saleNumber,
        saleSignedOn: input.signedOn,
        saleNotary: input.notary,
        saleReference: input.reference,
      })
      .where(eq(reservation.id, current.id));
    await transitionUnit(tx, ctx, current.unitId, "sold", {
      refType: "reservation",
      refId: current.id,
    });

    let commissionAmount: bigint | null = null;
    if (current.commercialUserId) {
      const settings = await loadSalesSettings(tx, ctx.orgId);
      const [own] = await tx
        .select({ rateBp: commissionRate.rateBp })
        .from(commissionRate)
        .where(eq(commissionRate.userId, current.commercialUserId));
      const rateBp = own?.rateBp ?? settings.defaultCommissionRateBp;
      if (rateBp > 0) {
        commissionAmount = applyRate(current.price, rateBp);
        await tx.insert(commission).values({
          organizationId: ctx.orgId,
          reservationId: current.id,
          userId: current.commercialUserId,
          base: current.price,
          rateBp,
          amount: commissionAmount,
          earnedOn: input.signedOn,
        });
      }
    }

    const [target] = await tx
      .select({ code: unit.code })
      .from(unit)
      .where(eq(unit.id, current.unitId));
    if (current.leadId) {
      await recordLeadActivity(tx, ctx, current.leadId, "sale_signed", {
        reservationId: current.id,
        unitCode: target?.code ?? null,
      });
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "sale.sign",
      entityType: "reservation",
      entityId: current.id,
      before: { status: "reserved" },
      after: {
        status: "sold",
        saleNumber,
        signedOn: input.signedOn,
        notary: input.notary,
        commission: commissionAmount,
      },
    });

    const buyerIds = (
      await tx
        .select({ id: reservationBuyer.buyerId })
        .from(reservationBuyer)
        .where(eq(reservationBuyer.reservationId, current.id))
    ).map((b) => b.id);
    return { saleNumber, missingDocuments: await countMissingDocuments(tx, buyerIds) };
  });
}
