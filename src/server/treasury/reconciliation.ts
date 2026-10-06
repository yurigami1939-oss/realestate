import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  bankMatch,
  bankStatement,
  bankStatementLine,
  chequeDeposit,
  chequeDepositItem,
  treasuryAccount,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import type { Centimes } from "@/lib/money";
import { type MatchSuggestion, suggestMatches } from "@/lib/reconciliation";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { balanceOn } from "./balances";
import { type LedgerLine, ledgerLines } from "./queries";
import type {
  applySuggestionsSchema,
  bookStatementLineSchema,
  deleteStatementSchema,
  dismissStatementLineSchema,
  LedgerParams,
  matchStatementLineSchema,
  statementLineSchema,
} from "./schemas";
import { recordMovement } from "./service";

type In<S extends z.ZodType> = z.output<S>;

/** Days around the period whose entries may match its lines (a cheque credited weeks later). */
const WINDOW_DAYS = 45;
/** How far back an entry may be matched with a line. */
const MATCH_BACK_DAYS = 400;

const signed = (entry: LedgerLine): Centimes => entry.amountIn - entry.amountOut;

async function loadBankAccount(tx: Tx, accountId: string) {
  if (!isUuid(accountId)) throw new AppError("NOT_FOUND");
  const [account] = await tx
    .select()
    .from(treasuryAccount)
    .where(eq(treasuryAccount.id, accountId));
  if (!account) throw new AppError("NOT_FOUND");
  if (account.kind === "cash") throw new AppError("VALIDATION", "treasury.errors.statementCash");
  return account;
}

/** The account's entries between two days, bounded by its opening and today. */
async function entriesBetween(
  tx: Tx,
  account: { id: string; openingOn: CalendarDate },
  from: CalendarDate,
  to: CalendarDate,
) {
  const today = todayInAlgiers();
  const start = from < account.openingOn ? account.openingOn : from;
  const end = to > today ? today : to;
  return start > end ? [] : ledgerLines(tx, account.id, start, end);
}

/** Every matched entry key of the account (an entry is matched once). */
async function matchedKeys(tx: Tx, accountId: string) {
  const rows = await tx
    .select({ key: bankMatch.entryKey, lineId: bankMatch.lineId })
    .from(bankMatch)
    .where(eq(bankMatch.accountId, accountId));
  return new Map(rows.map((r) => [r.key, r.lineId]));
}

/** Deposit slips of the account with their cheques' entry keys (`sale:<id>`…). */
async function slipsOf(tx: Tx, accountId: string, from: CalendarDate, to: CalendarDate) {
  const items = await tx
    .select({
      number: chequeDeposit.number,
      depositedOn: chequeDeposit.depositedOn,
      source: chequeDepositItem.source,
      paymentId: chequeDepositItem.paymentId,
      amount: chequeDepositItem.amount,
    })
    .from(chequeDeposit)
    .innerJoin(chequeDepositItem, eq(chequeDepositItem.depositId, chequeDeposit.id))
    .where(
      and(
        eq(chequeDeposit.accountId, accountId),
        gte(chequeDeposit.depositedOn, from),
        lte(chequeDeposit.depositedOn, to),
      ),
    );
  const slips = new Map<
    string,
    { number: string; depositedOn: CalendarDate; keys: string[]; amount: Centimes }
  >();
  for (const item of items) {
    const slip = slips.get(item.number) ?? {
      number: item.number,
      depositedOn: item.depositedOn,
      keys: [],
      amount: 0n,
    };
    slip.keys.push(`${item.source}:${item.paymentId}`);
    slip.amount += item.amount;
    slips.set(item.number, slip);
  }
  return [...slips.values()];
}

/**
 * The reconciliation of a bank or CCP account over a period (`treasury:read`): its statement
 * lines (matched, set aside or open, with a suggestion when one is likely), the entries of the
 * ledger not matched yet, the imported statements and the totals.
 */
