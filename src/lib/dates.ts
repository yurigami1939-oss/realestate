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

/** Algeria is UTC+1 all year (no DST since 1981). */
const ALGIERS_OFFSET_MS = 60 * 60 * 1000;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:mm" typed in Algiers time (a datetime-local input) → instant; null if invalid. */
export function fromAlgiersDateTime(value: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(utc);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(utc - ALGIERS_OFFSET_MS);
}

/** Instant → "YYYY-MM-DDTHH:mm" in Algiers time (datetime-local input value). */
export function toAlgiersDateTimeInput(instant: Date): string {
  return new Date(instant.getTime() + ALGIERS_OFFSET_MS).toISOString().slice(0, 16);
}

/** Adds whole months to a calendar date, clamped to the month's last day (31/01 + 1 → 28/02). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const match = CALENDAR_DATE.exec(date);
  if (!match) throw new RangeError(`addMonths: invalid calendar date "${date}"`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const monthIndex = m - 1 + months;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Adds whole days to a calendar date. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!CALENDAR_DATE.test(date)) throw new RangeError(`addDays: invalid calendar date "${date}"`);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
