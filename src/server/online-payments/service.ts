import "server-only";

import { randomInt } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  chargePayment,
  lease,
  onlinePayment,
  payment,
  paymentGateway,
  project,
  rentPayment,
  reservation,
  residence,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { enqueueInTx } from "@/jobs/enqueue";
import { toCalendarDate, todayInAlgiers } from "@/lib/dates";
import { ORDER_NUMBER_LENGTH, type OnlinePaymentPurpose } from "@/lib/online-payments";
import { can } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { chargeStatement, liveCalls, paidByUnit } from "@/server/charges/accounts";
import { cancelChargePayment, insertChargePayment } from "@/server/charges/payments";
import { cancelPayment, insertSalePayment } from "@/server/payments/service";
import { type PortalCtx, portalScope } from "@/server/portal/context";
import { portalLeases } from "@/server/portal/leases";
import { portalSales } from "@/server/portal/sales";
import { leaseExtras, leasePaid, rentStatement } from "@/server/rentals/accounts";
import { cancelRentPayment, insertRentPayment, loadLease } from "@/server/rentals/service";
import { loadResidence } from "@/server/residences/service";
import { paidTotals } from "@/server/sales/sale-queries";
import { encryptSecret } from "@/server/secrets";

import { loadGateway } from "./gateway";
import {
  type SatimLanguage,
  type SatimOrderState,
  satimConfirm,
  satimRefund,
  satimRegister,
  SatimUnavailableError,
} from "./satim";
import type {
  gatewaySettingsSchema,
  refundOnlinePaymentSchema,
  startOnlinePaymentSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;
type OnlinePaymentRow = typeof onlinePayment.$inferSelect;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** The gateway's payment session lasts 20 minutes; an order still unpaid after this expires. */
const SESSION_MINUTES = 20;
/** When the background check looks at an order the payer may have left (after the session). */
const CHECK_AFTER_SECONDS = 30 * 60;

const languageOf = (locale: string): SatimLanguage => (locale === "ar" ? "ar" : "fr");

/** Saves the SATIM merchant account (gérant). An empty password keeps the saved one. Audited. */
export async function saveGatewaySettings(ctx: TenantCtx, input: In<typeof gatewaySettingsSchema>) {
  assertCan(ctx, "organization:update");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(paymentGateway)
      .where(eq(paymentGateway.organizationId, ctx.orgId))
      .for("update");
    if (!current && input.password === "") throw invalid("password", "validation.required");
    const settings = {
      enabled: input.enabled,
      environment: input.environment,
      username: input.username,
      terminalId: input.terminalId,
      salesEnabled: input.salesEnabled,
      chargesEnabled: input.chargesEnabled,
      rentEnabled: input.rentEnabled,
      updatedBy: ctx.userId,
    };
    const password = input.password ? { passwordEncrypted: encryptSecret(input.password) } : {};
    if (current) {
      await tx
        .update(paymentGateway)
        .set({ ...settings, ...password })
        .where(eq(paymentGateway.organizationId, ctx.orgId));
    } else {
      await tx.insert(paymentGateway).values({
        organizationId: ctx.orgId,
        ...settings,
        passwordEncrypted: encryptSecret(input.password),
      });
    }
    const visible = (s: Omit<typeof settings, "updatedBy">) => ({
      enabled: s.enabled,
      environment: s.environment,
      username: s.username,
      terminalId: s.terminalId,
      salesEnabled: s.salesEnabled,
      chargesEnabled: s.chargesEnabled,
      rentEnabled: s.rentEnabled,
    });
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.online_payment",
      entityType: "organization",
      entityId: ctx.orgId,
      before: current ? visible(current) : null,
      after: { ...visible(settings), passwordChanged: input.password !== "" },
    });
  });
}

/**
 * What a portal account is about to pay: its own sale, the charges of a unit it co-owns, or the
 * rent of a lease it is the tenant (occupant) of.
 */
