import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Tx } from "@/db/client";
import {
  building,
  buyer,
  installment,
  payment,
  project,
  receipt,
  reservation,
  reservationBuyer,
  unit,
} from "@/db/schema";
import type { CertificateSnapshot } from "@/lib/certificates";
import { todayInAlgiers } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { computeStatement } from "@/lib/statement";
import { latestProgress } from "@/server/construction/queries";
import { loadMilestones } from "@/server/payment-plans/queries";
import { saleAnnexes } from "@/server/sales/annexes";

const NO_PENALTIES = { monthlyRateBp: 0, graceDays: 0, capBp: 0 };

/**
 * Everything a certificate prints about a sale, as of now: its buyers, unit, contract,
 * schedule with what is paid (FIFO statement, no penalties), valid payments (imported ones with
 * the previous system's receipt), and the building's progress (`publishedOnly` for the portal).
 */
export async function certificateSnapshot(
  tx: Tx,
  reservationId: string,
  options: { publishedOnly: boolean },
): Promise<{ snapshot: CertificateSnapshot; paid: Centimes; remaining: Centimes } | null> {
  const [row] = await tx
    .select({
      sale: reservation,
      unitCode: unit.code,
      unitType: unit.type,
      unitTypology: unit.typology,
      unitFloor: unit.floor,
      livingArea: unit.livingArea,
      usableArea: unit.usableArea,
      buildingId: unit.buildingId,
      buildingName: building.name,
      projectName: project.name,
      projectAddress: project.address,
      projectCommune: project.commune,
      projectWilaya: project.wilaya,
    })
    .from(reservation)
    .innerJoin(unit, eq(unit.id, reservation.unitId))
    .innerJoin(building, eq(building.id, unit.buildingId))
    .innerJoin(project, eq(project.id, reservation.projectId))
    .where(eq(reservation.id, reservationId));
  if (!row || row.sale.status === "withdrawn") return null;
  const sale = row.sale;

  const buyers = await tx
    .select({
      lastName: buyer.lastName,
      firstName: buyer.firstName,
      lastNameAr: buyer.lastNameAr,
      firstNameAr: buyer.firstNameAr,
      nin: buyer.nin,
      birthDate: buyer.birthDate,
      birthPlace: buyer.birthPlace,
    })
    .from(reservationBuyer)
    .innerJoin(buyer, eq(buyer.id, reservationBuyer.buyerId))
    .where(eq(reservationBuyer.reservationId, sale.id))
    .orderBy(asc(reservationBuyer.position));
  const installments = await tx
    .select({
      position: installment.position,
      label: installment.label,
      amount: installment.amount,
      dueOn: installment.dueOn,
    })
    .from(installment)
    .where(eq(installment.reservationId, sale.id))
    .orderBy(asc(installment.position));
  const payments = await tx
    .select({
      paidOn: payment.paidOn,
      method: payment.method,
      reference: payment.reference,
      bank: payment.bank,
      amount: payment.amount,
      chequeClearedOn: payment.chequeClearedOn,
      receiptNumber: receipt.number,
      legacyReceipt: payment.legacyReceipt,
    })
    .from(payment)
    .leftJoin(receipt, eq(receipt.paymentId, payment.id))
    .where(and(eq(payment.reservationId, sale.id), eq(payment.status, "valid")))
    .orderBy(asc(payment.paidOn), asc(payment.createdAt));
  const paid = payments.reduce((sum, p) => sum + p.amount, 0n);
  const statement = computeStatement(installments, paid, todayInAlgiers(), NO_PENALTIES);
  const progress = (
    await latestProgress(tx, [sale.projectId], { publishedOnly: options.publishedOnly })
  ).get(row.buildingId);
  const milestones = await loadMilestones(tx, sale.projectId);

  const snapshot: CertificateSnapshot = {
    buyers: buyers.map((b) => ({
      name: `${b.lastName} ${b.firstName}`,
      nameAr: [b.lastNameAr, b.firstNameAr].filter(Boolean).join(" ") || null,
      nin: b.nin,
      birthDate: b.birthDate,
      birthPlace: b.birthPlace,
    })),
    sale: {
      number: sale.number,
      reservedOn: sale.reservedOn,
      status: sale.status === "sold" ? "sold" : "reserved",
      price: sale.price.toString(),
      reservationNotary: sale.reservationNotary,
      reservationReference: sale.reservationReference,
      saleNumber: sale.saleNumber,
      saleSignedOn: sale.saleSignedOn,
      saleNotary: sale.saleNotary,
    },
    annexes: ((await saleAnnexes(tx, [sale.id])).get(sale.id) ?? []).map((a) => ({
      code: a.code,
      type: a.type,
    })),
    unit: {
      code: row.unitCode,
      type: row.unitType,
      typology: row.unitTypology,
      floor: row.unitFloor,
      building: row.buildingName,
      livingArea: row.livingArea,
      usableArea: row.usableArea,
    },
    project: {
      name: row.projectName,
      address: row.projectAddress,
      commune: row.projectCommune,
      wilaya: row.projectWilaya,
    },
    totals: {
      paid: statement.paid.toString(),
      remaining: statement.remaining.toString(),
      due: statement.due.toString(),
      overdue: statement.overdue.toString(),
    },
    installments: [...statement.lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        label: line.label,
        dueOn: line.dueOn,
        amount: line.amount.toString(),
        paid: line.paid.toString(),
        remaining: line.remaining.toString(),
        state: line.state,
      })),
    payments: payments.map((p) => ({
      paidOn: p.paidOn,
      method: p.method,
      reference: p.reference,
      bank: p.bank,
      amount: p.amount.toString(),
      receipt: p.receiptNumber ?? p.legacyReceipt,
      pendingCheque: p.method === "cheque" && p.chequeClearedOn === null,
    })),
    progress: {
      percent: progress?.percent ?? null,
      reportedOn: progress?.reportedOn ?? null,
      milestones: milestones.map((m) => ({
        name: m.name,
        plannedOn: m.plannedOn,
        validatedOn: m.validatedOn,
      })),
    },
  };
  return { snapshot, paid: statement.paid, remaining: statement.remaining };
}
