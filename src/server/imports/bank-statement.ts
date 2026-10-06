import "server-only";

import { eq } from "drizzle-orm";

import { bankStatement, bankStatementLine, treasuryAccount } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { type Centimes, parseDZD } from "@/lib/money";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { type ImportPlan, issuesOf, type TemplateSheet } from "./plan";
import {
  type CellValue,
  date,
  type ImportIssue,
  money,
  normalize,
  sheetRows,
  text,
  type Workbook,
} from "./sheets";

const help = (fr: string, ar: string) => ({ fr, ar });

export const bankStatementSheet: TemplateSheet = {
  name: { fr: "Relevé", ar: "كشف الحساب" },
  columns: [
    {
      key: "bookedOn",
      fr: "Date",
      ar: "التاريخ",
      required: true,
      help: help("Date de l'opération (jj/mm/aaaa).", "تاريخ العملية (يوم/شهر/سنة)."),
    },
    {
      key: "label",
      fr: "Libellé",
      ar: "البيان",
      required: true,
      help: help("Libellé de la banque.", "بيان البنك."),
    },
    {
      key: "reference",
      fr: "Référence",
      ar: "المرجع",
      help: help("N° de chèque, de virement… (facultatif).", "رقم الصك أو التحويل… (اختياري)."),
    },
    {
      key: "debit",
      fr: "Débit",
      ar: "مدين",
      help: help("Sortie en dinars.", "المبلغ الخارج بالدينار."),
    },
    {
      key: "credit",
      fr: "Crédit",
      ar: "دائن",
      help: help("Entrée en dinars.", "المبلغ الداخل بالدينار."),
    },
    {
      key: "amount",
      fr: "Montant",
      ar: "المبلغ",
      help: help(
        "Au lieu de Débit / Crédit : négatif pour une sortie.",
        "بدلاً من مدين / دائن: سالب للمبلغ الخارج.",
      ),
    },
  ],
  example: {
    bookedOn: "05/10/2026",
    label: "VIR RECU BENSALEM KARIM",
    reference: "VIR-0042",
    debit: "",
    credit: 2_000_000,
    amount: "",
  },
};

/** « 1 250,00 », « -1 250,00 », « (1 250,00) » or « 1 250,00- » → signed centimes. */
function signedAmount(value: CellValue): Centimes | null | "" {
  if (typeof value === "number") {
    const centimes = parseDZD(Math.abs(value).toFixed(2));
    return centimes === null ? null : value < 0 ? -centimes : centimes;
  }
  const raw = money(value).replace(/[\s\u00a0\u202f]/g, "");
  if (raw === "") return "";
  const negative = /^-|-$|^\(.*\)$/.test(raw);
  const centimes = parseDZD(raw.replace(/^[-(]|[-)]$/g, ""));
  return centimes === null ? null : negative ? -centimes : centimes;
}

/**
 * A bank or CCP statement for an account (`treasury:update`, CLAUDE.md §7 Treasury): one line
 * per operation, its day, label, reference and amount (debit / credit, or one signed amount).
 * Lines already imported (same day, amount, label and reference, at the same rank) and lines
 * before the account's opening are left aside.
 */
export async function prepareBankStatement(
  ctx: TenantCtx,
  workbook: Workbook,
  options: { accountId: string },
): Promise<ImportPlan> {
  assertCan(ctx, "treasury:update");
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const report = issuesOf(bankStatementSheet, issues);
  const leave = issuesOf(bankStatementSheet, warnings);
  const { account, known } = await withTenant(ctx, async (tx) => {
    const [account] = await tx
      .select()
      .from(treasuryAccount)
      .where(eq(treasuryAccount.id, options.accountId));
    const known = await tx
      .select({ fingerprint: bankStatementLine.fingerprint })
      .from(bankStatementLine)
      .where(eq(bankStatementLine.accountId, options.accountId));
    return { account, known: new Set(known.map((k) => k.fingerprint)) };
  });
  if (!account) throw new AppError("NOT_FOUND");
  if (account.kind === "cash") throw new AppError("VALIDATION", "treasury.errors.statementCash");

  const rows = sheetRows(workbook, bankStatementSheet.name, bankStatementSheet.columns, issues);
  const today = todayInAlgiers();
  const lines: { bookedOn: string; label: string; reference: string | null; amount: Centimes }[] =
    [];
  const fingerprints: string[] = [];
  const ranks = new Map<string, number>();
  for (const { row, cells } of rows ?? []) {
    const bookedOn = date(cells.bookedOn ?? null);
    const label = text(cells.label ?? null).slice(0, 300);
    const reference = text(cells.reference ?? null).slice(0, 80) || null;
    const debit = signedAmount(cells.debit ?? null);
    const credit = signedAmount(cells.credit ?? null);
    const signed = signedAmount(cells.amount ?? null);
    if (!bookedOn || bookedOn > today) {
      report.at(row, "bookedOn", "imports.errors.date");
      continue;
    }
    if (label === "") {
      report.at(row, "label", "validation.required");
      continue;
    }
    if (debit === null || credit === null || signed === null) {
      report.at(
        row,
        debit === null ? "debit" : credit === null ? "credit" : "amount",
        "imports.errors.amount",
      );
      continue;
    }
    // Exactly one of the three: a debit goes out, a credit comes in, an amount keeps its sign.
    const abs = (v: Centimes) => (v < 0n ? -v : v);
    const given = [
      debit === "" || debit === 0n ? null : -abs(debit),
      credit === "" || credit === 0n ? null : abs(credit),
      signed === "" || signed === 0n ? null : signed,
    ].filter((v): v is Centimes => v !== null);
    const [amount] = given;
    if (amount === undefined || given.length > 1) {
      report.at(row, "amount", "imports.errors.debitOrCredit");
      continue;
    }
    if (bookedOn < account.openingOn) {
      leave.at(row, "bookedOn", "imports.warnings.beforeOpening");
      continue;
    }
    const base = [bookedOn, amount.toString(), normalize(label), normalize(reference ?? "")].join(
      "|",
    );
    const rank = (ranks.get(base) ?? 0) + 1;
    ranks.set(base, rank);
    const fingerprint = `${base}|${rank}`;
    if (known.has(fingerprint)) {
      leave.at(row, null, "imports.warnings.lineImported");
      continue;
    }
    lines.push({ bookedOn, label, reference, amount });
    fingerprints.push(fingerprint);
  }

  return {
    counts: { statementLines: lines.length },
    issues,
    warnings,
    apply: async (tx) => {
      const days = lines.map((l) => l.bookedOn).sort();
      const [statement] = await tx
        .insert(bankStatement)
        .values({
          organizationId: ctx.orgId,
          accountId: account.id,
          fromOn: days[0] ?? today,
          toOn: days.at(-1) ?? today,
          lineCount: lines.length,
          importedBy: ctx.userId,
        })
        .returning({ id: bankStatement.id });
      if (!statement) throw new Error("prepareBankStatement: no statement returned");
      await tx.insert(bankStatementLine).values(
        lines.map((line, i) => ({
          organizationId: ctx.orgId,
          accountId: account.id,
          statementId: statement.id,
          ...line,
          fingerprint: fingerprints[i] ?? "",
        })),
      );
    },
  };
}