async function portalTarget(
  tx: Tx,
  ctx: PortalCtx,
  purpose: OnlinePaymentPurpose,
  targetId: string,
) {
  const scope = await portalScope(tx, ctx);
  if (purpose === "sale") {
    if (scope.buyerIds.length === 0) throw new AppError("NOT_FOUND");
    const [sale] = await tx
      .select({
        id: reservation.id,
        number: reservation.number,
        price: reservation.price,
        unitCode: unit.code,
        projectName: project.name,
      })
      .from(reservation)
      .innerJoin(unit, eq(unit.id, reservation.unitId))
      .innerJoin(project, eq(project.id, reservation.projectId))
      .where(and(eq(reservation.id, targetId), portalSales(tx, scope.buyerIds)));
    if (!sale) throw new AppError("NOT_FOUND");
    const paid = (await paidTotals(tx, [sale.id])).get(sale.id) ?? 0n;
    return {
      target: { reservationId: sale.id, residenceId: null, unitId: null, leaseId: null },
      remaining: sale.price - paid,
      description: `${sale.projectName} - ${sale.unitCode} - ${sale.number}`,
    };
  }
  if (purpose === "rent") {
    const [rented] = await portalLeases(tx, scope, targetId);
    if (!rented) throw new AppError("NOT_FOUND");
    const [row] = await tx.select().from(lease).where(eq(lease.id, rented.id));
    if (!row) throw new AppError("NOT_FOUND");
    const extras = (await leaseExtras(tx, [row.id]))(row.id);
    const paid = (await leasePaid(tx, [row.id])).get(row.id)?.rent ?? 0n;
    return {
      target: { reservationId: null, residenceId: null, unitId: null, leaseId: row.id },
      remaining: rentStatement({ ...row, ...extras }, paid, todayInAlgiers()).remaining,
      description: `${rented.projectName} - ${rented.unitCode} - ${row.number}`,
    };
  }
  const owned = scope.residents.find((r) => r.kind === "co_owner" && r.unitId === targetId);
  if (!owned) throw new AppError("NOT_FOUND");
  const [home] = await tx
    .select({ name: residence.name, unitCode: unit.code })
    .from(residence)
    .innerJoin(unit, eq(unit.id, owned.unitId))
    .where(eq(residence.id, owned.residenceId));
  const calls = await liveCalls(tx, owned.residenceId, [owned.unitId]);
  const paid = (await paidByUnit(tx, owned.residenceId, [owned.unitId])).get(owned.unitId) ?? 0n;
  return {
    target: {
      reservationId: null,
      residenceId: owned.residenceId,
      unitId: owned.unitId,
      leaseId: null,
    },
    remaining: chargeStatement(calls, paid, todayInAlgiers()).remaining,
    description: `${home?.name ?? ""} - ${home?.unitCode ?? ""} - charges`,
  };
}

/** A 10-digit order number not used yet by the organization (SATIM wants it unique). */
async function freeOrderNumber(tx: Tx): Promise<string> {
  for (;;) {
    const candidate = Array.from({ length: ORDER_NUMBER_LENGTH }, () => randomInt(0, 10)).join("");
    const [taken] = await tx
      .select({ id: onlinePayment.id })
      .from(onlinePayment)
      .where(eq(onlinePayment.orderNumber, candidate));
    if (!taken) return candidate;
  }
}

/**
 * Starts an online payment from the portal (CLAUDE.md §7 Online payment): checks the account's
 * own sale or co-owned unit and the remaining balance, writes the payment, registers the order
 * with the gateway and returns its payment page. A background check (`online_payment.check`)
 * settles it if the payer never comes back.
 */
