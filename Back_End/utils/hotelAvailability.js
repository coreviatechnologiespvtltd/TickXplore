const mongoose = require("mongoose");
const RoomAvailability = require("../models/RoomAvailability");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const { ApiError } = require("./http");

/**
 * Availability engine.
 * ------------------------------------------------------------------
 * Effective free rooms for a night is the *minimum* of:
 *   1. hotel-wide block        -> 0
 *   2. room-type block         -> 0
 *   3. nightly inventory       -> max(0, (availableCount ?? totalRooms) - bookedCount)
 *
 * Because a block always wins, closing a date range can never be bypassed by
 * writing availability counts afterwards.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_NIGHTS = 730;

/** Nights at index 5 (Fri) and 6 (Sat) carry the weekend price. */
const WEEKEND_DAYS = new Set([5, 6]);

/* ------------------------------- date helpers ------------------------------- */

/** Normalise any date-ish value to 00:00:00 UTC of its calendar day. */
const normalizeDate = (value, label = "date") => {
  if (value === undefined || value === null || value === "") {
    throw new ApiError(400, `"${label}" is required.`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `"${label}" is not a valid date.`);
  }
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
};

/** `YYYY-MM-DD` — the key used in API responses and query matching. */
const toDateKey = (date) => new Date(date).toISOString().slice(0, 10);

const todayUTC = () => normalizeDate(new Date(), "today");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Expand an inclusive start / exclusive end stay range into one entry per night.
 * The check-out date is never a night, so a 2-night stay from the 5th yields
 * nights for the 5th and 6th only.
 */
const eachNight = (from, to) => {
  const nights = [];
  let cursor = new Date(from).getTime();
  const end = new Date(to).getTime();

  if (end <= cursor) return nights;

  while (cursor < end) {
    nights.push(new Date(cursor));
    cursor += MS_PER_DAY;
  }
  return nights;
};

/**
 * Validate a stay range and return its normalised form.
 *
 * @param {unknown} from check-in
 * @param {unknown} to check-out (exclusive)
 * @param {{maxNights?: number, allowPast?: boolean, minNights?: number,
 *          labels?: {from?: string, to?: string}}} [options]
 *        `allowPast` is only enabled for read-only calendar views; anything that
 *        writes inventory rejects past dates.
 *        `labels` names the two inputs in error messages, so a route reading
 *        `?from=&to=` does not tell the caller to send `checkIn`/`checkOut`.
 */
const validateStayRange = (from, to, options = {}) => {
  const { maxNights = MAX_RANGE_NIGHTS, allowPast = false, minNights = 1 } = options;
  const fromLabel = options.labels?.from || "checkIn";
  const toLabel = options.labels?.to || "checkOut";

  const start = normalizeDate(from, fromLabel);
  const end = normalizeDate(to, toLabel);

  if (end <= start) {
    throw new ApiError(400, `"${toLabel}" must be at least one night after "${fromLabel}".`);
  }

  const nights = eachNight(start, end);

  if (nights.length < minNights) {
    throw new ApiError(400, `A stay must be at least ${minNights} night(s) long.`);
  }
  if (nights.length > maxNights) {
    throw new ApiError(400, `A stay may not exceed ${maxNights} nights.`);
  }

  if (!allowPast && start < todayUTC()) {
    throw new ApiError(400, 'Dates in the past cannot be managed. Use a date from today onwards.');
  }

  return { from: start, to: end, nights, nightCount: nights.length };
};

/* -------------------------------- pricing -------------------------------- */

/** Price for a single night of a room type, honouring every override. */
const nightPrice = (room, night, availabilityRow) => {
  const pricing = room.pricing || {};
  const base = pricing.basePrice ?? 0;

  // 1. explicit per-night override
  if (availabilityRow?.priceOverride != null) return availabilityRow.priceOverride;

  const timestamp = new Date(night).getTime();

  // 2. matching seasonal window
  const seasonal = (pricing.seasonalRates || []).find(
    (rate) =>
      rate.startDate &&
      rate.endDate &&
      timestamp >= new Date(rate.startDate).setUTCHours(0, 0, 0, 0) &&
      timestamp <= new Date(rate.endDate).setUTCHours(23, 59, 59, 999)
  );
  if (seasonal) return seasonal.price;

  // 3. weekend
  if (WEEKEND_DAYS.has(new Date(night).getUTCDay()) && pricing.weekendPrice != null) {
    return pricing.weekendPrice;
  }

  // 4. flat seasonal fallback, then base
  if (pricing.seasonalPrice != null) return pricing.seasonalPrice;

  return base;
};

/** Effective free rooms for one night given its inventory row + any blocks. */
const effectiveFreeRooms = (room, night, row, hotelWideBlocked, roomBlocked) => {
  if (hotelWideBlocked || roomBlocked) return 0;
  const ceiling = row?.availableCount ?? room.totalRooms ?? 0;
  return Math.max(0, ceiling - (row?.bookedCount ?? 0));
};

