/**
 * A management mandate (CLAUDE.md §7 Rentals): Leila Zerrouki, co-owner of M-01-02 in the third
 * party's « Immeuble Les Mimosas », has the company let her flat (fees 8 %). Its tenant paid
 * three months; the first two were reported on a statement paid out by transfer, the third
 * waits for the next one.
 */
import { and, eq } from "drizzle-orm";

import { project, unit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import {
  createMandateSchema,
  createOwnerSchema,
  issueOwnerStatementSchema,
  payOwnerStatementSchema,
} from "@/server/mandates/schemas";
import { createMandate, createOwner } from "@/server/mandates/service";
import { issueOwnerStatement, payOwnerStatement } from "@/server/mandates/statements";
import { createLeaseSchema, recordRentPaymentSchema } from "@/server/rentals/schemas";
import { createLease, recordRentPayment } from "@/server/rentals/service";

export const MANDATE_OWNER = "Zerrouki Leila";

export async function seedMandates(actors: { manager: TenantCtx; cashier: TenantCtx }) {
  const { manager, cashier } = actors;
  const today = todayInAlgiers();
  const [flat] = await withTenant(manager, (tx) =>
    tx
      .select({ id: unit.id })
      .from(unit)
      .innerJoin(project, eq(project.id, unit.projectId))
      .where(and(eq(project.code, "MIMO"), eq(unit.code, "M-01-02"))),
  );
  if (!flat) throw new Error("seed: M-01-02 missing");

  const { id: ownerId } = await createOwner(
    manager,
    createOwnerSchema.parse({
      name: MANDATE_OWNER,
      nameAr: "زروقي ليلى",
      phone: "0698 72 05 14",
      email: "",
      address: "Cité 300 logements, Bab Ezzouar",
      bank: "BEA",
      rib: "00200012345678901234",
      notes: "Vit à Oran ; reversement mensuel par virement.",
    }),
  );
  const startOn = addDays(today, -95);
  await createMandate(
    manager,
    createMandateSchema.parse({
      ownerId,
      unitId: flat.id,
      signedOn: addDays(startOn, -10),
      startOn,
      feeRate: "8",
      notes: "Mandat de gestion locative d'un an, renouvelable.",
    }),
  );
  const { id: leaseId } = await createLease(
    manager,
    createLeaseSchema.parse({
      unitId: flat.id,
      kind: "residential",
      tenantName: "Benali Karim",
      tenantPhone: "0555 40 12 77",
      signedOn: addDays(startOn, -3),
      startOn,
      durationMonths: "12",
      monthlyRent: "35 000",
      frequency: "monthly",
      deposit: "",
      notes: "",
    }),
  );
  for (let month = 0; month < 3; month += 1) {
    await recordRentPayment(
      cashier,
      recordRentPaymentSchema.parse({
        leaseId,
        kind: "rent",
        amount: "35 000",
        method: "bank_transfer",
        reference: `VIR-BENALI-${month + 1}`,
        paidOn: addDays(addMonths(startOn, month), 2),
        payerName: "Benali Karim",
      }),
    );
  }
  // The first two months reported and paid out; the third waits for the next statement.
  const statement = await issueOwnerStatement(
    manager,
    issueOwnerStatementSchema.parse({
      ownerId,
      periodTo: addDays(addMonths(startOn, 1), 5),
      extras: [{ label: "Remplacement du chauffe-eau (facture Électro-Bab)", amount: "12 000" }],
    }),
  );
  await payOwnerStatement(
    manager,
    payOwnerStatementSchema.parse({
      statementId: statement.id,
      paidOn: today,
      method: "bank_transfer",
      reference: "VIR-ZERROUKI-1",
    }),
  );
}