export async function getReconciliation(ctx: TenantCtx, accountId: string, params: LedgerParams) {
  assertCan(ctx, "treasury:read");
  if (!isUuid(accountId)) return null;
  const today = todayInAlgiers();
  const to = params.to ?? today;
  const from = params.from ?? `${to.slice(0, 7)}-01`;
  return withTenant(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(treasuryAccount)
      .where(eq(treasuryAccount.id, accountId));
    if (!account || account.kind === "cash") return null;

    const lines = await tx
      .select({
        id: bankStatementLine.id,
        bookedOn: bankStatementLine.bookedOn,
        label: bankStatementLine.label,
        reference: bankStatementLine.reference,
        amount: bankStatementLine.amount,
        dismissedAt: bankStatementLine.dismissedAt,
        dismissalReason: bankStatementLine.dismissalReason,
      })
      .from(bankStatementLine)
      .where(
        and(
          eq(bankStatementLine.accountId, account.id),
          gte(bankStatementLine.bookedOn, from),
          lte(bankStatementLine.bookedOn, to),
        ),
      )
      .orderBy(asc(bankStatementLine.bookedOn), asc(bankStatementLine.createdAt));
    const matches =
      lines.length === 0
        ? []
        : await tx
            .select({ lineId: bankMatch.lineId, key: bankMatch.entryKey, amount: bankMatch.amount })
            .from(bankMatch)
            .where(
              inArray(
                bankMatch.lineId,
                lines.map((l) => l.id),
              ),
            );
    const matched = await matchedKeys(tx, account.id);
    const window = await entriesBetween(
      tx,
      account,
      addDays(from, -WINDOW_DAYS),
      addDays(to, WINDOW_DAYS),
    );
    const byKey = new Map(window.map((e) => [e.key, e]));
    const open = window.filter((e) => !matched.has(e.key));
    const slips = await slipsOf(tx, account.id, addDays(from, -WINDOW_DAYS), to);

    const openLines = lines.filter(
      (l) => l.dismissedAt === null && !matches.some((m) => m.lineId === l.id),
    );
    const suggestions = suggestMatches(
      openLines,
      open.map((e) => ({ key: e.key, on: e.on, amount: signed(e) })),
      slips,
    );
    const entryView = (key: string, amount: Centimes) => {
      const entry = byKey.get(key);
      return {
        key,
        on: entry?.on ?? null,
        label: entry?.label ?? key,
        reference: entry?.reference ?? null,
        amount,
      };
    };
    const view = lines.map((line) => {
      const own = matches.filter((m) => m.lineId === line.id);
      const suggestion: MatchSuggestion | undefined = suggestions.get(line.id);
      return {
        ...line,
        state:
          own.length > 0
            ? ("matched" as const)
            : line.dismissedAt
              ? ("dismissed" as const)
              : ("open" as const),
        matches: own.map((m) => entryView(m.key, m.amount)),
        suggestion: suggestion
          ? {
              slip: suggestion.slip,
              entries: suggestion.keys.map((key) => {
                const entry = byKey.get(key);
                return entryView(key, entry ? signed(entry) : 0n);
              }),
            }
          : null,
      };
    });

    const statements = await tx
      .select({
        id: bankStatement.id,
        fromOn: bankStatement.fromOn,
        toOn: bankStatement.toOn,
        lineCount: bankStatement.lineCount,
        createdAt: bankStatement.createdAt,
        importedByName: user.name,
        used: sql<number>`(
          select count(*)::int from bank_statement_line l
          where l.statement_id = bank_statement.id
            and (l.dismissed_at is not null
              or exists (select 1 from bank_match m where m.line_id = l.id))
        )`,
      })
      .from(bankStatement)
      .innerJoin(user, eq(user.id, bankStatement.importedBy))
      .where(eq(bankStatement.accountId, account.id))
      .orderBy(desc(bankStatement.createdAt))
      .limit(12);

    const inPeriod = open.filter((e) => e.on >= from && e.on <= to);
    const sum = (values: Centimes[]) => values.reduce((total, v) => total + v, 0n);
    return {
      account,
      from,
      to,
      lines: view,
      /** Entries the match dialog offers (the period and around it), not matched yet. */
      candidates: open.map((e) => ({
        key: e.key,
        on: e.on,
        label: e.label,
        reference: e.reference,
        source: e.source,
        amount: signed(e),
        pendingCheque: e.pendingCheque,
      })),
      /** Entries of the period the bank has not shown yet (or not matched). */
      unmatchedEntries: inPeriod.map((e) => ({
        key: e.key,
        on: e.on,
        label: e.label,
        reference: e.reference,
        source: e.source,
        amount: signed(e),
        pendingCheque: e.pendingCheque,
      })),
      statements,
      totals: {
        lines: lines.length,
        matched: view.filter((l) => l.state === "matched").length,
        dismissed: view.filter((l) => l.state === "dismissed").length,
        open: view.filter((l) => l.state === "open").length,
        suggested: suggestions.size,
        statementIn: sum(lines.filter((l) => l.amount > 0n).map((l) => l.amount)),
        statementOut: sum(lines.filter((l) => l.amount < 0n).map((l) => -l.amount)),
        entriesIn: sum(inPeriod.filter((e) => e.amountIn > 0n).map((e) => e.amountIn)),
        entriesOut: sum(inPeriod.filter((e) => e.amountOut > 0n).map((e) => e.amountOut)),
        ledgerBalance: await balanceOn(tx, account.id, to < today ? to : today),
      },
    };
  });
}

