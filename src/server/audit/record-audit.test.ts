import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";

import { createOrganization, createUser } from "../../../tests/factories";

import { recordAudit } from "./record-audit";

describe("recordAudit", () => {
  it("stores before/after with money as centimes strings", async () => {
    const org = await createOrganization();
    const actor = await createUser();
    const scope = { orgId: org.id };

    await withTenant(scope, (tx) =>
      recordAudit(tx, scope, {
        actorUserId: actor.id,
        action: "unit.price_change",
        entityType: "unit",
        entityId: org.id,
        before: { price: 1_250_000_000n },
        after: { price: 1_300_000_000n, at: new Date("2026-05-10T10:00:00Z") },
        reason: "grille 2026",
      }),
    );

    const rows = await withTenant(scope, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.organizationId, org.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: actor.id,
      action: "unit.price_change",
      before: { price: "1250000000" },
      after: { price: "1300000000", at: "2026-05-10T10:00:00.000Z" },
      reason: "grille 2026",
    });
  });
});
