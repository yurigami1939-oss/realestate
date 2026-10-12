import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { consoleDb } from "@/db/console-client";

import { nextConsoleNumber } from "./numbering";

// Years of their own per run: the console's counters are not per tenant, the test database
// keeps them.
let year = 0;
let day = "";
beforeAll(async () => {
  const { rows } = await consoleDb.execute<{ next: number }>(
    sql`select greatest(coalesce(max(year), 0), 2999) + 2 as next from console.document_sequence`,
  );
  year = rows[0]?.next ?? 3001;
  day = `${year}-03-15`;
});

describe("nextConsoleNumber", () => {
  it("numbers invoices and credit notes apart, per year", async () => {
    const take = (type: "invoice" | "credit_note", on: string = day) =>
      consoleDb.transaction((tx) => nextConsoleNumber(tx, type, on));
    expect((await take("invoice")).number).toBe(`FAC-${year}-000001`);
    expect((await take("invoice")).number).toBe(`FAC-${year}-000002`);
    expect((await take("credit_note")).number).toBe(`AVO-${year}-000001`);
    expect((await take("invoice", `${year + 1}-01-02`)).number).toBe(`FAC-${year + 1}-000001`);
  });

  it("leaves no gap on rollback and none under concurrency", async () => {
    const on = `${year}-07-01`;
    await expect(
      consoleDb.transaction(async (tx) => {
        await nextConsoleNumber(tx, "credit_note", on);
        throw new Error("insert failed");
      }),
    ).rejects.toThrow("insert failed");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consoleDb.transaction((tx) => nextConsoleNumber(tx, "credit_note", on)),
      ),
    );
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    // The credit note of the first test took 1.
    expect(sequences).toEqual(Array.from({ length: 12 }, (_, i) => i + 2));
    const { rows } = await consoleDb.execute<{ n: number }>(
      sql`select last_value as n from console.document_sequence where doc_type = 'credit_note' and year = ${year}`,
    );
    expect(rows[0]?.n).toBe(13);
  });
});