export type Reconciliation = NonNullable<Awaited<ReturnType<typeof getReconciliation>>>;

/** An open line of the account, locked (neither matched nor set aside). */
async function openLine(tx: Tx, lineId: string) {
  const [line] = await tx
    .select()
    .from(bankStatementLine)
    .where(eq(bankStatementLine.id, lineId))
    .for("update");
  if (!line) throw new AppError("NOT_FOUND");
  const [match] = await tx
    .select({ id: bankMatch.id })
    .from(bankMatch)
    .where(eq(bankMatch.lineId, line.id))
    .limit(1);
  if (match || line.dismissedAt) throw new AppError("CONFLICT", "treasury.errors.lineClosed");
  return line;
}

/**
 * Matches a line with entries of its account's ledger, not matched yet, whose signed amounts
 * sum to the line's. Audited on the account.
 */
async function matchLine(
  tx: Tx,
  ctx: TenantCtx,
  line: typeof bankStatementLine.$inferSelect,
  keys: string[],
  options: { audit: boolean } = { audit: true },
) {
  const unique = [...new Set(keys)];
  const account = await loadBankAccount(tx, line.accountId);
  const entries = await entriesBetween(
    tx,
    account,
    addDays(line.bookedOn, -MATCH_BACK_DAYS),
    todayInAlgiers(),
  );
  const matched = await matchedKeys(tx, account.id);
  const picked = unique.map((key) => {
    const entry = entries.find((e) => e.key === key);
    if (!entry) throw new AppError("VALIDATION", "treasury.errors.entryUnknown");
    if (matched.has(key)) throw new AppError("CONFLICT", "treasury.errors.entryMatched");
    return { key, amount: signed(entry) };
  });
  const total = picked.reduce((sum, p) => sum + p.amount, 0n);
  if (total !== line.amount) throw new AppError("VALIDATION", "treasury.errors.matchTotal");
  await tx.insert(bankMatch).values(
    picked.map((p) => ({
      organizationId: ctx.orgId,
      accountId: account.id,
      lineId: line.id,
      entryKey: p.key,
      amount: p.amount,
      matchedBy: ctx.userId,
    })),
  );
  if (options.audit) {
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "bank_statement_line.match",
      entityType: "treasury_account",
      entityId: account.id,
      after: { lineId: line.id, bookedOn: line.bookedOn, amount: line.amount, entries: unique },
    });
  }
}

/** Gérant, comptable (`treasury:update`): a statement line matched by hand. */
export async function matchStatementLine(
  ctx: TenantCtx,
  input: In<typeof matchStatementLineSchema>,
) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const line = await openLine(tx, input.lineId);
    await matchLine(tx, ctx, line, input.entryKeys);
  });
}

/** Every suggestion of the period accepted at once; returns how many lines were matched. */
export async function applySuggestions(ctx: TenantCtx, input: In<typeof applySuggestionsSchema>) {
  assertCan(ctx, "treasury:update");
  const current = await getReconciliation(ctx, input.accountId, {
    from: input.from,
    to: input.to,
  });
  if (!current) throw new AppError("NOT_FOUND");
  const suggested = current.lines.filter((l) => l.state === "open" && l.suggestion);
  if (suggested.length === 0) return { matched: 0 };
  await withTenant(ctx, async (tx) => {
    for (const item of suggested) {
      const line = await openLine(tx, item.id);
      await matchLine(
        tx,
        ctx,
        line,
        (item.suggestion?.entries ?? []).map((e) => e.key),
        { audit: false },
      );
    }
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "bank_statement_line.match",
      entityType: "treasury_account",
      entityId: input.accountId,
      after: { suggestions: suggested.length, from: input.from, to: input.to },
    });
  });
  return { matched: suggested.length };
}

/** A matched line opened again (its matches deleted). Audited. */
export async function unmatchStatementLine(ctx: TenantCtx, input: In<typeof statementLineSchema>) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const [line] = await tx
      .select()
      .from(bankStatementLine)
      .where(eq(bankStatementLine.id, input.lineId))
      .for("update");
    if (!line) throw new AppError("NOT_FOUND");
    const removed = await tx
      .delete(bankMatch)
      .where(eq(bankMatch.lineId, line.id))
      .returning({ key: bankMatch.entryKey });
    if (removed.length === 0) throw new AppError("CONFLICT", "treasury.errors.lineNotMatched");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "bank_statement_line.unmatch",
      entityType: "treasury_account",
      entityId: line.accountId,
      before: { lineId: line.id, entries: removed.map((r) => r.key) },
    });
  });
}

