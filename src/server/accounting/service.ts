import "server-only";

import { and, asc, eq, inArray, isNull, lte, or, gte } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { organizationSetting, rentPayment, treasuryAccount } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  type AccountingCodes,
  accountingCodes,
  counterpartKey,
  defaultTreasuryCodes,
  type TaxSettings,
  taxSettings,
} from "@/lib/accounting";
import { todayInAlgiers, type CalendarDate } from "@/lib/dates";
import type { Centimes } from "@/lib/money";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { ledgerLines } from "@/server/treasury/queries";

import { revenueEntries } from "./revenue";
import type { accountingCodesSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

async function loadCodes(tx: Tx, orgId: string): Promise<AccountingCodes> {
  const [row] = await tx
    .select({ codes: organizationSetting.accountingCodes })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return accountingCodes(row?.codes ?? null);
}

async function loadTax(tx: Tx, orgId: string): Promise<TaxSettings> {
  const [row] = await tx
    .select({ tax: organizationSetting.taxSettings })
    .from(organizationSetting)
    .where(eq(organizationSetting.organizationId, orgId));
  return taxSettings(row?.tax ?? null);
}

/** The chart's codes (saved over the defaults) and the treasury accounts' own codes. */
export async function getAccountingSetup(ctx: TenantCtx) {
  assertCan(ctx, "treasury:update");
  return withTenant(ctx, async (tx) => ({
    codes: await loadCodes(tx, ctx.orgId),
    tax: await loadTax(tx, ctx.orgId),
    accounts: (
      await tx
        .select({
          id: treasuryAccount.id,
          kind: treasuryAccount.kind,
          name: treasuryAccount.name,
          accountingCode: treasuryAccount.accountingCode,
          journalCode: treasuryAccount.journalCode,
          closedOn: treasuryAccount.closedOn,
        })
        .from(treasuryAccount)
        .orderBy(asc(treasuryAccount.kind), asc(treasuryAccount.name))
    ).map((a) => ({
      ...a,
      code: a.accountingCode ?? defaultTreasuryCodes[a.kind].code,
      journal: a.journalCode ?? defaultTreasuryCodes[a.kind].journal,
    })),
  }));
}

/**
 * Gérant, comptable: the chart's codes by flow nature, the accounts' own codes and the tax
 * settings (absent = unchanged). Audited.
 */
export async function saveAccountingCodes(ctx: TenantCtx, input: In<typeof accountingCodesSchema>) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const before = { codes: await loadCodes(tx, ctx.orgId), tax: await loadTax(tx, ctx.orgId) };
    const tax = input.tax ? { taxSettings: input.tax } : {};
    await tx
      .insert(organizationSetting)
      .values({
        organizationId: ctx.orgId,
        accountingCodes: input.codes,
        ...tax,
        updatedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: organizationSetting.organizationId,
        set: { accountingCodes: input.codes, ...tax, updatedBy: ctx.userId, updatedAt: new Date() },
      });
    for (const account of input.accounts) {
      await tx
        .update(treasuryAccount)
        .set({ accountingCode: account.code, journalCode: account.journal, updatedAt: new Date() })
        .where(eq(treasuryAccount.id, account.accountId));
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.accounting_codes",
      entityType: "organization",
      entityId: ctx.orgId,
      before,
      after: {
        codes: accountingCodes(input.codes),
        tax: input.tax ?? before.tax,
        accounts: input.accounts,
      },
    });
  });
}

export type AccountingEntryLine = {
  journal: string;
  on: CalendarDate;
  /** The receipt, slip or movement reference; else the flow's own key. */
  piece: string;
  account: string;
  label: string;
  debit: Centimes;
  credit: Centimes;
};

/**
 * Journal entries of a period for the chartered accountant (`treasury:update`; CLAUDE.md §7
 * Treasury): every flow of every treasury account — collections, outflows, movements — as two
 * balanced lines, the account's own code against the counterpart of its nature (clients,
 * co-owners, tenants, deposits, suppliers, contractors, staff, fees, transfers…). A transfer
 * appears in both accounts' journals through the internal transfers account. Then the revenue
 * entries of sales, rents and charge calls (`revenueEntries`) and the G50 worksheet's figures.
 */
export async function getAccountingEntries(
  ctx: TenantCtx,
  params: { from?: CalendarDate; to?: CalendarDate },
) {
  assertCan(ctx, "treasury:update");
  const to = params.to ?? todayInAlgiers();
  const from = params.from ?? `${to.slice(0, 7)}-01`;
  return withTenant(ctx, async (tx) => {
    const codes = await loadCodes(tx, ctx.orgId);
    const tax = await loadTax(tx, ctx.orgId);
    const accounts = await tx
      .select()
      .from(treasuryAccount)
      .where(
        and(
          lte(treasuryAccount.openingOn, to),
          or(isNull(treasuryAccount.closedOn), gte(treasuryAccount.closedOn, from)),
        ),
      )
      .orderBy(asc(treasuryAccount.kind), asc(treasuryAccount.name));
    const lines: AccountingEntryLine[] = [];
    for (const account of accounts) {
      const start = from < account.openingOn ? account.openingOn : from;
      if (start > to) continue;
      const own = {
        code: account.accountingCode ?? defaultTreasuryCodes[account.kind].code,
        journal: account.journalCode ?? defaultTreasuryCodes[account.kind].journal,
      };
      const flows = await ledgerLines(tx, account.id, start, to);
      // A rent payment may be a deposit: it goes to the deposits received.
      const rentIds = flows
        .filter((f) => f.source === "rent")
        .map((f) => f.key.slice("rent:".length));
      const deposits = new Set(
        rentIds.length === 0
          ? []
          : (
              await tx
                .select({ id: rentPayment.id })
                .from(rentPayment)
                .where(and(inArray(rentPayment.id, rentIds), eq(rentPayment.kind, "deposit")))
            ).map((r) => r.id),
      );
      for (const flow of flows) {
        const incoming = flow.amountIn > 0n;
        const amount = incoming ? flow.amountIn : flow.amountOut;
        if (amount === 0n) continue;
        const counterpart =
          codes[
            counterpartKey(flow.source, {
              deposit: flow.source === "rent" && deposits.has(flow.key.slice("rent:".length)),
              direction: incoming ? "in" : "out",
            })
          ];
        const base = {
          journal: own.journal,
          on: flow.on,
          piece: flow.reference ?? flow.key.split(":")[0] ?? "",
          label: flow.label,
        };
        lines.push(
          {
            ...base,
            account: incoming ? own.code : counterpart,
            debit: amount,
            credit: 0n,
          },
          {
            ...base,
            account: incoming ? counterpart : own.code,
            debit: 0n,
            credit: amount,
          },
        );
      }
    }
    const revenue = await revenueEntries(tx, from, to, codes, tax);
    lines.push(...revenue.lines);
    lines.sort((a, b) =>
      a.journal === b.journal
        ? a.on < b.on
          ? -1
          : a.on > b.on
            ? 1
            : 0
        : a.journal < b.journal
          ? -1
          : 1,
    );
    return {
      from,
      to,
      lines,
      debit: lines.reduce((sum, l) => sum + l.debit, 0n),
      credit: lines.reduce((sum, l) => sum + l.credit, 0n),
      g50: revenue.figures,
    };
  });
}
