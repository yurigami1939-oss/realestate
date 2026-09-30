import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, toCalendarDate, todayInAlgiers, yearInAlgiers } from "./dates";

describe("Algiers dates", () => {
  it("uses the Algiers day, not UTC (UTC+1, no DST)", () => {
    // 31 Dec 2026 23:30 UTC is already 1 Jan 2027 in Algiers.
    const instant = new Date("2026-12-31T23:30:00Z");
    expect(toCalendarDate(instant)).toBe("2027-01-01");
    expect(yearInAlgiers(instant)).toBe(2027);
    expect(todayInAlgiers(new Date("2026-07-15T22:59:59Z"))).toBe("2026-07-15");
    expect(todayInAlgiers(new Date("2026-07-15T23:00:00Z"))).toBe("2026-07-16");
  });

  it("formats dd/MM/yyyy for calendar dates and instants", () => {
    expect(formatDate("2026-03-09")).toBe("09/03/2026");
    expect(formatDate(new Date("2026-12-31T23:30:00Z"))).toBe("01/01/2027");
    expect(() => formatDate("09/03/2026")).toThrow(RangeError);
  });

  it("formats date-times in Algiers time", () => {
    expect(formatDateTime(new Date("2026-06-01T08:05:00Z"))).toBe("01/06/2026 09:05");
  });
});