/**
 * Resolve per-night availability for a set of rooms over a date range.
 *
 * @param {{hotel: import("mongoose").Document, rooms: import("mongoose").Document[], from: Date, to: Date}} params
 * @returns {Promise<{from: Date, to: Date, nightCount: number, rooms: object[]}>}
 */
const resolveAvailability = async ({ hotel, rooms, from, to }) => {
  const nights = eachNight(from, to);
  const roomIds = rooms.map((room) => room._id);

  if (roomIds.length === 0) {
    return { from, to, nightCount: nights.length, rooms: [] };
  }

  const firstNight = nights[0] || from;
  const lastNight = nights[nights.length - 1] || to;

  // Any block that overlaps the requested window.
  const blocks = await AvailabilityBlock.find({
    hotelId: hotel._id,
    isActive: true,
    startDate: { $lte: lastNight },
    endDate: { $gte: firstNight },
  }).lean();

  const rows = await RoomAvailability.find({
    roomTypeId: { $in: roomIds },
    date: { $gte: firstNight, $lte: lastNight },
  }).lean();

  const rowByRoomAndNight = new Map();
  for (const row of rows) {
    rowByRoomAndNight.set(`${row.roomTypeId}|${toDateKey(row.date)}`, row);
  }

  const isBlocked = (roomId, night) =>
    blocks.some(
      (block) =>
        (block.roomTypeId == null || String(block.roomTypeId) === String(roomId)) &&
        new Date(block.startDate).getTime() <= night.getTime() &&
        new Date(block.endDate).getTime() >= night.getTime()
    );

  const hotelBlockedNights = new Set();
  for (const block of blocks) {
    if (block.roomTypeId != null) continue;
    for (const night of nights) {
      if (
        new Date(block.startDate).getTime() <= night.getTime() &&
        new Date(block.endDate).getTime() >= night.getTime()
      ) {
        hotelBlockedNights.add(toDateKey(night));
      }
    }
  }

  const minStayNights = hotel?.policies?.minStayNights ?? 1;

  const resolved = rooms.map((room) => {
    const nightsPayload = nights.map((night) => {
      const key = toDateKey(night);
      const row = rowByRoomAndNight.get(`${room._id}|${key}`);
      const hotelBlocked = hotelBlockedNights.has(key);
      const roomBlocked = isBlocked(room._id, night) && !hotelBlocked;
      const free = effectiveFreeRooms(room, night, row, hotelBlocked, roomBlocked);

      let nightMinStay = row?.minStayOverride ?? minStayNights;
      const seasonal = (room.pricing?.seasonalRates || []).find(
        (rate) =>
          rate.startDate &&
          rate.endDate &&
          night.getTime() >= new Date(rate.startDate).setUTCHours(0, 0, 0, 0) &&
          night.getTime() <= new Date(rate.endDate).setUTCHours(23, 59, 59, 999)
      );
      if (seasonal?.minStayNights) nightMinStay = seasonal.minStayNights;

      return {
        date: key,
        availableCount: free,
        isHotelBlocked: hotelBlocked,
        isRoomBlocked: roomBlocked,
        isSoldOut: free <= 0,
        minStay: nightMinStay,
        price: nightPrice(room, night, row),
      };
    });

    const minAvailable = nightsPayload.length
      ? nightsPayload.reduce((min, n) => Math.min(min, n.availableCount), Infinity)
      : room.totalRooms ?? 0;

    return {
      roomTypeId: room._id,
      name: room.name,
      totalRooms: room.totalRooms,
      isAvailable: nightsPayload.length > 0 && minAvailable > 0,
      minAvailable: Number.isFinite(minAvailable) ? minAvailable : 0,
      nights: nightsPayload,
    };
  });

  return { from, to, nightCount: nights.length, rooms: resolved };
};

/* ------------------------------ inventory writes ------------------------------ */

/**
 * Overwrite nightly inventory across a date range.
 *
 * Refuses to touch blocked or already-booked nights so a hotel can never
 * accidentally release inventory that a block or a booking depends on.
 *
 * @returns {Promise<{updated: number, from: Date, to: Date, nightCount: number}>}
 */
