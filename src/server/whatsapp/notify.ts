import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  buyer,
  lease,
  project,
  reservation,
  reservationBuyer,
  residence,
  resident,
  unit,
  whatsappMessage,
} from "@/db/schema";
import type { TenantScope } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, formatDate, formatDateTime, todayInAlgiers } from "@/lib/dates";
import { type Centimes, formatDZD } from "@/lib/money";
import {
  templateParam,
  templateParamCount,
  type WhatsappKind,
  type WhatsappLanguage,
  whatsappNumber,
  whatsappTemplates,
} from "@/lib/whatsapp";
import { currentResident } from "@/server/residences/service";

import { companyName, loadWhatsappAccount, templateFor } from "./account";

export type WhatsappRecipient = { phone: string | null; name: string; optIn: boolean };

type Message = {
  ref: { type: string; id: string };
  recipients: WhatsappRecipient[];
  params: (language: WhatsappLanguage, recipient: WhatsappRecipient) => string[];
};

/**
 * Queues one template message per recipient who agreed and has a WhatsApp number (each number
 * once), in the caller's transaction: it exists only if the event commits, and the worker sends
 * it (`whatsapp.send`). `build` only runs when the organization sends this kind (WhatsApp is off
 * by default: one query). A message whose parameters do not fit its template is logged as
 * failed, never sent (Meta would refuse it) — the event itself always goes through. Returns the
 * number of messages queued.
 */
export async function queueWhatsapp(
  tx: Tx,
  scope: TenantScope,
  kind: WhatsappKind,
  build: (company: string) => Promise<Message>,
): Promise<number> {
  const account = await loadWhatsappAccount(tx, scope.orgId);
  const template = account ? templateFor(account, kind) : null;
  if (!account || !template) return 0;
  const message = await build(await companyName(tx, scope.orgId));
  const seen = new Set<string>();
  for (const recipient of message.recipients) {
    const to = recipient.optIn ? whatsappNumber(recipient.phone) : null;
    if (!to || seen.has(to)) continue;
    seen.add(to);
    const params = message.params(account.language, recipient).map((p) => templateParam(p));
    const fits = params.length === templateParamCount(whatsappTemplates[kind]);
    const [row] = await tx
      .insert(whatsappMessage)
      .values({
        organizationId: scope.orgId,
        kind,
        recipient: to,
        recipientName: recipient.name,
        template,
        language: account.language,
        params,
        refType: message.ref.type,
        refId: message.ref.id,
        ...(fits ? {} : { status: "failed" as const, error: "parameters", failedAt: new Date() }),
      })
      .returning({ id: whatsappMessage.id });
    if (!row) throw new Error("queueWhatsapp: no row returned");
    if (!fits) {
      console.error(`[whatsapp] ${kind}: ${params.length} parameters, template expects others`);
      continue;
    }
    await enqueueInTx(
      tx,
      "whatsapp.send",
      { organizationId: scope.orgId, messageId: row.id },
      { singletonKey: `whatsapp:${row.id}` },
    );
  }
  return seen.size;
}

const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim();
const money = (amount: Centimes, language: WhatsappLanguage) => formatDZD(amount, language);
const unitLabel = (language: WhatsappLanguage, unitCode: string, place: string) =>
  language === "ar" ? `الوحدة ${unitCode} (${place})` : `le lot ${unitCode} (${place})`;

/** Buyers of a sale (main first) and what they bought. */
async function saleAudience(tx: Tx, saleId: string) {
  const buyers = await tx
    .select({
      firstName: buyer.firstName,
      lastName: buyer.lastName,
      phone: buyer.phone,
      optIn: buyer.whatsappOptIn,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, saleId))
    .orderBy(asc(reservationBuyer.position));
  const [sale] = await tx
    .select({ unitCode: unit.code, projectName: project.name })
    .from(reservation)
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .where(eq(reservation.id, saleId));
  return {
    recipients: buyers.map((b) => ({ phone: b.phone, name: fullName(b), optIn: b.optIn })),
    object: (language: WhatsappLanguage) =>
      unitLabel(language, sale?.unitCode ?? "", sale?.projectName ?? ""),
  };
}

/** A sale's payment was recorded (counter or online), with its receipt. */
export function notifySalePayment(
  tx: Tx,
  scope: TenantScope,
  saleId: string,
  paid: { amount: Centimes; receiptNumber: string },
) {
  return queueWhatsapp(tx, scope, "payment_received", async (company) => {
    const audience = await saleAudience(tx, saleId);
    return {
      ref: { type: "reservation", id: saleId },
      recipients: audience.recipients,
      params: (language, r) => [
        r.name,
        company,
        money(paid.amount, language),
        audience.object(language),
        paid.receiptNumber,
      ],
    };
  });
}

