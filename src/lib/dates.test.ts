import { describe, expect, it } from "vitest";

import {
  addMonths,
  formatDate,
  formatDateTime,
  fromAlgiersDateTime,
  toAlgiersDateTimeInput,
  toCalendarDate,
  todayInAlgiers,
  yearInAlgiers,
} from "./dates";

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

  it("converts datetime-local values typed in Algiers time", () => {
    const instant = fromAlgiersDateTime("2026-10-02T10:30");
    expect(instant?.toISOString()).toBe("2026-10-02T09:30:00.000Z");
    expect(toAlgiersDateTimeInput(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01T00:30");
    expect(fromAlgiersDateTime("2026-02-30T10:00")).toBeNull();
    expect(fromAlgiersDateTime("2026-10-02 10:30")).toBeNull();
  });

  it("adds months to calendar dates, clamping to the month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });
});
