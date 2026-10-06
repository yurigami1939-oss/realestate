import { addDays, todayInAlgiers } from "@/lib/dates";
import { toDecimalString } from "@/lib/money";
import type { TenantCtx } from "@/server/auth/session";
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
      openingBalance: "1 500 000",
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
