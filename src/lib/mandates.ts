/**
 * Management mandates (gestion locative pour compte de tiers, CLAUDE.md §7 Rentals): the
 * organization lets units it does not own for their owners, collects the rents as their agent
 * and pays them out on owner statements (relevés de gérance) after its fees. Isomorphic.
 */
import { applyRate, type Centimes } from "./money";

export const mandateStatuses = ["active", "ended"] as const;
export type MandateStatus = (typeof mandateStatuses)[number];

export const ownerStatementStatuses = ["issued", "paid", "cancelled"] as const;
export type OwnerStatementStatus = (typeof ownerStatementStatuses)[number];

/** Management fees: at most 30 % of the rents collected. */
export const MAX_MANAGEMENT_FEE_BP = 3_000;

/** Lines of other deductions (repairs paid for the owner…) on one statement. */
export const MAX_STATEMENT_EXTRAS = 10;

/**
 * A rent collected for an owner, or the reversal of one already reported on an earlier
 * statement and cancelled since (a bounced cheque): a negative line of the next statement.
 */
export type StatementPayment = {
  rentPaymentId: string;
  leaseNumber: string;
  tenantName: string;
  unitCode: string;
  receiptNumber: string;
  paidOn: string;
  amount: Centimes;
  feeRateBp: number;
  reversal: boolean;
};

export type StatementLine = StatementPayment & { fee: Centimes };

export type StatementExtra = { label: string; amount: Centimes };

/**
 * The statement's lines and totals: each rent with the fee at its mandate's rate (half-up), a
 * reversal deducting both; other deductions as typed; the net paid out to the owner.
 */
export function ownerStatementTotals(payments: StatementPayment[], extras: StatementExtra[]) {
  const lines: StatementLine[] = payments.map((p) => {
    const fee = applyRate(p.amount, p.feeRateBp);
    return p.reversal ? { ...p, amount: -p.amount, fee: -fee } : { ...p, fee };
  });
  const collected = lines.reduce((sum, l) => sum + l.amount, 0n);
  const fees = lines.reduce((sum, l) => sum + l.fee, 0n);
  const deductions = extras.reduce((sum, e) => sum + e.amount, 0n);
  return { lines, collected, fees, deductions, net: collected - fees - deductions };
}