export async function startOnlinePayment(
  ctx: PortalCtx,
  input: In<typeof startOnlinePaymentSchema>,
): Promise<{ id: string; formUrl: string }> {
  const prepared = await withTenant(ctx, async (tx) => {
    const gateway = await loadGateway(tx, ctx.orgId);
    const open =
      gateway?.enabled &&
      {
        sale: gateway.salesEnabled,
        charges: gateway.chargesEnabled,
        rent: gateway.rentEnabled,
      }[input.purpose];
    if (!gateway || !open) throw new AppError("CONFLICT", "onlinePayments.errors.disabled");
    const { target, remaining, description } = await portalTarget(
      tx,
      ctx,
      input.purpose,
      input.targetId,
    );
    if (input.amount > remaining) throw invalid("amount", "onlinePayments.errors.aboveBalance");
    const [row] = await tx
      .insert(onlinePayment)
      .values({
        organizationId: ctx.orgId,
        purpose: input.purpose,
        ...target,
        amount: input.amount,
        orderNumber: await freeOrderNumber(tx),
        environment: gateway.environment,
        userId: ctx.userId,
        payerName: ctx.name,
        locale: ctx.locale,
        description,
      })
      .returning();
    if (!row) throw new Error("startOnlinePayment: no row returned");
    return { row, account: gateway.account(gateway.environment) };
  });

  let { row } = prepared;
  const back = new URL("/api/online-payments/return", env.BETTER_AUTH_URL);
  back.searchParams.set("org", ctx.orgId);
  back.searchParams.set("id", row.id);
  const fail = async (gatewayError: string, gatewayMessage: string | null, messageKey: string) => {
    await withTenant(ctx, (tx) =>
      tx
        .update(onlinePayment)
        .set({ status: "failed", gatewayError, gatewayMessage, checkedAt: new Date() })
        .where(eq(onlinePayment.id, row.id)),
    );
    return new AppError("CONFLICT", messageKey);
  };

  // A number SATIM already knows (from another environment or a reset database): draw again.
  for (let attempt = 1; ; attempt++) {
    let registered;
    try {
      registered = await satimRegister(prepared.account, {
        orderNumber: row.orderNumber,
        amount: row.amount,
        returnUrl: back.toString(),
        failUrl: back.toString(),
        description: row.description,
        language: languageOf(row.locale),
      });
    } catch (error) {
      if (!(error instanceof SatimUnavailableError)) throw error;
      console.error("[online payment] register", error.message);
      throw await fail("unavailable", null, "onlinePayments.errors.gatewayUnavailable");
    }
    if (registered.ok) {
      const { orderId, formUrl } = registered;
      await withTenant(ctx, async (tx) => {
        await tx
          .update(onlinePayment)
          .set({ status: "pending", gatewayOrderId: orderId, formUrl })
          .where(eq(onlinePayment.id, row.id));
        await enqueueInTx(
          tx,
          "online_payment.check",
          { organizationId: ctx.orgId, onlinePaymentId: row.id },
          { startAfter: CHECK_AFTER_SECONDS, singletonKey: `online_payment:${row.id}` },
        );
      });
      return { id: row.id, formUrl };
    }
    if (registered.code !== "1" || attempt === 3) {
      throw await fail(registered.code, registered.message, "onlinePayments.errors.gatewayRefused");
    }
    const [renumbered] = await withTenant(ctx, async (tx) =>
      tx
        .update(onlinePayment)
        .set({ orderNumber: await freeOrderNumber(tx) })
        .where(eq(onlinePayment.id, row.id))
        .returning(),
    );
    if (!renumbered) throw new Error("startOnlinePayment: row vanished");
    row = renumbered;
  }
}

/**
 * Records a confirmed online payment as the sale's payment (receipt REC-) or the unit's charge
 * payment (receipt RCH-), by the portal account that paid. A business rule refusing it (sale
 * closed, balance already settled meanwhile) leaves it paid but not recorded, with the reason,
 * for the staff to refund or settle (the savepoint undoes any partial write).
 */
