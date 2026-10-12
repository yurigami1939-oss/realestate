import { describe, expect, it } from "vitest";

import { assertLocalDatabase, isDemoReset } from "./guard";

const demoDb = "postgres://realestate_app:secret@db.demo.internal:5432/realestate";

describe("seed and reset guard", () => {
  it("accepts local databases", () => {
    for (const host of ["localhost", "127.0.0.1", "postgres"]) {
      expect(() =>
        assertLocalDatabase(`postgres://app:app@${host}:5433/realestate`, {}),
      ).not.toThrow();
    }
  });

  it("refuses a non-local database without both demo flags", () => {
    expect(() => assertLocalDatabase(demoDb, {})).toThrow(/non-local/);
    expect(() => assertLocalDatabase(demoDb, { DEMO_MODE: "true" })).toThrow(/non-local/);
    expect(() => assertLocalDatabase(demoDb, { DEMO_RESET: "1" })).toThrow(/non-local/);
    expect(() => assertLocalDatabase(demoDb, { DEMO_MODE: "false", DEMO_RESET: "1" })).toThrow();
  });

  it("accepts the demo deployment's database with DEMO_MODE=true and DEMO_RESET=1", () => {
    expect(isDemoReset({ DEMO_MODE: "true", DEMO_RESET: "1" })).toBe(true);
    expect(() => assertLocalDatabase(demoDb, { DEMO_MODE: "true", DEMO_RESET: "1" })).not.toThrow();
  });
});
