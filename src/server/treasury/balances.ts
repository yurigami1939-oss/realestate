import "server-only";

import { sql } from "drizzle-orm";

import type { Tx } from "@/db/client";
import type { CalendarDate } from "@/lib/dates";
import type { Centimes } from "@/lib/money";

/**
 * Every flow of the accounts as signed amounts by day: valid collections (sales, charges,
 * rents and deposits), live movements, and what left them (contractors' progress invoices and
 * retentions, supplier invoices). Flows dated before an account's opening are in its
 * opening balance, so they are left out.
 */
const flows = sql`
  with flows as (
    select account_id, amount, paid_on as day from payment
      where status = 'valid' and account_id is not null
    union all
    select account_id, amount, paid_on from charge_payment
      where status = 'valid' and account_id is not null
    union all
    select account_id, amount, paid_on from rent_payment
      where status = 'valid' and account_id is not null
    union all
    select account_id, case when direction = 'in' then amount else -amount end, moved_on
      from treasury_movement where cancelled_at is null
    union all
    select account_id, -net, paid_on from works_invoice
      where paid_on is not null and account_id is not null
    union all
    select retention_account_id, -retention_released, retention_released_on from works_contract
      where retention_released_on is not null and retention_account_id is not null
    union all
    select account_id, -amount, paid_on from supplier_invoice
      where paid_on is not null and account_id is not null and deleted_at is null
  )`;

export type AccountTotals = {
  /** Balance at the end of `on`. */
  balance: Centimes;
  /** Money in and out on `on` itself. */
  inOn: Centimes;
  outOn: Centimes;
  /** Cheques received on the account and not cleared yet (in the balance). */
  pendingCheques: Centimes;
};

/** Balances of the organization's accounts at the end of a day (all accounts when no ids). */
export async function accountTotals(
  tx: Tx,
  on: CalendarDate,
  accountIds?: string[],
): Promise<Map<string, AccountTotals>> {
  const only =
    accountIds === undefined
      ? sql``
      : accountIds.length === 0
        ? sql`and false`
        : sql`and a.id in (${sql.join(
            accountIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;
  const rows = await tx.execute<{
    id: string;
    balance: string;
    in_on: string;
    out_on: string;
  }>(sql`${flows}
    select a.id,
      (a.opening_balance + coalesce(sum(f.amount)
        filter (where f.day >= a.opening_on and f.day <= ${on}::date), 0))::text as balance,
      coalesce(sum(f.amount) filter (where f.day = ${on}::date and f.amount > 0), 0)::text as in_on,
      coalesce(-sum(f.amount) filter (where f.day = ${on}::date and f.amount < 0), 0)::text as out_on
    from treasury_account a
    left join flows f on f.account_id = a.id
    where true ${only}
    group by a.id, a.opening_balance, a.opening_on`);
  const cheques = await tx.execute<{ account_id: string; pending: string }>(sql`
    select account_id, sum(amount)::text as pending from (
      select account_id, amount from payment
        where status = 'valid' and method = 'cheque' and cheque_cleared_on is null
      union all
      select account_id, amount from charge_payment
        where status = 'valid' and method = 'cheque' and cheque_cleared_on is null
      union all
      select account_id, amount from rent_payment
        where status = 'valid' and method = 'cheque' and cheque_cleared_on is null
    ) c where account_id is not null group by account_id`);
  const pending = new Map(cheques.rows.map((r) => [r.account_id, BigInt(r.pending)]));
  return new Map(
    rows.rows.map((r) => [
      r.id,
      {
        balance: BigInt(r.balance),
        inOn: BigInt(r.in_on),
        outOn: BigInt(r.out_on),
        pendingCheques: pending.get(r.id) ?? 0n,
      },
    ]),
  );
}

/** An account's balance at the end of a day. */
export async function balanceOn(tx: Tx, accountId: string, on: CalendarDate): Promise<Centimes> {
  return (await accountTotals(tx, on, [accountId])).get(accountId)?.balance ?? 0n;
}
