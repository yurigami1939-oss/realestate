/**
 * Booking of a residence's common rooms (CLAUDE.md §7 Residence charges, common rooms): the
 * states of a booking and the limits of what residents may book.
 */
export const bookingStatuses = ["requested", "approved", "rejected", "cancelled"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

/** Bookings that hold their slot. */
export const liveBookingStatuses = ["requested", "approved"] as const satisfies BookingStatus[];

/** How far ahead residents book, and how many upcoming bookings one account may hold. */
export const BOOKING_DAYS_AHEAD = 90;
export const BOOKINGS_PER_ACCOUNT = 3;

/** "HH:MM" of a 24-hour day. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minutes since midnight of an "HH:MM" time. */
export const minutesOf = (time: string): number => {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
};
