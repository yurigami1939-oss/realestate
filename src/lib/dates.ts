/**
 * Dates (CLAUDE.md §7 Dates):
 * - instants are `Date` (timestamptz in the DB, UTC);
 * - calendar dates are `CalendarDate` strings "YYYY-MM-DD" (Postgres `date`), meaning an Algiers day.
 * "Today" and document years are always computed in Africa/Algiers, never in server-local time.
 */
export const APP_TIME_ZONE = "Africa/Algiers";

/** "YYYY-MM-DD" */
export type CalendarDate = string;

const isoDateInAlgiers = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Algiers calendar day of an instant. */
export function toCalendarDate(instant: Date): CalendarDate {
  return isoDateInAlgiers.format(instant);
}

export function todayInAlgiers(now: Date = new Date()): CalendarDate {
  return toCalendarDate(now);
}

export function yearInAlgiers(instant: Date): number {
  return Number(toCalendarDate(instant).slice(0, 4));
}

/** dd/MM/yyyy for a calendar date or an instant (shown as its Algiers day), both locales. */
export function formatDate(value: CalendarDate | Date): string {
  const iso = value instanceof Date ? toCalendarDate(value) : value;
  const match = CALENDAR_DATE.exec(iso);
  if (!match) throw new RangeError(`formatDate: invalid calendar date "${iso}"`);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** dd/MM/yyyy HH:mm in Algiers time, same in both locales. */
export function formatDateTime(instant: Date): string {
  const parts = Object.fromEntries(
    dateTimeParts.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}
