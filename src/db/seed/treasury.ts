import { addDays, todayInAlgiers } from "@/lib/dates";
import { toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
import { runImport } from "@/server/imports/service";
import { listAccounts } from "@/server/treasury/queries";
import {
  cashCountSchema,
  createAccountSchema,
  recordMovementSchema,
} from "@/server/treasury/schemas";
import { createAccount, recordCashCount, recordMovement } from "@/server/treasury/service";

const OPENED = "2023-01-01";

/**
 * The company's cash desk, bank and CCP accounts, opened before the seeded sales so that every
 * collection lands on the default account of its method.
 */
export async function seedTreasuryAccounts(owner: TenantCtx) {
  const accounts = [
    {
      kind: "cash",
      name: "Caisse siège",
      bankName: "",
      accountNumber: "",
      openingBalance: "250 000",
    },
    {
      kind: "bank",
      name: "BNA compte courant",
      bankName: "BNA, agence Didouche Mourad",
      accountNumber: "00100123012345678901",
      openingBalance: "450 000 000",
    },
    {
      kind: "ccp",
      name: "CCP société",
      bankName: "Algérie Poste",
      accountNumber: "0021987654 32",
      openingBalance: "0",
    },
  ];
  for (const a of accounts) {
    await createAccount(
      owner,
      createAccountSchema.parse({ ...a, isDefault: true, notes: "", openingOn: OPENED }),
    );
  }
}

/**
 * This week's treasury: office supplies paid from the cash desk, the takings paid into the
 * bank, bank fees, and today's cash count short of 200 DA (for the cashier to explain).
 */
export async function seedTreasuryMovements(owner: TenantCtx, cashier: TenantCtx) {
  const today = todayInAlgiers();
  const accounts = await listAccounts(owner);
  const cash = accounts.find((a) => a.kind === "cash");
  const bank = accounts.find((a) => a.kind === "bank");
  if (!cash || !bank) throw new Error("seed: treasury accounts missing");
  const move = (input: Record<string, string>) =>
    recordMovement(
      owner,
      recordMovementSchema.parse({ toAccountId: "", category: "", reference: "", ...input }),
    );
  await move({
    kind: "expense",
    accountId: cash.id,
    amount: "12 500",
    movedOn: addDays(today, -3),
    label: "Fournitures de bureau",
    category: "Fournitures",
    reference: "Facture 2026/311",
  });
  await move({
    kind: "transfer",
    accountId: cash.id,
    toAccountId: bank.id,
    amount: "150 000",
    movedOn: addDays(today, -2),
    label: "Versement des espèces en banque",
    reference: "Bordereau 0047",
  });
  await move({
    kind: "bank_fee",
    accountId: bank.id,
    amount: "1 800",
    movedOn: addDays(today, -1),
    label: "Frais de tenue de compte",
  });
  const balance = (await listAccounts(owner)).find((a) => a.id === cash.id)?.balance ?? 0n;
  await recordCashCount(
    cashier,
    cashCountSchema.parse({
      accountId: cash.id,
      countedOn: today,
      counted: toDecimalString(balance - 20_000n).replace(".", ","),
      note: "Monnaie rendue en trop à un client",
    }),
  );
}

/**
 * This week's BNA statement, imported and not reconciled yet: the cash paid in and the fee find
 * their movements (two suggestions), the agios are only on the bank's side (to book).
 */
export async function seedBankStatement(owner: TenantCtx) {
  const today = todayInAlgiers();
  const bank = (await listAccounts(owner)).find((a) => a.kind === "bank");
  if (!bank) throw new Error("seed: bank account missing");
  const day = (offset: number) => {
    const d = addDays(today, offset);
    return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  };
  const rows = [
    ["Date", "Libellé", "Référence", "Débit", "Crédit"],
    [day(-2), "VERSEMENT ESPECES", "Bordereau 0047", "", "150 000,00"],
    [day(-1), "FRAIS TENUE DE COMPTE", "", "1 800,00", ""],
    [day(-1), "AGIOS DEBITEURS", "", "350,00", ""],
  ];
  const report = await runImport(
    owner,
    "bank_statement",
    Buffer.from(rows.map((r) => r.join(";")).join("\r\n")),
    { accountId: bank.id, commit: true },
  );
  if (!report.committed) throw new Error("seed: bank statement not imported");
}
