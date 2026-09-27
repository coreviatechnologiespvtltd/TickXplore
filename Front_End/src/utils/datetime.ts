/**
 * Timezone helpers for the app timezone (Asia/Kathmandu).
 *
 * The API stores instants in UTC. A Kathmandu wall-clock time is therefore
 * `UTC+05:45` all year round — Nepal has never observed DST — so a fixed offset
 * is exact here and avoids the drift you get from `toLocaleString` in whatever
 * zone the user's browser happens to be in.
 *
 * This file mirrors `Back_End/utils/datetime.js`; both sides must format
 * identically or a customer sees one take-off time in the app and another in
 * their inbox.
 */

const TIMEZONE = "Asia/Kathmandu";
const TIMEZONE_LABEL = "Asia/Kathmandu (Nepal Time, UTC+05:45)";
const MINUTE = 60 * 1000;
/** Kathmandu is UTC+05:45. */
const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * MINUTE;
const KATHMANDU_OFFSET_LABEL = "+05:45";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Coerce anything date-like into a `Date`, or `null` if it isn't one. */
export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Wall-clock parts of `value` as seen in Kathmandu. */
function kathmanduParts(value: Date) {
  const shifted = new Date(value.getTime() + KATHMANDU_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * Parse a *naive* local value typed into a form, e.g. "2026-09-27T07:30", and
 * return the instant it represents in Kathmandu.
 *
 * Strings that already carry a zone (`Z`, `+05:45`) are left alone, so echoing a
 * value back through this function never shifts it. `datetime-local` inputs have
 * no zone, and a vendor typing 07:30 means 07:30 in the app timezone — not in
 * whatever zone the server runs in.
 *
 * Returns `null` for input that isn't a usable date.
 */
export function parseTakeoffInput(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return toDate(value);

  const text = String(value).trim();
  if (!text) return null;
  // Already zoned — respect the zone the value states.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return toDate(text);

  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) return toDate(text);

  const [, year, month, day, hours, minutes, seconds] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours || 0),
      Number(minutes || 0),
      Number(seconds || 0)
    ) - KATHMANDU_OFFSET_MS
  );
}

/** `YYYY-MM-DD` for the Kathmandu day `value` falls on. */
export function dateKey(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { year, month, day } = kathmanduParts(date);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Calendar year in Kathmandu — what a booking number is prefixed with. */
export function currentYear(value: Date | string | null | undefined = new Date()): number {
  const date = toDate(value);
  return date ? kathmanduParts(date).year : kathmanduParts(new Date()).year;
}

/** 12-hour clock with a leading zero, e.g. `07:30 AM`, `12:15 AM`. */
function timeLabel(date: Date): string {
  const { hours, minutes } = kathmanduParts(date);
  const suffix = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(h)}:${pad(minutes)} ${suffix}`;
}

function dayLabel(date: Date, withWeekday: boolean): string {
  const { year, month, day, weekday } = kathmanduParts(date);
  const base = `${day} ${MONTHS[month]} ${year}`;
  return withWeekday ? `${WEEKDAYS[weekday]}, ${base}` : base;
}

/** e.g. `27 September 2026`, or `Sun, 27 September 2026` with `withWeekday`. */
export function formatTakeoffDate(
  value: Date | string | null | undefined,
  { withWeekday = false }: { withWeekday?: boolean } = {}
): string {
  const date = toDate(value);
  return date ? dayLabel(date, withWeekday) : "N/A";
}

/** e.g. `07:30 AM`. */
export function formatTakeoffTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? timeLabel(date) : "N/A";
}

/** e.g. `27 September 2026, 07:30 AM`. */
export function formatTakeoffDateTime(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? `${dayLabel(date, false)}, ${timeLabel(date)}` : "N/A";
}

/**
 * Value for an `<input type="datetime-local">`, e.g. `2026-09-27T07:30`.
 *
 * Uses the same offset maths as `parseTakeoffInput`, so pre-filling a form and
 * submitting it round-trips to the identical instant. `toISOString()` must not
 * be used here — it shifts the value by the browser's offset.
 */
export function toDateTimeLocalValue(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "";
  const { year, month, day, hours, minutes } = kathmanduParts(date);
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}`;
}

/** True when the two values land on the same Kathmandu calendar day. */
export function isSameDay(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined
): boolean {
  const keyA = dateKey(a);
  return Boolean(keyA) && keyA === dateKey(b);
}

export { TIMEZONE, TIMEZONE_LABEL, KATHMANDU_OFFSET_LABEL };
