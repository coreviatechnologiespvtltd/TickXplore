/**
 * Single source of truth for every date/time the platform displays or stores.
 *
 * The application is operated in Nepal, so all take-off (departure) times are
 * interpreted and rendered in `Asia/Kathmandu` (UTC+05:45). Routing every
 * read *and* write through this module is what stops the same stored value from
 * showing up as a different day/hour on the booking page, the dashboards and
 * the emailed ticket.
 */

/** IANA zone used for all displayed and stored take-off times. */
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kathmandu";

/** Nepal has no DST; kept as a fallback for exotic environments. */
const FALLBACK_OFFSET_MINUTES = 345;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/* ------------------------------------------------------------------ */
/* Zone maths                                                         */
/* ------------------------------------------------------------------ */

const zoneFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Offset of APP_TIMEZONE from UTC, in minutes, at the given instant.
 * (Nepal is a fixed +05:45, but this is derived rather than hardcoded so the
 * behaviour stays correct if the configured zone ever has DST rules.)
 */
function offsetMinutesAt(date) {
  try {
    const parts = zoneFormatter.formatToParts(date);
    const read = (type) => {
      const part = parts.find((p) => p.type === type);
      return part ? Number(part.value) : NaN;
    };
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second")
    );
    // Drop sub-second precision from `date` so both sides line up exactly.
    const baseUtc = Math.floor(date.getTime() / 1000) * 1000;
    const offset = (asUtc - baseUtc) / 60000;
    return Number.isFinite(offset) ? offset : FALLBACK_OFFSET_MINUTES;
  } catch {
    return FALLBACK_OFFSET_MINUTES;
  }
}

/** Parse anything date-ish into a valid Date, or null. */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calendar fields of `value` as seen in APP_TIMEZONE.
 * This is what makes an instant render identically everywhere in the app.
 */
function zonedParts(value) {
  const date = toDate(value);
  if (!date) return null;

  const shifted = new Date(date.getTime() + offsetMinutesAt(date) * 60000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    weekday: shifted.getUTCDay(),
    monthName: MONTH_NAMES[shifted.getUTCMonth()],
    weekdayName: WEEKDAY_NAMES[shifted.getUTCDay()],
  };
}

/* ------------------------------------------------------------------ */
/* Write path — interpret operator input as Kathmandu wall-clock time   */
/* ------------------------------------------------------------------ */

const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const NAIVE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// A trailing Z or ±HH:MM means the caller already told us the zone.
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Convert a wall-clock reading in APP_TIMEZONE to the real UTC instant.
 * Run twice so an offset boundary (e.g. a DST zone) still lands correctly.
 */
function zonedWallClockToDate(year, month, day, hour, minute, second) {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  let offset = offsetMinutesAt(new Date(naiveUtc));
  let instant = naiveUtc - offset * 60000;
  offset = offsetMinutesAt(new Date(instant));
  instant = naiveUtc - offset * 60000;
  return new Date(instant);
}

/**
 * Normalise a take-off value coming from a form or a client into a real Date.
 *
 * - `Date` / epoch / ISO-with-zone values already denote an instant: passthrough.
 * - Zone-less values ("2026-09-27T07:30", "2026-09-27 07:30:00", "2026-09-27")
 *   are read as APP_TIMEZONE wall-clock time, so a vendor typing 07:30 gets a
 *   ticket that says 07:30 instead of a server-timezone-dependent value.
 *
 * Returns null for unparseable input so callers can fall back explicitly.
 */
function parseTakeoffInput(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return toDate(value);
  if (typeof value === "number") return toDate(value);

  if (typeof value !== "string") return toDate(value);

  const raw = value.trim();
  if (!raw) return null;

  const dateOnly = NAIVE_DATE.exec(raw);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return zonedWallClockToDate(Number(y), Number(mo), Number(d), 0, 0, 0);
  }

  const naive = NAIVE_DATETIME.exec(raw);
  if (naive && !EXPLICIT_ZONE.test(raw)) {
    const [, y, mo, d, h, mi, s] = naive;
    return zonedWallClockToDate(
      Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s || 0)
    );
  }

  return toDate(raw);
}

/* ------------------------------------------------------------------ */
/* Read path — deterministic display strings                            */
/* ------------------------------------------------------------------ */

const pad2 = (n) => String(n).padStart(2, "0");

/** "27 September 2026" (or "Sun, 27 September 2026" with `withWeekday`). */
function formatTakeoffDate(value, { withWeekday = false } = {}) {
  const parts = zonedParts(value);
  if (!parts) return "N/A";
  const base = `${parts.day} ${parts.monthName} ${parts.year}`;
  return withWeekday ? `${parts.weekdayName.slice(0, 3)}, ${base}` : base;
}

/** "07:30 AM" */
function formatTakeoffTime(value) {
  const parts = zonedParts(value);
  if (!parts) return "N/A";
  const suffix = parts.hour < 12 ? "AM" : "PM";
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${pad2(hour12)}:${pad2(parts.minute)} ${suffix}`;
}

/** "2026-09-27" — the calendar day in APP_TIMEZONE. */
function dateKey(value) {
  const parts = zonedParts(value);
  if (!parts) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** "2026-09-27T07:30" — value for an `<input type="datetime-local">`. */
function toDateTimeLocalValue(value) {
  const parts = zonedParts(value);
  if (!parts) return "";
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** Current calendar year in APP_TIMEZONE — drives the booking-number prefix. */
function currentYear(value = new Date()) {
  const parts = zonedParts(value);
  return parts ? parts.year : new Date().getFullYear();
}

/**
 * The last millisecond of the APP_TIMEZONE day that `value` falls on.
 *
 * Used to close out a day-long reservation window. `setHours()` would do this
 * in the *server's* zone, which silently stretches or clips the window by
 * however far the server sits from Kathmandu.
 */
function endOfTakeoffDay(value) {
  const date = toDate(value);
  const parts = zonedParts(date);
  if (!date || !parts) return null;
  const nextDayStart = Date.UTC(parts.year, parts.month - 1, parts.day + 1);
  return new Date(nextDayStart - offsetMinutesAt(date) * 60 * 1000 - 1);
}

/** "2026-09-27, 07:30 AM" — combined, for compact list views. */
function formatTakeoffDateTime(value) {
  const parts = zonedParts(value);
  if (!parts) return "N/A";
  return `${formatTakeoffDate(value)}, ${formatTakeoffTime(value)}`;
}

module.exports = {
  APP_TIMEZONE,
  toDate,
  zonedParts,
  parseTakeoffInput,
  formatTakeoffDate,
  formatTakeoffTime,
  formatTakeoffDateTime,
  dateKey,
  toDateTimeLocalValue,
  currentYear,
  endOfTakeoffDay,
};