async function recordOnlinePayment(tx: Tx, row: OnlinePaymentRow, state: SatimOrderState) {
  const actor = { orgId: row.organizationId, userId: row.userId };
  const entry = {
    amount: row.amount,
    method: "card" as const,
    // Paid during the gateway session, minutes after it started.
    paidOn: toCalendarDate(row.createdAt),
    reference: row.orderNumber,
    bank: null,
    payerName: row.payerName,
    notes: null,
  };
  const audit = { onlineOrder: row.orderNumber, approvalCode: state.approvalCode };
  const none = { paymentId: null, chargePaymentId: null, rentPaymentId: null };
  if (state.amount !== null && state.amount !== row.amount) {
    return { ...none, issue: "onlinePayments.issues.amount" };
  }
  try {
    return await tx.transaction(async (sp) => {
      if (row.purpose === "sale") {
        if (!row.reservationId) throw new Error("online payment without sale");
        const [sale] = await sp
          .select()
          .from(reservation)
          .where(eq(reservation.id, row.reservationId))
          .for("update");
        if (!sale) throw new AppError("NOT_FOUND");
        const { paymentId } = await insertSalePayment(sp, actor, sale, entry, audit);
        return { ...none, paymentId, issue: null };
      }
      if (row.purpose === "rent") {
        if (!row.leaseId) throw new Error("online payment without lease");
        const rented = await loadLease(sp, row.leaseId);
        const { paymentId } = await insertRentPayment(
          sp,
          actor,
          rented,
          { ...entry, kind: "rent" },
          audit,
        );
        return { ...none, rentPaymentId: paymentId, issue: null };
      }
      if (!row.residenceId || !row.unitId) throw new Error("online payment without unit");
      const home = await loadResidence(sp, row.residenceId);
      const { paymentId } = await insertChargePayment(sp, actor, home, row.unitId, entry, audit);
      return { ...none, chargePaymentId: paymentId, issue: null };
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { ...none, issue: error.messageKey ?? `errors.${error.code}` };
  }
}

/**
 * Asks the gateway where an online payment stands and applies the answer (return from the
 * payment page, background check, staff or payer refresh): paid → recorded with its receipt;
 * declined → failed; still open → unchanged, or expired after the session when `expireOpen`.
 * Idempotent (row lock); a paid answer also settles a payment marked failed or expired, since the
 * money was taken. Null when the payment does not exist.
 */
export async function finalizeOnlinePayment(
  orgId: string,
  onlinePaymentId: string,
  options: { expireOpen?: boolean } = {},
): Promise<OnlinePaymentRow | null> {
  const scope = { orgId };
  const loaded = await withTenant(scope, async (tx) => {
    const [row] = await tx
      .select()
      .from(onlinePayment)
      .where(eq(onlinePayment.id, onlinePaymentId));
    return row ? { row, gateway: await loadGateway(tx, orgId) } : null;
  });
  if (!loaded) return null;
  const { row, gateway } = loaded;
  if (!row.gatewayOrderId || !gateway || row.status === "paid" || row.status === "refunded") {
    return row;
  }
  const state = await satimConfirm(
    gateway.account(row.environment),
    row.gatewayOrderId,
    languageOf(row.locale),
  );

  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select()
      .from(onlinePayment)
      .where(eq(onlinePayment.id, onlinePaymentId))
      .for("update");
    if (!current || current.status === "paid" || current.status === "refunded") {
      return current ?? null;
    }
    const now = new Date();
    const seen = {
      gatewayStatus: state.orderStatus,
      gatewayError: state.errorCode,
      gatewayMessage: state.message,
      approvalCode: state.approvalCode ?? current.approvalCode,
      cardPan: state.pan ?? current.cardPan,
      checkedAt: now,
    };
    if (state.outcome === "paid") {
      const recorded = await recordOnlinePayment(tx, current, state);
      const [paid] = await tx
        .update(onlinePayment)
        .set({ ...seen, ...recorded, status: "paid", paidAt: now })
        .where(eq(onlinePayment.id, onlinePaymentId))
        .returning();
      await recordAudit(tx, scope, {
        actorUserId: null,
        action: "online_payment.paid",
        entityType: "online_payment",
        entityId: onlinePaymentId,
        after: {
          order: current.orderNumber,
          amount: current.amount,
          approvalCode: state.approvalCode,
          issue: recorded.issue,
        },
      });
      return paid ?? null;
    }
    const sessionOver = now.getTime() - current.createdAt.getTime() > SESSION_MINUTES * 60_000;
    const status =
      state.outcome === "declined"
        ? "failed"
        : options.expireOpen && sessionOver && state.orderStatus === 0
          ? "expired"
          : current.status;
    const [updated] = await tx
      .update(onlinePayment)
      .set({ ...seen, status })
      .where(eq(onlinePayment.id, onlinePaymentId))
      .returning();
    return updated ?? null;
  });
}

/**
 * `online_payment.check`: settles a payment the payer may have left on the gateway's page.
 * "open" when the gateway still has it in progress (the job is retried later).
 */
export async function checkOnlinePayment(
  orgId: string,
  onlinePaymentId: string,
): Promise<"settled" | "open"> {
  const row = await finalizeOnlinePayment(orgId, onlinePaymentId, { expireOpen: true });
  return row?.status === "pending" ? "open" : "settled";
}

/**
 * Staff may act on a sale's online payments with `sale:read_all`, on charges with `charge:read`,
 * on rents with `lease:read`.
 */
export const seesOnlinePayment = (ctx: Pick<TenantCtx, "roles">, purpose: OnlinePaymentPurpose) =>
  can(
    ctx.roles,
    ({ sale: "sale:read_all", charges: "charge:read", rent: "lease:read" } as const)[purpose],
  );

async function loadForStaff(ctx: TenantCtx, onlinePaymentId: string) {
  const [row] = await withTenant(ctx, (tx) =>
    tx.select().from(onlinePayment).where(eq(onlinePayment.id, onlinePaymentId)),
  );
  if (!row || !seesOnlinePayment(ctx, row.purpose)) throw new AppError("NOT_FOUND");
  return row;
}

/** Staff: asks the gateway again (a payment still pending, or paid later than expected). */
export async function recheckOnlinePayment(ctx: TenantCtx, onlinePaymentId: string) {
  assertCan(ctx, "payment:create");
  await loadForStaff(ctx, onlinePaymentId);
  return gatewayCall(() => finalizeOnlinePayment(ctx.orgId, onlinePaymentId, { expireOpen: true }));
}