/**
 * A line only the bank knows (fees, interest, a direct debit) recorded as a movement on its day
 * — income for a credit, expense or bank fee for a debit — and matched with it, in one
 * transaction.
 */
export async function bookStatementLine(ctx: TenantCtx, input: In<typeof bookStatementLineSchema>) {
  assertCan(ctx, "treasury:update");
  return withTenant(ctx, async (tx) => {
    const line = await openLine(tx, input.lineId);
    if (line.amount > 0n !== (input.kind === "income")) {
      throw new AppError("VALIDATION", "treasury.errors.bookDirection", {
        fieldErrors: { kind: ["treasury.errors.bookDirection"] },
      });
    }
    const { id } = await recordMovement(
      ctx,
      {
        kind: input.kind,
        accountId: line.accountId,
        amount: line.amount > 0n ? line.amount : -line.amount,
        movedOn: line.bookedOn,
        label: input.label,
        category: input.category,
        reference: line.reference,
      },
      tx,
    );
    await matchLine(tx, ctx, line, [`movement:${id}`]);
    return { movementId: id };
  });
}

/** A line set aside with a reason (nothing in the ledger to match it with). Audited. */
export async function dismissStatementLine(
  ctx: TenantCtx,
  input: In<typeof dismissStatementLineSchema>,
) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const line = await openLine(tx, input.lineId);
    await tx
      .update(bankStatementLine)
      .set({ dismissedAt: new Date(), dismissedBy: ctx.userId, dismissalReason: input.reason })
      .where(eq(bankStatementLine.id, line.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "bank_statement_line.dismiss",
      entityType: "treasury_account",
      entityId: line.accountId,
      after: { lineId: line.id, bookedOn: line.bookedOn, amount: line.amount },
      reason: input.reason,
    });
  });
}

/** A line set aside is open again. */
export async function restoreStatementLine(ctx: TenantCtx, input: In<typeof statementLineSchema>) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const [line] = await tx
      .update(bankStatementLine)
      .set({ dismissedAt: null, dismissedBy: null, dismissalReason: null })
      .where(
        and(
          eq(bankStatementLine.id, input.lineId),
          sql`${bankStatementLine.dismissedAt} is not null`,
        ),
      )
      .returning({ accountId: bankStatementLine.accountId });
    if (!line) throw new AppError("CONFLICT", "treasury.errors.lineNotDismissed");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "bank_statement_line.restore",
      entityType: "treasury_account",
      entityId: line.accountId,
      after: { lineId: input.lineId },
    });
  });
}

/** A statement imported by mistake withdrawn — only while none of its lines is matched or set aside. */
export async function deleteStatement(ctx: TenantCtx, input: In<typeof deleteStatementSchema>) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const [statement] = await tx
      .select()
      .from(bankStatement)
      .where(eq(bankStatement.id, input.statementId));
    if (!statement) throw new AppError("NOT_FOUND");
    const lines = await tx
      .select({ id: bankStatementLine.id })
      .from(bankStatementLine)
      .where(
        and(eq(bankStatementLine.statementId, statement.id), isNull(bankStatementLine.dismissedAt)),
      );
    const [used] =
      lines.length === 0
        ? []
        : await tx
            .select({ id: bankMatch.id })
            .from(bankMatch)
            .where(
              inArray(
                bankMatch.lineId,
                lines.map((l) => l.id),
              ),
            )
            .limit(1);
    const [dismissed] = await tx
      .select({ id: bankStatementLine.id })
      .from(bankStatementLine)
      .where(
        and(
          eq(bankStatementLine.statementId, statement.id),
          sql`${bankStatementLine.dismissedAt} is not null`,
        ),
      )
      .limit(1);
    if (used || dismissed) throw new AppError("CONFLICT", "treasury.errors.statementUsed");
    await tx.delete(bankStatementLine).where(eq(bankStatementLine.statementId, statement.id));
    await tx.delete(bankStatement).where(eq(bankStatement.id, statement.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "bank_statement.delete",
      entityType: "treasury_account",
      entityId: statement.accountId,
      before: {
        fromOn: statement.fromOn,
        toOn: statement.toOn,
        lineCount: statement.lineCount,
      },
    });
  });
}
