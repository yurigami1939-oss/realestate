/**
 * Demo portal (module 7): the demo resident account (Mohamed Cherif) is a buyer — his own
 * reservation of B-02-02 in Les Oliviers, with everything due already paid — and the co-owner
 * of Y-01-01 in « Résidence El Yasmine ». Both records are linked to the account, as accepting
 * an invitation would have done (the account already exists, so no e-mail is sent).
 */
import { eq } from "drizzle-orm";

import { resident } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { inviteToPortal } from "@/server/portal/invitations";
import { createReservation } from "@/server/sales/reservations";
import { getSale } from "@/server/sales/sale-queries";
import { createReservationSchema } from "@/server/sales/schemas";

import { demoUsers } from "./demo";

type Actors = {
  /** The directeur commercial (buyer files, sales). */
  salesManager: TenantCtx;
  /** The gestionnaire (co-owners). */
  propertyManager: TenantCtx;
  cashier: TenantCtx;
};

const need = (map: Map<string, string>, key: string) => {
  const value = map.get(key);
  if (!value) throw new Error(`seed: ${key} missing`);
  return value;
};

export async function seedPortal(
  { salesManager, propertyManager, cashier }: Actors,
  ids: { units: Map<string, string>; plans: Map<string, string> },
) {
  const account = demoUsers.find((u) => u.key === "resident");
  if (!account) throw new Error("seed: demo resident missing");
  const today = todayInAlgiers();

  const { id: buyerId } = await createBuyer(
    salesManager,
    createBuyerSchema.parse({
      civility: "mr",
      lastName: "Cherif",
      firstName: "Mohamed",
      lastNameAr: "شريف",
      firstNameAr: "محمد",
      phone: "0661 50 12 34",
      email: account.email,
      address: "Lotissement El Yasmine, lot 7",
      commune: "Chéraga",
      wilaya: "16 - Alger",
      leadId: "",
    }),
  );
  const { id: saleId } = await createReservation(
    salesManager,
    createReservationSchema.parse({
      unitId: need(ids.units, "B-02-02"),
      buyerIds: [buyerId],
      paymentPlanId: need(ids.plans, "OLIV"),
      discount: "",
      reservedOn: addDays(today, -20),
      notary: "Maître Hamidi Fatiha",
      reference: "",
      notes: "",
    }),
  );
  const sale = await getSale(salesManager, saleId);
  if (!sale) throw new Error("seed: portal sale missing");
  // Everything due so far is paid: the demo keeps a single overdue sale.
  if (sale.statement.due > 0n) {
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: toDecimalString(sale.statement.due).replace(".", ","),
        method: "bank_transfer",
        paidOn: addDays(today, -18),
        reference: "VIR-20931",
        payerName: "Cherif Mohamed",
      }),
    );
  }
  await inviteToPortal(salesManager, { kind: "buyer", id: buyerId });

  const [coOwner] = await withTenant(propertyManager, (tx) =>
    tx.select({ id: resident.id }).from(resident).where(eq(resident.email, account.email)),
  );
  if (!coOwner) throw new Error("seed: demo co-owner missing");
  await inviteToPortal(propertyManager, { kind: "resident", id: coOwner.id });
}
