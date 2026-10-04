import { describe, expect, it } from "vitest";

import { announcementState } from "./announcements";

describe("announcement state", () => {
  const today = "2026-10-04";
  const published = new Date("2026-10-01T09:00:00Z");
  it("is derived from publication, withdrawal and the expiry day", () => {
    const state = (publishedAt: Date | null, archivedAt: Date | null, expiresOn: string | null) =>
      announcementState({ publishedAt, archivedAt, expiresOn }, today);
    expect(state(null, null, null)).toBe("draft");
    expect(state(published, null, null)).toBe("published");
    // Shown until the end of its last day.
    expect(state(published, null, "2026-10-04")).toBe("published");
    expect(state(published, null, "2026-10-03")).toBe("expired");
    expect(state(published, new Date("2026-10-02T09:00:00Z"), "2026-12-31")).toBe("archived");
  });
});