/** Portal: the payer asks again where its payment stands. */
export async function refreshPortalOnlinePayment(ctx: PortalCtx, onlinePaymentId: string) {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ id: onlinePayment.id })
      .from(onlinePayment)
      .where(and(eq(onlinePayment.id, onlinePaymentId), eq(onlinePayment.userId, ctx.userId))),
  );
  if (!row) throw new AppError("NOT_FOUND");
  const updated = await gatewayCall(() => finalizeOnlinePayment(ctx.orgId, onlinePaymentId));
  return { status: updated?.status ?? null };
}

/** A gateway that cannot be reached is a conflict the user can retry, not a crash. */
async function gatewayCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof SatimUnavailableError)) throw error;
    console.error("[online payment]", error.message);
    throw new AppError("CONFLICT", "onlinePayments.errors.gatewayUnavailable");
  }
}

/**
 * Refunds a paid online payment through the gateway (accountants), then cancels the payment and
 * its receipt with the reason. The gateway goes first: an order it already refunded is not
 * refunded twice. Audited.
 */
export async function refundOnlinePayment(
  ctx: TenantCtx,
  input: In<typeof refundOnlinePaymentSchema>,
) {
  assertCan(ctx, "payment:cancel");
  const row = await loadForStaff(ctx, input.onlinePaymentId);
  if (row.status !== "paid" || !row.gatewayOrderId) {
    throw new AppError("CONFLICT", "onlinePayments.errors.notPaid");
  }
  const gateway = await withTenant(ctx, (tx) => loadGateway(tx, ctx.orgId));
  if (!gateway) throw new AppError("CONFLICT", "onlinePayments.errors.disabled");
  const account = gateway.account(row.environment);
  const orderId = row.gatewayOrderId;
  await gatewayCall(async () => {
    const state = await satimConfirm(account, orderId, languageOf(row.locale));
    if (state.orderStatus === 4) return;
    const refunded = await satimRefund(account, orderId, row.amount);
    if (!refunded.ok) {
      throw new AppError("CONFLICT", "onlinePayments.errors.refundRefused", {
        details: { code: refunded.code, message: refunded.message },
      });
    }
  });

  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(onlinePayment)
      .where(eq(onlinePayment.id, row.id))
      .for("update");
    if (current?.status !== "paid") throw new AppError("CONFLICT", "onlinePayments.errors.notPaid");
    if (current.paymentId) {
      const [recorded] = await tx
        .select({ status: payment.status })
        .from(payment)
        .where(eq(payment.id, current.paymentId));
      if (recorded?.status === "valid") {
        await cancelPayment(ctx, { paymentId: current.paymentId, reason: input.reason }, tx);
      }
    }
    if (current.chargePaymentId) {
      const [recorded] = await tx
        .select({ status: chargePayment.status })
        .from(chargePayment)
        .where(eq(chargePayment.id, current.chargePaymentId));
      if (recorded?.status === "valid") {
        await cancelChargePayment(
          ctx,
          { paymentId: current.chargePaymentId, reason: input.reason },
          tx,
        );
      }
    }
    if (current.rentPaymentId) {
      const [recorded] = await tx
        .select({ status: rentPayment.status })
        .from(rentPayment)
        .where(eq(rentPayment.id, current.rentPaymentId));
      if (recorded?.status === "valid") {
        await cancelRentPayment(
          ctx,
          { paymentId: current.rentPaymentId, reason: input.reason },
          tx,
        );
      }
    }
    await tx
      .update(onlinePayment)
      .set({
        status: "refunded",
        refundedAt: new Date(),
        refundedBy: ctx.userId,
        refundReason: input.reason,
      })
      .where(eq(onlinePayment.id, row.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "online_payment.refund",
      entityType: "online_payment",
      entityId: row.id,
      before: { status: "paid", amount: row.amount, order: row.orderNumber },
      after: { status: "refunded" },
      reason: input.reason,
    });
  });
}

/**
 * The payer is back from the gateway's page: confirms the payment, then answers its language for
 * the result page (null when unknown). A gateway that cannot be reached leaves it pending: the
 * result page shows it as being checked, the payer or the background check asks again.
 */
export async function returnFromGateway(
  orgId: string,
  onlinePaymentId: string,
): Promise<string | null> {
  try {
    return (await finalizeOnlinePayment(orgId, onlinePaymentId))?.locale ?? null;
  } catch (error) {
    console.error("[online payment] return", error);
    const [row] = await withTenant({ orgId }, (tx) =>
      tx
        .select({ locale: onlinePayment.locale })
        .from(onlinePayment)
        .where(eq(onlinePayment.id, onlinePaymentId)),
    );
    return row?.locale ?? null;
  }
}
