/**
 * Residence announcements (module 6): vocabulary and state. Isomorphic: shared by the schema,
 * the forms and the services.
 */

export const announcementCategories = ["general", "works", "outage", "meeting", "safety"] as const;
export type AnnouncementCategory = (typeof announcementCategories)[number];

/**
 * draft (being written) → published (notice printed, shown to residents) → archived (withdrawn);
 * a published announcement past its expiry day is `expired` (derived, never stored).
 */
export const announcementStates = ["draft", "published", "expired", "archived"] as const;
export type AnnouncementState = (typeof announcementStates)[number];

export function announcementState(
  announcement: { publishedAt: Date | null; archivedAt: Date | null; expiresOn: string | null },
  today: string,
): AnnouncementState {
  if (!announcement.publishedAt) return "draft";
  if (announcement.archivedAt) return "archived";
  if (announcement.expiresOn && announcement.expiresOn < today) return "expired";
  return "published";
}
