import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import {
  auditLog,
  eSignature,
  portalLink,
  scheduleAmendment,
  signatureCode,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { storeFile } from "@/server/files/service";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import type { PortalCtx } from "@/server/portal/context";
import { rescheduleSale } from "@/server/sales/amendments";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema, rescheduleSaleSchema } from "@/server/sales/schemas";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { listMySignatures, listSignatures } from "./queries";
import { requestSignatureCodeSchema, signDocumentSchema } from "./schemas";
import { requestSignatureCode, signDocument } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const PDF = Buffer.from("%PDF-1.4\n% avenant\n%%EOF\n");
const client = { ip: "105.235.1.2", userAgent: "Mozilla/5.0 (Linux; Android 14)" };

/** A portal account linked to a buyer file (as an accepted invitation leaves it). */
async function portalAccount(orgId: string, buyerId: string | null): Promise<PortalCtx> {
  const account = await addMember(orgId, ["resident"]);
  if (buyerId) {
    await withTenant({ orgId }, (tx) =>
      tx.insert(portalLink).values({
        organizationId: orgId,
        email: `client-${randomUUID().slice(0, 8)}@example.test`,
        userId: account.userId,
        buyerId,
      }),
    );
  }
  return { userId: account.userId, orgId, name: "Karim Bensalem", locale: "fr" };
}

/** The last code e-mailed to an account (read from the queued e-mail). */
async function lastCode(userId: string) {
  const [account] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  const { rows } = await db.execute<{ text: string; subject: string }>(sql`
    select data->>'text' as text, data->>'subject' as subject from pgboss.job
    where name = 'email.send' and data->>'to' = ${account?.email ?? ""}
    order by created_on desc limit 1
  `);
  expect(rows[0]?.subject).toContain("Votre code de signature");
  // The code stands on its own line (the document's number has digits too).
  return /^(\d{6})$/m.exec(rows[0]?.text ?? "")?.[1] ?? "";
}