/** An appel de fonds was issued for a sale. */
export function notifyPaymentCall(
  tx: Tx,
  scope: TenantScope,
  saleId: string,
  call: { number: string; amount: Centimes; dueOn: CalendarDate },
) {
  return queueWhatsapp(tx, scope, "payment_call", async (company) => {
    const audience = await saleAudience(tx, saleId);
    return {
      ref: { type: "reservation", id: saleId },
      recipients: audience.recipients,
      params: (language, r) => [
        r.name,
        company,
        call.number,
        money(call.amount, language),
        audience.object(language),
        formatDate(call.dueOn),
      ],
    };
  });
}

/** A reminder letter was issued for a sale's overdue installments. */
export function notifyPaymentReminder(
  tx: Tx,
  scope: TenantScope,
  saleId: string,
  reminder: { overdue: Centimes; payBy: CalendarDate },
) {
  return queueWhatsapp(tx, scope, "payment_reminder", async (company) => {
    const audience = await saleAudience(tx, saleId);
    return {
      ref: { type: "reservation", id: saleId },
      recipients: audience.recipients,
      params: (language, r) => [
        r.name,
        money(reminder.overdue, language),
        company,
        audience.object(language),
        formatDate(reminder.payBy),
      ],
    };
  });
}

/** The handover appointment of a sold unit was set (or moved). */
export function notifyHandoverAppointment(
  tx: Tx,
  scope: TenantScope,
  saleId: string,
  scheduledAt: Date,
) {
  return queueWhatsapp(tx, scope, "handover_appointment", async (company) => {
    const audience = await saleAudience(tx, saleId);
    const [day = "", time = ""] = formatDateTime(scheduledAt).split(" ");
    return {
      ref: { type: "reservation", id: saleId },
      recipients: audience.recipients,
      params: (language, r) => [r.name, company, audience.object(language), day, time],
    };
  });
}

/** « le lot A-03-01 (Résidence …) » for a unit of a residence. */
async function residenceUnitObject(tx: Tx, residenceId: string, unitId: string) {
  const [row] = await tx
    .select({ residenceName: residence.name, unitCode: unit.code })
    .from(residence)
    .innerJoin(unit, eq(unit.id, unitId))
    .where(eq(residence.id, residenceId));
  return (language: WhatsappLanguage) =>
    unitLabel(language, row?.unitCode ?? "", row?.residenceName ?? "");
}

/** The current main co-owner of a unit (the one its charges are addressed to). */
async function mainCoOwner(tx: Tx, residenceId: string, unitId: string) {
  const [row] = await tx
    .select({
      firstName: resident.firstName,
      lastName: resident.lastName,
      phone: resident.phone,
      optIn: resident.whatsappOptIn,
    })
    .from(resident)
    .where(
      and(
        eq(resident.residenceId, residenceId),
        eq(resident.unitId, unitId),
        eq(resident.kind, "co_owner"),
        currentResident(todayInAlgiers()),
      ),
    )
    .orderBy(desc(resident.isMain), asc(resident.lastName))
    .limit(1);
  return row ? [{ phone: row.phone, name: fullName(row), optIn: row.optIn }] : [];
}

/** A charge call was issued to a unit's co-owner (`owner`, as addressed on the call). */
export function notifyChargeCall(
  tx: Tx,
  scope: TenantScope,
  call: {
    residenceId: string;
    unitId: string;
    number: string;
    amount: Centimes;
    dueOn: CalendarDate;
    owner: WhatsappRecipient | null;
  },
) {
  if (!call.owner) return Promise.resolve(0);
  const owner = call.owner;
  return queueWhatsapp(tx, scope, "charge_call", async () => {
    const object = await residenceUnitObject(tx, call.residenceId, call.unitId);
    return {
      ref: { type: "residence", id: call.residenceId },
      recipients: [owner],
      params: (language, r) => [
        r.name,
        call.number,
        money(call.amount, language),
        object(language),
        formatDate(call.dueOn),
      ],
    };
  });
}

/** Charges paid for a unit (receipt RCH-), to its main co-owner. */
export function notifyChargePayment(
  tx: Tx,
  scope: TenantScope,
  paid: { residenceId: string; unitId: string; amount: Centimes; receiptNumber: string },
) {
  return queueWhatsapp(tx, scope, "charge_received", async () => {
    const object = await residenceUnitObject(tx, paid.residenceId, paid.unitId);
    return {
      ref: { type: "residence", id: paid.residenceId },
      recipients: await mainCoOwner(tx, paid.residenceId, paid.unitId),
      params: (language, r) => [
        r.name,
        money(paid.amount, language),
        object(language),
        paid.receiptNumber,
      ],
    };
  });
}

