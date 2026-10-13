import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import {
  accountOrganization,
  billingAccount,
  consoleAuditLog,
  invoice,
  member,
  user,
} from "@/db/schema";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import { saveOperatorProfile, issueInvoice } from "@/server/console/billing";
import { systemOperator } from "@/server/console/context";
import { changeSubscriptionStatus } from "@/server/console/lifecycle";
import { bucket, s3 } from "@/server/files/s3";
import { setUnitFloorPlan } from "@/server/inventory/floor-plans";

import { createOrganization, createSalesTeam } from "../../tests/factories";
import { createSaleSetup } from "../../tests/sales-fixtures";

import { purgeOrganization } from "./purge";

const ownerUrl = process.env.DATABASE_OWNER_URL ?? "";
const owner = new Pool({ connectionString: ownerUrl, max: 1 });

beforeAll(async () => {
  await saveOperatorProfile(systemOperator, {
    legalName: "Sayroura SARL",
    brand: null,
    legalForm: null,
    address: null,
    wilaya: null,
    phone: null,
    email: null,
    rcNumber: null,
    nif: null,
    nis: null,
    aiNumber: null,
    bank: null,
    rib: null,
    vatRegime: "vat",
    vatRateBp: 1900,
    paymentTermsDays: 15,
    footerFr: null,
    footerAr: null,
  });
});

afterAll(async () => {
  await owner.end();
  await stopEnqueue();
});

/** Rows of the organization left in any table with an `organization_id`. */
async function rowsLeft(organizationId: string): Promise<number> {
  const client = await owner.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('app.current_org', $1, true)`, [organizationId]);
    const { rows: tables } = await client.query<{ name: string }>(`
      select c.relname as name from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`);
    let left = 0;
    for (const { name } of tables) {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from "${name}" where organization_id = $1`,
        [organizationId],
      );
      left += rows[0]?.n ?? 0;
    }
    await client.query("rollback");
    return left;
  } finally {
    client.release();
  }
}

describe("purging a terminated organization (CLAUDE.console.md §17 step 10)", () => {
  it("waits for the retention, runs dry until confirmed, then deletes its data and keeps the console's", async () => {
    const team = await createSalesTeam(); // entitled through an account of its own
    const setup = await createSaleSetup(team);
    const { fileId } = await setUnitFloorPlan(team.manager, {
      unitId: setup.unitIds[0] ?? "",
      upload: { fileName: "plan.pdf", bytes: new TextEncoder().encode("%PDF-1.7\nx\n%%EOF") },
    });
    // The directeur commercial also works for another company: their account stays.
    const other = await createOrganization();
    await db.insert(member).values({
      organizationId: other.id,
      userId: team.manager.userId,
      role: "sales_manager",
      createdAt: new Date(),
    });
    const [link] = await consoleDb
      .select({ billingAccountId: accountOrganization.billingAccountId })
      .from(accountOrganization)
      .where(eq(accountOrganization.organizationId, team.orgId));
    const billingAccountId = link?.billingAccountId ?? "";
    const { invoiceId } = await issueInvoice(systemOperator, {
      billingAccountId,
      issuedOn: todayInAlgiers(),
      lines: [
        {
          kind: "other",
          addonCode: null,
          labelFr: "Formation",
          labelAr: "تكوين",
          periodStart: null,
          periodEnd: null,
          quantity: 1,
          unitPrice: 100_00n,
        },
      ],
    });

    const purge = (values: { confirm?: string; retentionDays?: number } = {}) =>
      purgeOrganization({ ownerUrl, organizationId: team.orgId, ...values });
    await expect(purge()).rejects.toThrow(/not terminated/);
    await changeSubscriptionStatus(systemOperator, {
      billingAccountId,
      to: "terminated",
      reason: "Fin de contrat",
    });
    await expect(purge()).rejects.toThrow(/kept until/);

    const dry = await purge({ retentionDays: 0, confirm: "Not its name" });
    expect(dry.executed).toBe(false);
    expect(dry.tables.find((t) => t.table === "unit")?.rows).toBe(3);
    // Children first: units before their buildings, buildings before their project.
    const position = (table: string) => dry.tables.findIndex((t) => t.table === table);
    expect(position("unit")).toBeLessThan(position("building"));
    expect(position("building")).toBeLessThan(position("project"));
    expect(dry.objects).toBe(1);
    expect(dry.users).toBe(3); // the gérant and the two commercials
    expect(await rowsLeft(team.orgId)).toBeGreaterThan(0);

    // The id as typed in upper case: the same organization, its files included.
    const done = await purgeOrganization({
      ownerUrl,
      organizationId: team.orgId.toUpperCase(),
      retentionDays: 0,
      confirm: dry.legalName,
    });
    expect(done).toMatchObject({ executed: true, users: 3, objects: 1 });
    expect(await rowsLeft(team.orgId)).toBe(0);
    const { rows: orgs } = await owner.query(`select id from organization where id = $1`, [
      team.orgId,
    ]);
    expect(orgs).toEqual([]);
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: `org/${team.orgId}/unit/${setup.unitIds[0]}/${fileId}.pdf`,
        }),
      ),
    ).rejects.toThrow();
    // A file left behind (a storage failure): a second run deletes it, once confirmed.
    const leftKey = `org/${team.orgId}/unit/${setup.unitIds[0]}/left.pdf`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: leftKey, Body: "%PDF-1.7" }));
    const again = await purge();
    expect(again).toMatchObject({ executed: false, objects: 1, tables: [] });
    expect(await purge({ confirm: dry.legalName })).toMatchObject({ executed: true, objects: 1 });
    await expect(s3.send(new HeadObjectCommand({ Bucket: bucket, Key: leftKey }))).rejects.toThrow();
    await expect(
      purgeOrganization({ ownerUrl, organizationId: "not-an-id" }),
    ).rejects.toThrow(/not an organization id/);
    // Accounts: the shared one stays, the others are gone.
    const people = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, team.manager.userId));
    expect(people).toHaveLength(1);
    const gone = await db.select({ id: user.id }).from(user).where(eq(user.id, team.owner.userId));
    expect(gone).toEqual([]);
    // The console keeps the client, its invoices and its trail, with the purge recorded.
    expect(
      await consoleDb.select({ id: invoice.id }).from(invoice).where(eq(invoice.id, invoiceId)),
    ).toHaveLength(1);
    expect(
      await consoleDb
        .select({ id: billingAccount.id })
        .from(billingAccount)
        .where(eq(billingAccount.id, billingAccountId)),
    ).toHaveLength(1);
    const trail = await consoleDb
      .select({ action: consoleAuditLog.action, after: consoleAuditLog.after })
      .from(consoleAuditLog)
      .where(eq(consoleAuditLog.organizationId, team.orgId));
    expect(trail.find((r) => r.action === "organization.purge")?.after).toMatchObject({
      users: 3,
      objects: 1,
    });
  });
});