describe("electronic signature", () => {
  it("signs an avenant from the portal with a code e-mailed to the account", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: "",
      }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -60),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordPayment(
      cashier,
      recordPaymentSchema.parse({
        reservationId: saleId,
        amount: "2 602 000",
        method: "bank_transfer",
        paidOn: today,
        reference: "",
        payerName: "Bensalem Karim",
      }),
    );
    const avenant = async (count: number, amount: string) => {
      await rescheduleSale(
        team.manager,
        rescheduleSaleSchema.parse({
          reservationId: saleId,
          signedOn: today,
          reason: "Report demandé par l'acquéreur",
          lines: Array.from({ length: count }, (_, i) => ({
            label: `Mensualité ${i + 1}/${count}`,
            amount,
            dueOn: addMonths(addDays(today, 30), i),
            milestoneId: "",
          })),
        }),
      );
      const [row] = await withTenant(team.owner, (tx) =>
        tx
          .select({ id: scheduleAmendment.id })
          .from(scheduleAmendment)
          .where(eq(scheduleAmendment.reservationId, saleId))
          .orderBy(sql`${scheduleAmendment.sequence} desc`)
          .limit(1),
      );
      return row?.id ?? "";
    };
    const first = await avenant(4, "2 602 000");
    const doc = (documentId: string) =>
      requestSignatureCodeSchema.parse({ documentType: "schedule_amendment", documentId });
    const signing = (documentId: string, code: string) =>
      signDocumentSchema.parse({ documentType: "schedule_amendment", documentId, code });

    const buyer = await portalAccount(team.orgId, buyerId);
    const stranger = await portalAccount(team.orgId, null);

    // Not before its PDF; never someone else's document.
    await expect(requestSignatureCode(buyer, doc(first))).rejects.toMatchObject({
      messageKey: "signatures.errors.noPdf",
    });
    const stored = await withTenant(team.owner, async (tx) => {
      const file = await storeFile(
        tx,
        { orgId: team.orgId, userId: null },
        {
          entityType: "reservation",
          entityId: saleId,
          upload: { fileName: "avenant.pdf", bytes: new Uint8Array(PDF) },
          contentType: "application/pdf",
        },
      );
      await tx
        .update(scheduleAmendment)
        .set({ pdfFileId: file.id })
        .where(eq(scheduleAmendment.id, first));
      return file;
    });
    await expect(requestSignatureCode(stranger, doc(first))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // A code e-mailed to the account; a wrong one counts as a try.
    const sent = await requestSignatureCode(buyer, doc(first));
    expect(sent.email).toMatch(/^u•••@example\.test$/);
    const code = await lastCode(buyer.userId);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(signDocument(buyer, signing(first, wrong), client)).rejects.toMatchObject({
      messageKey: "signatures.errors.wrongCode",
    });
    const [challenge] = await withTenant(team.owner, (tx) =>
      tx.select().from(signatureCode).where(eq(signatureCode.documentId, first)),
    );
    expect(challenge?.attempts).toBe(1);
    expect(challenge?.codeHash).not.toContain(code);
    expect(() => signing(first, "12345")).toThrow();

    // Signed: the PDF's fingerprint, the address, the browser; never twice.
    const signature = await signDocument(buyer, signing(first, code), client);
    expect(signature.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    await expect(signDocument(buyer, signing(first, code), client)).rejects.toMatchObject({
      messageKey: "signatures.errors.alreadySigned",
    });
    await expect(requestSignatureCode(buyer, doc(first))).rejects.toMatchObject({
      messageKey: "signatures.errors.alreadySigned",
    });
    expect((await listMySignatures(buyer, "schedule_amendment", [first])).has(first)).toBe(true);
    const staff = await listSignatures(cashier, "schedule_amendment", [first]);
    expect(staff.get(first)).toEqual([
      expect.objectContaining({
        signerName: expect.stringMatching(/^User /),
        documentSha256: signature.sha256,
        ipAddress: "105.235.1.2",
      }),
    ]);
    await expect(listSignatures(team.agentB, "lease_inspection", [first])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [row] = await withTenant(team.owner, (tx) =>
      tx.select().from(eSignature).where(eq(eSignature.documentId, first)),
    );
    expect(row).toMatchObject({ fileId: stored.id, userAgent: client.userAgent });
    // Append-only: the proof cannot be changed.
    await expect(
      withTenant(team.owner, (tx) =>
        tx
          .update(eSignature)
          .set({ signerName: "x" })
          .where(eq(eSignature.id, row?.id ?? "")),
      ),
    ).rejects.toThrow();

    // A second avenant: an expired code, then a code locked after too many tries.
    const second = await avenant(2, "5 204 000");
    await withTenant(team.owner, async (tx) => {
      const file = await storeFile(
        tx,
        { orgId: team.orgId, userId: null },
        {
          entityType: "reservation",
          entityId: saleId,
          upload: { fileName: "avenant-2.pdf", bytes: new Uint8Array(PDF) },
          contentType: "application/pdf",
        },
      );
      await tx
        .update(scheduleAmendment)
        .set({ pdfFileId: file.id })
        .where(eq(scheduleAmendment.id, second));
    });
    await requestSignatureCode(buyer, doc(second));
    const expired = await lastCode(buyer.userId);
    await withTenant(team.owner, (tx) =>
      tx
        .update(signatureCode)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(and(eq(signatureCode.userId, buyer.userId), eq(signatureCode.documentId, second))),
    );
    await expect(signDocument(buyer, signing(second, expired), client)).rejects.toMatchObject({
      messageKey: "signatures.errors.codeExpired",
    });
    await requestSignatureCode(buyer, doc(second));
    const fresh = await lastCode(buyer.userId);
    const miss = fresh === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await expect(signDocument(buyer, signing(second, miss), client)).rejects.toMatchObject({
        messageKey: "signatures.errors.wrongCode",
      });
    }
    await expect(signDocument(buyer, signing(second, fresh), client)).rejects.toMatchObject({
      messageKey: "signatures.errors.codeLocked",
    });

    const audits = await withTenant(team.owner, (tx) => tx.select().from(auditLog));
    expect(audits.filter((a) => a.action === "e_signature.sign")).toEqual([
      expect.objectContaining({ entityType: "reservation", entityId: saleId }),
    ]);
  });
});
