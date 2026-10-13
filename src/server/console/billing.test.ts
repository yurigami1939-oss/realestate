import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import {
  consoleAuditLog,
  consolePayment,
  invoice,
  invoiceLine,
  subscription,
  tenantEntitlement,
  tenantUsage,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { getTenantInvoices, tenantInvoiceFile } from "@/server/entitlements/invoices";
import { getObjectBytes } from "@/server/files/storage";

import {
  createTestPlan,
  ensureCatalogAddons,
  openTestAccount,
} from "../../../tests/console-fixtures";
import { createOrganization } from "../../../tests/factories";

import {
  cancelConsolePayment,
  draftInvoice,
  type DraftLine,
  getBillingOverview,
  issueCreditNote,
  issueInvoice,
  recordConsolePayment,
  saveOperatorProfile,
} from "./billing";
import {
  consoleDocumentHtml,
  loadConsoleDocument,
  renderConsoleDocument,
} from "./billing-documents";
import { systemOperator } from "./context";
import { runConsoleDaily } from "./lifecycle";

const today = todayInAlgiers();

const profile = {
  legalName: "Sayroura SARL",
  brand: "Sayroura",
  legalForm: "SARL",
  address: "12 rue Didouche Mourad",
  wilaya: "16 - Alger",
  phone: "023 00 00 00",
  email: "factures@sayroura.test",
  rcNumber: "16/00-1234567B26",
  nif: "002616123456789",
  nis: "0026160123456",
  aiNumber: "16012345678",
  bank: "BNA Agence Didouche",
  rib: "001 00123 0300000012 34",
  vatRegime: "vat" as const,
  vatRateBp: 1900,
  paymentTermsDays: 15,
  footerFr: "Merci de rappeler le numéro de facture sur votre virement.",
  footerAr: "يرجى ذكر رقم الفاتورة في التحويل.",
};

beforeAll(async () => {
  await ensureCatalogAddons();
  await saveOperatorProfile(systemOperator, profile);
});

afterAll(async () => {
  await stopEnqueue();
});

/** A snapshot of an organization's usage on a day. */
const measured = (organizationId: string, measuredOn: string, managedLots: number) =>
  consoleDb.insert(tenantUsage).values({
    organizationId,
    measuredOn,
    projects: 1,
    units: 0,
    activeUnits: 0,
    managedLots,
    staffMembers: 1,
    portalAccounts: 0,
    storageBytes: 0,
    receipts30d: 0,
    reminders30d: 0,
    activeMembers30d: 0,
    leads30d: 0,
  });

/** An active client account of one or two SARLs on a fresh plan. */
async function account(values: Record<string, unknown> = {}, organizations = 1) {
  const orgs = [];
  for (let i = 0; i < organizations; i += 1) {
    orgs.push(await createOrganization({}, { entitle: false }));
  }
  const planCode = await createTestPlan({ setupFee: "250000" });
  const opened = await openTestAccount(
    orgs.map((o) => o.id),
    { planCode, ...values },
  );
  return { ...opened, orgs };
}

/** A one-line invoice of `amount` (HT) issued on `issuedOn`. */
const oneLine = (amount: bigint): DraftLine[] => [
  {
    kind: "other",
    addonCode: null,
    labelFr: "Formation",
    labelAr: "تكوين",
    periodStart: null,
    periodEnd: null,
    quantity: 1,
    unitPrice: amount,
  },
];

describe("operator invoices (CLAUDE.console.md §11)", () => {
  it("prefills the period's lines, issues them numbered with both snapshots, then the next period", async () => {
    const { billingAccountId, subscriptionId, orgs } = await account(
      {
        price: "800000",
        currentPeriodStart: "2025-01-01",
        currentPeriodEnd: "2025-12-31",
        addons: [
          { code: "syndic", price: "300" },
          { code: "rentals", price: "90000" },
        ],
      },
      2,
    );
    const [a, b] = orgs;
    if (!a || !b) throw new Error("organizations missing");
    await consoleDb
      .update(subscription)
      .set({ discountBp: 1000 })
      .where(eq(subscription.id, subscriptionId));
    // Managed lots now: 40 + 20.
    await measured(a.id, today, 40);
    await measured(b.id, today, 20);

    const first = await draftInvoice(systemOperator, billingAccountId);
    expect(first.period).toEqual({ start: "2025-01-01", end: "2025-12-31" });
    expect(
      first.lines.map((l) => [l.kind, l.addonCode, l.quantity, l.unitPrice, l.periodStart]),
    ).toEqual([
      ["subscription", null, 1, 720_000_00n, "2025-01-01"],
      ["addon", "syndic", 720, 300_00n, "2025-01-01"],
      ["addon", "rentals", 1, 90_000_00n, "2025-01-01"],
      ["setup", null, 1, 250_000_00n, null],
    ]);
    expect(first.lines[0]?.labelFr).toContain("remise 10 %");
    expect(first.lines[1]?.labelFr).toContain("60 lots × 12 mois");

    const { invoiceId, number } = await issueInvoice(systemOperator, {
      billingAccountId,
      issuedOn: today,
      lines: first.lines,
    });
    expect(number).toMatch(new RegExp(`^FAC-${today.slice(0, 4)}-\\d{6}$`));
    const [issued] = await consoleDb.select().from(invoice).where(eq(invoice.id, invoiceId));
    // 720 000 + 90 000 + 216 000 + 250 000 = 1 276 000 DA HT, VAT 19 %.
    expect(issued).toMatchObject({
      dueOn: addDays(today, 15),
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
      vatRateBp: 1900,
      totalHt: 1_276_000_00n,
      totalVat: 242_440_00n,
      totalTtc: 1_518_440_00n,
      seller: { legalName: "Sayroura SARL", rib: profile.rib },
      buyer: { legalName: expect.any(String) },
    });
    const audit = await consoleDb
      .select({ action: consoleAuditLog.action })
      .from(consoleAuditLog)
      .where(eq(consoleAuditLog.billingAccountId, billingAccountId));
    expect(audit.map((r) => r.action)).toContain("invoice.issue");

    // The period invoiced was the current one: nothing moves. The lots of last year averaged
    // 70 (60 then 80 from July) while 60 were billed: the next invoice trues it up.
    for (let month = 1; month <= 12; month += 1) {
      const day = `2025-${String(month).padStart(2, "0")}-15`;
      await measured(a.id, day, month <= 6 ? 40 : 60);
      await measured(b.id, day, 20);
    }
    const next = await draftInvoice(systemOperator, billingAccountId);
    expect(next.period).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(next.lines.map((l) => [l.kind, l.quantity, l.unitPrice])).toEqual([
      ["subscription", 1, 720_000_00n],
      ["addon", 720, 300_00n],
      ["adjustment", 120, 300_00n],
      ["addon", 1, 90_000_00n],
    ]);
    // Invoiced up to last year: a period to invoice on the overview, until the next is issued.
    expect((await getBillingOverview(today)).toInvoice.map((a) => a.id)).toContain(
      billingAccountId,
    );
    await issueInvoice(systemOperator, { billingAccountId, issuedOn: today, lines: next.lines });
    // The subscription and its organizations now run on the period invoiced.
    const [moved] = await consoleDb
      .select({ start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd })
      .from(subscription)
      .where(eq(subscription.id, subscriptionId));
    expect(moved).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    const [entitled] = await withTenant({ orgId: a.id }, (tx) =>
      tx
        .select({ end: tenantEntitlement.currentPeriodEnd })
        .from(tenantEntitlement)
        .where(eq(tenantEntitlement.organizationId, a.id)),
    );
    expect(entitled?.end).toBe("2026-12-31");
  });

  it("refuses to invoice a pilot, a future day or nothing", async () => {
    const pilot = await account({ status: "pilot" });
    await expect(draftInvoice(systemOperator, pilot.billingAccountId)).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "console.errors.invoicePilot",
    });
    const active = await account();
    await expect(
      issueInvoice(systemOperator, {
        billingAccountId: active.billingAccountId,
        issuedOn: addDays(today, 1),
        lines: oneLine(100_00n),
      }),
    ).rejects.toMatchObject({ messageKey: "console.errors.futureDate" });
    await expect(
      issueInvoice(systemOperator, {
        billingAccountId: active.billingAccountId,
        issuedOn: today,
        lines: oneLine(0n),
      }),
    ).rejects.toMatchObject({ messageKey: "console.errors.invoiceEmpty" });
  });

  it("takes payments and credit notes up to what remains; overdue → past due → active again", async () => {
    const { billingAccountId, orgs } = await account();
    const org = orgs[0];
    if (!org) throw new Error("organization missing");
    // Issued 30 days ago, due 15 days ago: overdue.
    const { invoiceId } = await issueInvoice(systemOperator, {
      billingAccountId,
      issuedOn: addDays(today, -30),
      lines: oneLine(1_000_00n),
    });
    await runConsoleDaily(today);
    // Unpaid beyond its grace (none here): a suspension to decide on the console.
    await consoleDb
      .update(subscription)
      .set({ graceDays: 0 })
      .where(eq(subscription.billingAccountId, billingAccountId));
    const overview = await getBillingOverview(today);
    expect(overview.invoicesBeyondGrace.map((a) => a.id)).toContain(billingAccountId);
    const status = async () =>
      (
        await consoleDb
          .select({ status: subscription.status })
          .from(subscription)
          .where(eq(subscription.billingAccountId, billingAccountId))
      )[0]?.status;
    expect(await status()).toBe("past_due");

    // TTC 1 190,00: never more than what remains, never before the invoice.
    await expect(
      recordConsolePayment(systemOperator, {
        invoiceId,
        paidOn: today,
        amount: 1_190_01n,
        method: "bank_transfer",
        reference: null,
      }),
    ).rejects.toMatchObject({ messageKey: "console.errors.aboveRemaining" });
    await expect(
      recordConsolePayment(systemOperator, {
        invoiceId,
        paidOn: addDays(today, -31),
        amount: 100_00n,
        method: "cheque",
        reference: null,
      }),
    ).rejects.toMatchObject({ messageKey: "console.errors.paidOn" });
    const { paymentId } = await recordConsolePayment(systemOperator, {
      invoiceId,
      paidOn: today,
      amount: 1_071_00n,
      method: "cheque",
      reference: "CHQ 4411",
    });
    expect(await status()).toBe("past_due"); // 119,00 still due

    // The rest credited, split at the invoice's rate: the account is settled.
    await expect(
      issueCreditNote(systemOperator, {
        invoiceId,
        amount: 119_01n,
        reason: "Geste commercial",
        issuedOn: today,
      }),
    ).rejects.toMatchObject({ messageKey: "console.errors.aboveRemaining" });
    const { number } = await issueCreditNote(systemOperator, {
      invoiceId,
      amount: 119_00n,
      reason: "Geste commercial",
      issuedOn: today,
    });
    expect(number).toMatch(/^AVO-/);
    expect(await status()).toBe("active");
    const ctx: TenantCtx = { userId: "", orgId: org.id, roles: ["owner"], locale: "fr" };
    const { invoices, payTo } = await getTenantInvoices(ctx);
    expect(invoices).toMatchObject([
      {
        id: invoiceId,
        totalTtc: 1_190_00n,
        paid: 1_071_00n,
        credited: 119_00n,
        remaining: 0n,
        state: "paid",
        creditNotes: [{ number, amountTtc: 119_00n }],
      },
    ]);
    expect(payTo).toEqual({ legalName: "Sayroura SARL", bank: profile.bank, rib: profile.rib });

    // A bounced cheque: cancelled with its reason, once; the invoice is due again.
    await cancelConsolePayment(systemOperator, { paymentId, reason: "Chèque impayé" });
    await expect(
      cancelConsolePayment(systemOperator, { paymentId, reason: "Encore" }),
    ).rejects.toMatchObject({ messageKey: "console.errors.paymentCancelled" });
    const after = await getTenantInvoices(ctx);
    expect(after.invoices[0]).toMatchObject({ remaining: 1_071_00n, state: "overdue" });
  });

  it("keeps invoices and payments immutable, and each account's invoices to its organizations", async () => {
    const mine = await account();
    const other = await account();
    const { invoiceId } = await issueInvoice(systemOperator, {
      billingAccountId: mine.billingAccountId,
      issuedOn: today,
      lines: oneLine(500_00n),
    });
    await expect(
      consoleDb.update(invoice).set({ totalHt: 1n }).where(eq(invoice.id, invoiceId)),
    ).rejects.toThrow();
    await expect(consoleDb.delete(invoice).where(eq(invoice.id, invoiceId))).rejects.toThrow();
    await expect(
      consoleDb
        .update(invoiceLine)
        .set({ quantity: 2 })
        .where(eq(invoiceLine.invoiceId, invoiceId)),
    ).rejects.toThrow();
    const { paymentId } = await recordConsolePayment(systemOperator, {
      invoiceId,
      paidOn: today,
      amount: 100_00n,
      method: "ccp",
      reference: null,
    });
    await expect(
      consoleDb.update(consolePayment).set({ amount: 1n }).where(eq(consolePayment.id, paymentId)),
    ).rejects.toThrow();

    const otherOrg = other.orgs[0];
    const mineOrg = mine.orgs[0];
    if (!otherOrg || !mineOrg) throw new Error("organizations missing");
    const ctxOf = (orgId: string): TenantCtx => ({
      userId: "",
      orgId,
      roles: ["owner"],
      locale: "fr",
    });
    expect((await getTenantInvoices(ctxOf(otherOrg.id))).invoices).toEqual([]);
    expect(await tenantInvoiceFile(ctxOf(otherOrg.id), invoiceId)).toBeNull();
    // A commercial does not read the subscription.
    await expect(
      getTenantInvoices({ ...ctxOf(mineOrg.id), roles: ["sales_agent"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The app never reads the console's invoices itself.
    await expect(db.select().from(invoice)).rejects.toThrow();
    const { rows } = await db.execute<{ data: unknown[] }>(
      sql`select console.tenant_invoices() as data`,
    );
    expect(rows[0]?.data).toEqual([]);
  });

  it("renders an invoice once, bilingual with its amount in words, and serves it to its account", async () => {
    const { billingAccountId, orgs } = await account();
    const org = orgs[0];
    if (!org) throw new Error("organization missing");
    const { invoiceId, number } = await issueInvoice(systemOperator, {
      billingAccountId,
      issuedOn: today,
      lines: oneLine(1_000_000_00n),
    });
    const loaded = await loadConsoleDocument("invoice", invoiceId);
    if (!loaded) throw new Error("invoice missing");
    const html = consoleDocumentHtml(loaded.data);
    expect(html).toContain("FACTURE");
    expect(html).toContain("فاتورة");
    expect(html).toContain("TVA 19 %");
    // 1 190 000 DA TTC in words, French and Arabic.
    expect(html).toContain("un million cent quatre-vingt-dix mille dinars");
    expect(html).toContain("أوقفت هذه الفاتورة على مبلغ");
    expect(html).toContain(profile.rib);

    expect(await renderConsoleDocument("invoice", invoiceId)).toBe("rendered");
    expect(await renderConsoleDocument("invoice", invoiceId)).toBe("skipped");
    const ctx: TenantCtx = { userId: "", orgId: org.id, roles: ["accountant"], locale: "fr" };
    const file = await tenantInvoiceFile(ctx, invoiceId);
    expect(file).toEqual({
      storageKey: `console/invoices/${billingAccountId}/${invoiceId}.pdf`,
      fileName: `${number}.pdf`,
    });
    const bytes = await getObjectBytes(file?.storageKey ?? "");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("prints no VAT under the no-VAT regime", async () => {
    await saveOperatorProfile(systemOperator, { ...profile, vatRegime: "none" });
    try {
      const { billingAccountId } = await account();
      const { invoiceId } = await issueInvoice(systemOperator, {
        billingAccountId,
        issuedOn: today,
        lines: oneLine(1_000_00n),
      });
      const [row] = await consoleDb
        .select({ vat: invoice.vatRateBp, ttc: invoice.totalTtc })
        .from(invoice)
        .where(and(eq(invoice.id, invoiceId)));
      expect(row).toEqual({ vat: null, ttc: 1_000_00n });
      const loaded = await loadConsoleDocument("invoice", invoiceId);
      expect(consoleDocumentHtml(loaded?.data ?? never())).toContain("TVA non applicable");
    } finally {
      await saveOperatorProfile(systemOperator, profile);
    }
  });
});

function never(): never {
  throw new Error("document missing");
}
