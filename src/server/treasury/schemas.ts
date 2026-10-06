/** Isomorphic: cash desks and bank accounts (CLAUDE.md §7 Treasury). */
import { z } from "zod";

import { chequeSources, manualMovementKinds, treasuryAccountKinds } from "@/lib/treasury";
import { dateText, moneyText, optionalText, requiredText } from "@/lib/zod";

const accountFields = {
  name: requiredText(80),
  bankName: optionalText(80),
  accountNumber: optionalText(40),
  isDefault: z.boolean(),
  notes: optionalText(500),
};

/** A new cash desk or account, with its balance on its opening day. */
export const createAccountSchema = z.object({
  kind: z.enum(treasuryAccountKinds),
  ...accountFields,
  openingBalance: moneyText().refine((v) => v >= 0n, "validation.amount"),
  openingOn: dateText(),
});

/** Name, bank, number, default and notes (the opening balance stays as created). */
export const updateAccountSchema = z.object({ accountId: z.uuid(), ...accountFields });

/** Closing an account (its balance must be nil: transfer the rest first). */
export const closeAccountSchema = z.object({ accountId: z.uuid(), closedOn: dateText() });

/** A manual movement: income, expense or bank fee on one account, or a transfer between two. */
export const recordMovementSchema = z
  .object({
    kind: z.enum(manualMovementKinds),
    accountId: z.uuid(),
    /** Transfers only: the receiving account. */
    toAccountId: z.uuid().or(z.literal("")).optional(),
    amount: moneyText().refine((v) => v > 0n, "validation.amount"),
    movedOn: dateText(),
    label: requiredText(160),
    category: optionalText(80),
    reference: optionalText(60),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "transfer" && !value.toAccountId) {
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "validation.required" });
    }
    if (value.kind === "transfer" && value.toAccountId === value.accountId) {
      ctx.addIssue({
        code: "custom",
        path: ["toAccountId"],
        message: "treasury.errors.sameAccount",
      });
    }
  });

export const cancelMovementSchema = z.object({ movementId: z.uuid(), reason: requiredText(500) });

/** Arrêté de caisse: the cash counted on a day (a note explains any difference). */
export const cashCountSchema = z.object({
  accountId: z.uuid(),
  countedOn: dateText(),
  counted: moneyText().refine((v) => v >= 0n, "validation.amount"),
  note: optionalText(300),
});

/** A ledger's period (URL search params); the current month by default. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
export const ledgerParams = z.object({ from: day, to: day });
export type LedgerParams = z.output<typeof ledgerParams>;

/** Bordereau de remise: some pending cheques of a bank or CCP account, handed to the bank. */
export const createChequeDepositSchema = z.object({
  accountId: z.uuid(),
  depositedOn: dateText(),
  cheques: z
    .array(z.object({ source: z.enum(chequeSources), paymentId: z.uuid() }))
    .min(1, "treasury.errors.noCheque")
    .max(200),
});

/** The bank credited a slip: its cheques are cleared on that day. */
export const clearChequeDepositSchema = z.object({
  depositId: z.uuid(),
  clearedOn: dateText(),
});
