import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Pool, type PoolClient } from "pg";

import { addDays, type CalendarDate, todayInAlgiers, toCalendarDate } from "@/lib/dates";
import { bucket, s3 } from "@/server/files/s3";

/**
 * How long a terminated organization's data is kept before it may be purged (CLAUDE.console.md
 * §17 step 10): the export window of the SaaS terms, to confirm in the contract.
 */
export const PURGE_RETENTION_DAYS = 90;

export type PurgeReport = {
  organizationId: string;
  legalName: string;
  terminatedOn: CalendarDate | null;
  /** Rows of the organization per table, children first: the order they are deleted in. */
  tables: { table: string; rows: number }[];
  /** Stored files under `org/{organizationId}/`. */
  objects: number;
  /** Accounts that belonged to this organization only (staff and portal), deleted with it. */
  users: number;
  executed: boolean;
};

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An organization already purged (its row gone, `organization.purge` in the console's trail):
 * only its stored files left behind are listed, and deleted once its legal name is confirmed.
 */
async function purgeFilesLeft(
  client: PoolClient,
  organizationId: string,
  confirm: string | null,
): Promise<PurgeReport> {
  const { rows } = await client.query<{ legalName: string; terminatedOn: CalendarDate | null }>(
    `select after ->> 'legalName' as "legalName", after ->> 'terminatedOn' as "terminatedOn"
     from console.audit_log where action = 'organization.purge' and organization_id = $1
     order by created_at desc limit 1`,
    [organizationId],
  );
  const purged = rows[0];
  if (!purged) throw new Error(`purge: no organization ${organizationId}`);
  const keys = await listObjects(`org/${organizationId}/`);
  const report: PurgeReport = {
    organizationId,
    legalName: purged.legalName,
    terminatedOn: purged.terminatedOn,
    tables: [],
    objects: keys.length,
    users: 0,
    executed: false,
  };
  if (confirm !== purged.legalName) return report;
  await deleteObjects(keys);
  return { ...report, executed: true };
}

/**
 * The organization's tables, children before their parents: every `public` table with an
 * `organization_id` (Better Auth's `member` and `invitation` included), ordered so that no row
 * is deleted before the rows pointing at it (self-references are deleted in one statement).
 */
async function tablesInDeleteOrder(client: PoolClient): Promise<string[]> {
  const { rows: tables } = await client.query<{ name: string }>(`
    select c.relname as name from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`);
  const names = new Set(tables.map((t) => t.name));
  const { rows: edges } = await client.query<{ child: string; parent: string }>(`
    select distinct child.relname as child, parent.relname as parent
    from pg_constraint k
    join pg_class child on child.oid = k.conrelid
    join pg_class parent on parent.oid = k.confrelid
    where k.contype = 'f' and k.connamespace = 'public'::regnamespace and k.conrelid <> k.confrelid`);
  const children = new Map<string, Set<string>>([...names].map((n) => [n, new Set<string>()]));
  for (const edge of edges) {
    if (names.has(edge.child) && names.has(edge.parent)) children.get(edge.parent)?.add(edge.child);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  const visit = (table: string, path: Set<string>) => {
    if (done.has(table)) return;
    if (path.has(table)) throw new Error(`purge: foreign key cycle through ${table}`);
    path.add(table);
    for (const child of children.get(table) ?? []) visit(child, path);
    path.delete(table);
    done.add(table);
    ordered.push(table);
  };
  for (const table of names) visit(table, new Set());
  return ordered;
}

async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Deletes stored objects, checking each batch's answer; FAILS naming what is left. */
async function deleteObjects(keys: string[]): Promise<void> {
  let failed: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    for (let attempt = 0; attempt < 2 && batch.length > 0; attempt += 1) {
      const answer = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const refused = new Set((answer.Errors ?? []).map((e) => e.Key ?? ""));
      batch.splice(0, batch.length, ...batch.filter((key) => refused.has(key)));
    }
    failed = failed.concat(batch);
  }
  if (failed.length > 0) {
    throw new Error(
      `purge: ${failed.length} stored file(s) not deleted (e.g. ${failed[0]}); run the purge again to finish.`,
    );
  }
}

/**
 * `pnpm console:purge` (CLAUDE.console.md §17 step 10), on the owner connection: an organization
 * whose account was terminated at least `retentionDays` ago loses its data — every tenant row in
 * foreign-key order (in one transaction, `app.current_org` set: RLS still applies), the accounts
 * that belonged to it only, its row, its link to the client account, then its stored files.
 * The console keeps the client account, its invoices, payments and audit trail (a purge row is
 * added). A dry run (the report) unless `confirm` is the organization's legal name exactly. Run
 * again on a purged organization, it deletes the stored files left behind (same confirmation).
 */
export async function purgeOrganization(input: {
  ownerUrl: string;
  organizationId: string;
  confirm?: string | null;
  retentionDays?: number;
  today?: CalendarDate;
}): Promise<PurgeReport> {
  const retentionDays = input.retentionDays ?? PURGE_RETENTION_DAYS;
  const today = input.today ?? todayInAlgiers();
  const pool = new Pool({ connectionString: input.ownerUrl, max: 1 });
  const client = await pool.connect();
  try {
    if (!UUID.test(input.organizationId)) {
      throw new Error(`purge: ${input.organizationId} is not an organization id`);
    }
    // The canonical id (lower case): the stored files' prefix uses it.
    const organizationId = input.organizationId.toLowerCase();
    const { rows: found } = await client.query<{ name: string; legalName: string | null }>(
      `select name, legal_name as "legalName" from organization where id = $1`,
      [organizationId],
    );
    const org = found[0];
    if (!org) return await purgeFilesLeft(client, organizationId, input.confirm ?? null);
    const legalName = org.legalName ?? org.name;

    const { rows: account } = await client.query<{
      billingAccountId: string;
      status: string;
      terminatedAt: Date | null;
    }>(
      `select ao.billing_account_id as "billingAccountId", s.status,
        (select max(l.created_at) from console.audit_log l
         where l.billing_account_id = ao.billing_account_id
           and l.action = 'subscription.status_change' and l.after ->> 'status' = 'terminated')
          as "terminatedAt"
       from console.account_organization ao
       join console.subscription s on s.billing_account_id = ao.billing_account_id
       where ao.organization_id = $1`,
      [organizationId],
    );
    const link = account[0];
    const terminatedOn = link?.terminatedAt ? toCalendarDate(link.terminatedAt) : null;
    if (link?.status !== "terminated" || !terminatedOn) {
      throw new Error(
        `purge: ${legalName} is not terminated: only a terminated account is purged.`,
      );
    }
    if (addDays(terminatedOn, retentionDays) > today) {
      throw new Error(
        `purge: ${legalName} was terminated on ${terminatedOn}; its data is kept until ${addDays(terminatedOn, retentionDays)}.`,
      );
    }

    const order = await tablesInDeleteOrder(client);
    await client.query("begin");
    await client.query(`select set_config('app.current_org', $1, true)`, [organizationId]);
    const tables: PurgeReport["tables"] = [];
    for (const table of order) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from ${quote(table)} where organization_id = $1`,
        [organizationId],
      );
      tables.push({ table, rows: rows[0]?.n ?? 0 });
    }
    const { rows: members } = await client.query<{ userId: string }>(
      `select m.user_id as "userId" from member m
       where m.organization_id = $1
         and not exists (select 1 from member o where o.user_id = m.user_id and o.organization_id <> $1)`,
      [organizationId],
    );
    const keys = await listObjects(`org/${organizationId}/`);
    const report: PurgeReport = {
      organizationId,
      legalName,
      terminatedOn,
      tables,
      objects: keys.length,
      users: members.length,
      executed: false,
    };
    if (input.confirm !== legalName) {
      await client.query("rollback");
      return report;
    }

    for (const { table } of tables) {
      await client.query(`delete from ${quote(table)} where organization_id = $1`, [
        organizationId,
      ]);
    }
    let users = 0;
    for (const { userId } of members) {
      // An account another organization's records still name stays (its sessions end).
      await client.query("savepoint purge_user");
      try {
        await client.query(
          `delete from "user" where id = $1 and role is distinct from 'operator'`,
          [userId],
        );
        await client.query("release savepoint purge_user");
        users += 1;
      } catch {
        await client.query("rollback to savepoint purge_user");
        await client.query(`delete from session where user_id = $1`, [userId]);
      }
    }
    await client.query(
      `update session set active_organization_id = null where active_organization_id = $1`,
      [organizationId],
    );
    await client.query(`delete from console.account_organization where organization_id = $1`, [
      organizationId,
    ]);
    await client.query(`delete from organization where id = $1`, [organizationId]);
    await client.query(
      `insert into console.audit_log (action, billing_account_id, organization_id, after)
       values ('organization.purge', $1, $2, $3)`,
      [
        link.billingAccountId,
        organizationId,
        JSON.stringify({
          legalName,
          terminatedOn,
          rows: tables.reduce((sum, t) => sum + t.rows, 0),
          users,
          objects: keys.length,
        }),
      ],
    );
    await client.query("commit");

    await deleteObjects(keys);
    return { ...report, users, executed: true };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