/** A reminder letter for a unit's overdue charges, to its main co-owner. */
export function notifyChargeReminder(
  tx: Tx,
  scope: TenantScope,
  reminder: { residenceId: string; unitId: string; overdue: Centimes; payBy: CalendarDate },
) {
  return queueWhatsapp(tx, scope, "charge_reminder", async () => {
    const object = await residenceUnitObject(tx, reminder.residenceId, reminder.unitId);
    return {
      ref: { type: "residence", id: reminder.residenceId },
      recipients: await mainCoOwner(tx, reminder.residenceId, reminder.unitId),
      params: (language, r) => [
        r.name,
        money(reminder.overdue, language),
        object(language),
        formatDate(reminder.payBy),
      ],
    };
  });
}

/** Rent (or the deposit) received from a tenant, with its quittance number. */
export function notifyRentPayment(
  tx: Tx,
  scope: TenantScope,
  leaseId: string,
  paid: { amount: Centimes; receiptNumber: string },
) {
  return queueWhatsapp(tx, scope, "rent_received", async () => {
    const [row] = await tx
      .select({
        number: lease.number,
        tenantName: lease.tenantName,
        tenantPhone: lease.tenantPhone,
        optIn: lease.tenantWhatsappOptIn,
        unitCode: unit.code,
      })
      .from(lease)
      .innerJoin(unit, eq(unit.id, lease.unitId))
      .where(eq(lease.id, leaseId));
    return {
      ref: { type: "lease", id: leaseId },
      recipients: row ? [{ phone: row.tenantPhone, name: row.tenantName, optIn: row.optIn }] : [],
      params: (language, r) => [
        r.name,
        money(paid.amount, language),
        language === "ar"
          ? `عقد الإيجار ${row?.number ?? ""} (الوحدة ${row?.unitCode ?? ""})`
          : `le bail ${row?.number ?? ""} (lot ${row?.unitCode ?? ""})`,
        paid.receiptNumber,
      ],
    };
  });
}

/** Residents of a residence today (co-owners, and occupants unless `coOwnersOnly`). */
async function residenceAudience(tx: Tx, residenceId: string, coOwnersOnly: boolean) {
  const rows = await tx
    .select({
      firstName: resident.firstName,
      lastName: resident.lastName,
      phone: resident.phone,
      optIn: resident.whatsappOptIn,
    })
    .from(resident)
    .where(
      and(
        eq(resident.residenceId, residenceId),
        coOwnersOnly ? eq(resident.kind, "co_owner") : undefined,
        currentResident(todayInAlgiers()),
      ),
    )
    .orderBy(asc(resident.lastName), asc(resident.firstName));
  return rows.map((r) => ({ phone: r.phone, name: fullName(r), optIn: r.optIn }));
}

const residenceName = async (tx: Tx, residenceId: string) =>
  (
    await tx.select({ name: residence.name }).from(residence).where(eq(residence.id, residenceId))
  )[0]?.name ?? "";

/** An announcement was published: every resident who agreed (co-owners and occupants). */
export function notifyAnnouncement(
  tx: Tx,
  scope: TenantScope,
  published: { residenceId: string; title: string; titleAr: string | null },
) {
  return queueWhatsapp(tx, scope, "announcement", async () => {
    const name = await residenceName(tx, published.residenceId);
    return {
      ref: { type: "residence", id: published.residenceId },
      recipients: await residenceAudience(tx, published.residenceId, false),
      params: (language) => [
        name,
        language === "ar" && published.titleAr ? published.titleAr : published.title,
      ],
    };
  });
}

/** A general assembly was convened: its co-owners get the date, the time and the place. */
export function notifyAssemblyConvocation(
  tx: Tx,
  scope: TenantScope,
  assembly: { residenceId: string; heldOn: CalendarDate; startTime: string; place: string },
) {
  return queueWhatsapp(tx, scope, "assembly_convocation", async () => {
    const name = await residenceName(tx, assembly.residenceId);
    return {
      ref: { type: "residence", id: assembly.residenceId },
      recipients: await residenceAudience(tx, assembly.residenceId, true),
      params: (_language, r) => [
        r.name,
        name,
        formatDate(assembly.heldOn),
        assembly.startTime.slice(0, 5),
        assembly.place,
      ],
    };
  });
}