const setAvailabilityRange = async ({ room, from, to, availableCount, priceOverride, minStayOverride, note }) => {
  const nights = eachNight(from, to);
  if (nights.length === 0) {
    throw new ApiError(400, "The selected range contains no nights.");
  }

  const existing = await RoomAvailability.find({
    roomTypeId: room._id,
    date: { $gte: nights[0], $lte: nights[nights.length - 1] },
  }).lean();

  const existingByKey = new Map(existing.map((row) => [toDateKey(row.date), row]));

  const blocks = await AvailabilityBlock.find({
    hotelId: room.hotelId,
    isActive: true,
    startDate: { $lte: nights[nights.length - 1] },
    endDate: { $gte: nights[0] },
  }).lean();

  const blockedFor = (roomId, night) =>
    blocks.some(
      (block) =>
        (block.roomTypeId == null || String(block.roomTypeId) === String(roomId)) &&
        new Date(block.startDate).getTime() <= night.getTime() &&
        new Date(block.endDate).getTime() >= night.getTime()
    );

  const conflicts = [];
  for (const night of nights) {
    const key = toDateKey(night);
    const row = existingByKey.get(key);

    if (blockedFor(room._id, night)) {
      conflicts.push({ date: key, reason: "blocked" });
      continue;
    }
    if ((row?.bookedCount ?? 0) > 0) {
      conflicts.push({ date: key, reason: "booked", bookedCount: row.bookedCount });
    }
  }

  if (conflicts.length > 0) {
    throw new ApiError(
      409,
      `Cannot change availability for ${conflicts.length} night(s) that are blocked or already booked. Unblock or cancel them first.`,
      { conflicts: conflicts.slice(0, 40) }
    );
  }

  if (availableCount != null) {
    if (availableCount < 0 || availableCount > room.totalRooms) {
      throw new ApiError(
        400,
        `"availableCount" must be between 0 and the room inventory (${room.totalRooms}).`
      );
    }
  }

  const now = new Date();
  const operations = nights.map((night) => {
    const set = { date: night, hotelId: room.hotelId, roomTypeId: room._id, updatedAt: now };

    if (availableCount !== undefined) set.availableCount = availableCount;
    if (priceOverride !== undefined) set.priceOverride = priceOverride;
    if (minStayOverride !== undefined) set.minStayOverride = minStayOverride;
    if (note !== undefined) set.note = note;

    return {
      updateOne: {
        filter: { roomTypeId: room._id, date: night },
        update: {
          $set: set,
          $setOnInsert: { createdAt: now, status: "available", bookedCount: 0 },
        },
        upsert: true,
      },
    };
  });

  const result = await RoomAvailability.bulkWrite(operations, { ordered: false });

  return {
    updated: result.modifiedCount + result.upsertedCount,
    from: nights[0],
    to: new Date(nights[nights.length - 1].getTime() + MS_PER_DAY),
    nightCount: nights.length,
  };
};

/**
 * Atomically commit rooms for a stay.
 * ------------------------------------------------------------------
 * Built now so the future booking flow has a safe primitive: each night's update
 * only matches while `availableCount - bookedCount >= count`, so two concurrent
 * bookings can never both take the last room. If any night fails, the nights
 * already incremented are rolled back (compensating write) so the stay is never
 * partially held.
 *
 * Rows are materialised for the range first (an absent row means "all rooms
 * free"), which keeps the guard expressible as a single `$expr` filter.
 *
 * @param {{room: import("mongoose").Document, nights: Date[], count?: number}} params
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
const commitAvailability = async ({ room, nights, count = 1 }) => {
  if (!room?._id || !Array.isArray(nights) || nights.length === 0) {
    return { ok: false, reason: "invalid_request" };
  }
  if (count < 1 || count > (room.totalRooms ?? 0)) {
    return { ok: false, reason: "invalid_count" };
  }

  const totalRooms = room.totalRooms;
  const now = new Date();

  // Materialise missing rows at full inventory so the guard can be evaluated.
  await RoomAvailability.bulkWrite(
    nights.map((night) => ({
      updateOne: {
        filter: { roomTypeId: room._id, date: night },
        update: {
          $setOnInsert: {
            hotelId: room.hotelId,
            status: "available",
            availableCount: totalRooms,
            bookedCount: 0,
            createdAt: now,
          },
          $set: { updatedAt: now },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  const freeEnough = {
    $gte: [
      {
        $subtract: [
          { $ifNull: ["$availableCount", totalRooms] },
          { $ifNull: ["$bookedCount", 0] },
        ],
      },
      count,
    ],
  };

  const take = (delta) =>
    RoomAvailability.bulkWrite(
      nights.map((night) => ({
        updateOne: {
          filter: { roomTypeId: room._id, date: night, status: { $ne: "blocked" }, $expr: freeEnough },
          update: { $inc: { bookedCount: delta }, $set: { updatedAt: new Date() } },
        },
      })),
      { ordered: true }
    );

  let taken;
  try {
    taken = await take(count);
  } catch (error) {
    return { ok: false, reason: "inventory_exhausted", error: error.message };
  }

  if (taken.modifiedCount !== nights.length) {
    // Compensate the nights that did succeed.
    const overshoot = taken.modifiedCount;
    if (overshoot > 0) await take(-Math.min(overshoot, count));
    return { ok: false, reason: "inventory_exhausted" };
  }

  return { ok: true };
};

module.exports = {
  MS_PER_DAY,
  MAX_RANGE_NIGHTS,
  normalizeDate,
  toDateKey,
  todayUTC,
  isValidObjectId,
  eachNight,
  validateStayRange,
  nightPrice,
  effectiveFreeRooms,
  resolveAvailability,
  setAvailabilityRange,
  commitAvailability,
};
