const BookingSequence = require("../models/BookingSequence");
const { currentYear } = require("./datetime");

/**
 * User-facing Booking Number / Ticket Number.
 *
 * Format: <4-digit year><4-digit sequence>, e.g. 20260001, 20260002, ...
 *
 *  - The year comes from the booking's own creation date in Nepal time, so a
 *    booking made at 23:30 on 31 Dec is still that year even when the server's
 *    UTC clock has already rolled over.
 *  - The sequence is a per-year counter advanced by a single atomic `$inc`, so
 *    two users booking at the same instant can never receive the same number.
 *  - A new year starts a fresh counter, so 2027 restarts at 20270001.
 *  - The counter is never derived from a user id, a vehicle id, or
 *    `MAX(bookingNumber) + 1` read-then-write.
 *
 * Numbers issued before the width changed used a 5-digit sequence
 * ("202600001"). Those rows are immutable and stay exactly as they are, so the
 * guards below deliberately accept both widths.
 *
 * The Mongo `_id` remains the internal key; this is the reference a customer
 * quotes to support. Once assigned it is never regenerated.
 */

const SEQUENCE_WIDTH = 4;
const MAX_SEQUENCE = 10 ** SEQUENCE_WIDTH - 1;
const MAX_ATTEMPTS = 8;

/**
 * A number that has already been issued, in either the current 4-digit width or
 * the legacy 5-digit one.
 *
 * This is the "do not touch" guard: a booking holding a number matching this
 * must never be reassigned, whatever width the generator currently produces.
 * Kept in one place so the generator, the floor and the backfill script can
 * never disagree about it.
 */
const ISSUED_NUMBER_RE = /^[0-9]{4}[0-9]{4,5}$/;

/** Matches only numbers in the format this module generates today. */
const activeNumberRe = (year) => new RegExp(`^${year}[0-9]{${SEQUENCE_WIDTH}}$`);

/** True for a number that has already been issued, e.g. "20260001" or "202600001". */
function isBookingNumberFormat(value) {
  return typeof value === "string" && ISSUED_NUMBER_RE.test(value);
}

/** Pure, so the padding can be asserted without touching the database. */
const formatNumber = (year, sequence) =>
  `${year}${String(sequence).padStart(SEQUENCE_WIDTH, "0")}`;

/**
 * Highest sequence already issued for `year` in the active format, so a
 * counter that was reset, wiped or lost can never re-issue a number that
 * bookings already hold.
 *
 * Scoped to the active 4-digit width on purpose. Legacy 5-digit numbers are
 * invisible here, so the counter is free to sit below their high-water mark;
 * that is safe because the generator can only ever emit 4-digit strings, and
 * `isTaken()` plus the unique sparse index would reject a collision anyway.
 * The trade-off is deliberate: support will see a new "20260001" next to the
 * legacy "202600001" (both sequence 1), which are distinct values and never
 * both valid for one booking.
 */
async function highestIssuedSequence(year) {
  const Booking = require("../models/Booking");

  const latest = await Booking.findOne({ bookingNumber: activeNumberRe(year) })
    .sort({ bookingNumber: -1 })
    .select("bookingNumber")
    .lean()
    .catch(() => null);

  if (!latest?.bookingNumber) return 0;
  return Number(latest.bookingNumber.slice(SEQUENCE_WIDTH)) || 0;
}

/**
 * Advance the year's counter and return the new booking number.
 *
 * `$max` only ever raises the counter, so it is idempotent and safe to run
 * concurrently: two callers can never lower each other's floor.
 */
async function nextBookingNumber(date = new Date()) {
  const year = currentYear(date);

  const floor = await highestIssuedSequence(year);
  await BookingSequence.updateOne(
    { _id: String(year) },
    { $max: { seq: floor } },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const counter = await BookingSequence.findOneAndUpdate(
    { _id: String(year) },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const sequence = Number(counter?.seq) || 1;
  if (sequence > MAX_SEQUENCE) {
    throw new Error(`Booking number sequence exhausted for ${year}.`);
  }

  return formatNumber(year, sequence);
}

/** Defence in depth: has this candidate already been handed out? */
async function isTaken(candidate, excludeBookingId) {
  const Booking = require("../models/Booking");
  const query = { bookingNumber: candidate };
  if (excludeBookingId) query._id = { $ne: excludeBookingId };
  return Boolean(await Booking.exists(query));
}

/**
 * Allocate a number guaranteed not to collide with an existing booking. Retries
 * only in the rare case the counter is behind a row written out of band.
 */
async function allocateBookingNumber(date, { excludeBookingId } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = await nextBookingNumber(date);
    if (!(await isTaken(candidate, excludeBookingId))) return candidate;
    lastError = new Error(`Booking number ${candidate} already exists.`);
  }

  throw lastError || new Error("Could not allocate a unique booking number.");
}

/**
 * Backfill a year-prefixed number for a booking whose stored value is missing
 * or still in the legacy "<Item>-<seats>" format.
 *
 * Never overwrites a number that has already been issued, in either the current
 * or the legacy width, so it is safe to re-run and cannot disturb a customer who
 * already holds a ticket.
 */
async function backfillBookingNumber(booking, date) {
  if (isBookingNumberFormat(booking.bookingNumber)) {
    return { changed: false, bookingNumber: booking.bookingNumber, legacy: null };
  }
  const legacy = booking.bookingNumber ?? null;
  const bookingNumber = await allocateBookingNumber(date);
  booking.bookingNumber = bookingNumber;
  return { changed: true, bookingNumber, legacy };
}

module.exports = {
  SEQUENCE_WIDTH,
  MAX_SEQUENCE,
  ISSUED_NUMBER_RE,
  formatNumber,
  isBookingNumberFormat,
  highestIssuedSequence,
  nextBookingNumber,
  allocateBookingNumber,
  backfillBookingNumber,
};
