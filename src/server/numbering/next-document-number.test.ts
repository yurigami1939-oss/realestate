import { describe, expect, it } from "vitest";

import { withTenant } from "@/db/tenant";

import { createOrganization } from "../../../tests/factories";

import { nextDocumentNumber } from "./next-document-number";

const issuedAt = new Date("2026-05-10T10:00:00Z");

describe("nextDocumentNumber", () => {
  it("numbers sequentially per organization, type and year", async () => {
    const org = await createOrganization();
    const other = await createOrganization();

    const take = (orgId: string, type: "receipt" | "quotation", at = issuedAt) =>
      withTenant({ orgId }, (tx) => nextDocumentNumber(tx, { orgId }, type, at));

    expect((await take(org.id, "receipt")).number).toBe("REC-2026-000001");
    expect((await take(org.id, "receipt")).number).toBe("REC-2026-000002");
    expect((await take(org.id, "quotation")).number).toBe("DEV-2026-000001");
    expect((await take(other.id, "receipt")).number).toBe("REC-2026-000001");
    // 31 Dec 23:30 UTC is 1 Jan in Algiers → new year, new sequence.
    expect((await take(org.id, "receipt", new Date("2026-12-31T23:30:00Z"))).number).toBe(
      "REC-2027-000001",
    );
  });

  it("leaves no gap when the business transaction rolls back", async () => {
    const org = await createOrganization();
    const scope = { orgId: org.id };

    await withTenant(scope, (tx) => nextDocumentNumber(tx, scope, "receipt", issuedAt));
    await expect(
      withTenant(scope, async (tx) => {
        await nextDocumentNumber(tx, scope, "receipt", issuedAt);
        throw new Error("receipt insert failed");
      }),
    ).rejects.toThrow("receipt insert failed");
    const next = await withTenant(scope, (tx) =>
      nextDocumentNumber(tx, scope, "receipt", issuedAt),
    );

    expect(next.sequence).toBe(2);
  });

  it("never duplicates or skips under concurrency", async () => {
    const org = await createOrganization();
    const scope = { orgId: org.id };

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        withTenant(scope, (tx) => nextDocumentNumber(tx, scope, "payment_call", issuedAt)),
      ),
    );

    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});
