const RoomType = require("../models/RoomType");
const RoomAvailability = require("../models/RoomAvailability");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const { ok, ApiError, asyncHandler } = require("../utils/http");
const {
  validateStayRange,
  resolveAvailability,
  setAvailabilityRange,
  normalizeDate,
  isValidObjectId,
  todayUTC,
  eachNight,
  toDateKey,
} = require("../utils/hotelAvailability");

/**
 * Hotel dashboard — availability calendar and date blocking.
 * ------------------------------------------------------------------
 * `setAvailabilityRange` in `utils/hotelAvailability` owns the inventory
 * guarantees (unique room-night, 0 <= availableCount <= totalRooms, refusal to
 * touch blocked/booked nights); this module is the HTTP surface over it.
 */

const MAX_CALENDAR_DAYS = 366;

/** The dashboard calendar addresses its window as `?from=&to=`. */
const RANGE_LABELS = { from: "from", to: "to" };

/** GET /api/hotel/availability/calendar */
exports.getCalendar = asyncHandler(async (req, res) => {
  const range = validateStayRange(req.query.from, req.query.to, {
    maxNights: MAX_CALENDAR_DAYS,
    allowPast: true,
    labels: RANGE_LABELS,
  });

  const rooms = await RoomType.find({
    hotelId: req.user._id,
    isArchived: false,
    isActive: true,
  }).sort({ createdAt: 1 });

  const [resolved, blocks, overrides] = await Promise.all([
    resolveAvailability({ hotel: req.hotel, rooms, from: range.from, to: range.to }),
    AvailabilityBlock.find({
      hotelId: req.user._id,
      isActive: true,
      startDate: { $lte: range.nights[range.nights.length - 1] },
      endDate: { $gte: range.from },
    })
      .sort({ startDate: 1 })
      .lean(),
    RoomAvailability.find({
      hotelId: req.user._id,
      date: { $gte: range.from, $lte: range.nights[range.nights.length - 1] },
    })
      .select("roomTypeId date availableCount bookedCount status priceOverride minStayOverride")
      .lean(),
  ]);

  // Roll the per-room nights up into one hotel-wide view per night.
  const byNight = new Map();
  for (const room of resolved.rooms) {
    for (const night of room.nights) {
      const entry = byNight.get(night.date) || {
        date: night.date,
        available: 0,
        total: 0,
        isHotelBlocked: night.isHotelBlocked,
        soldOutRoomTypes: 0,
      };
      entry.total += room.totalRooms;
      if (night.isSoldOut) entry.soldOutRoomTypes += 1;
      else entry.available += night.availableCount;
      if (night.isHotelBlocked) entry.isHotelBlocked = true;
      byNight.set(night.date, entry);
    }
  }

  return ok(res, {
    range: { from: range.from, to: range.to, nightCount: range.nightCount },
    policy: {
      checkInTime: req.hotel.policies.checkInTime,
      checkOutTime: req.hotel.policies.checkOutTime,
      minStayNights: req.hotel.policies.minStayNights,
      maxStayNights: req.hotel.policies.maxStayNights,
    },
    hotel: resolved.rooms.map((room) => ({
      roomTypeId: room.roomTypeId,
      name: room.name,
      totalRooms: room.totalRooms,
      isAvailable: room.isAvailable,
      minAvailable: room.minAvailable,
    })),
    calendar: [...byNight.values()].sort((a, b) => a.date.localeCompare(b.date)),
    blocks: blocks.map((block) => ({
      _id: block._id,
      roomTypeId: block.roomTypeId,
      scope: block.roomTypeId ? "room" : "hotel",
      startDate: toDateKey(block.startDate),
      endDate: toDateKey(block.endDate),
      reason: block.reason,
      isActive: block.isActive,
      source: block.source,
    })),
    overrides: overrides.map((row) => ({
      roomTypeId: row.roomTypeId,
      date: toDateKey(row.date),
      availableCount: row.availableCount,
      bookedCount: row.bookedCount,
      status: row.status,
      priceOverride: row.priceOverride,
      minStayOverride: row.minStayOverride,
    })),
  });
});

/* ============================== inventory ============================== */

/** PUT /api/hotel/rooms/:roomId/availability */
exports.setAvailability = asyncHandler(async (req, res) => {
  const room = req.room;
  const range = validateStayRange(req.query.from, req.query.to, {
    maxNights: MAX_CALENDAR_DAYS,
    labels: RANGE_LABELS,
  });

  const result = await setAvailabilityRange({
    room,
    from: range.from,
    to: range.to,
    availableCount: req.body.availableCount === undefined ? undefined : Number(req.body.availableCount),
    priceOverride: req.body.priceOverride === undefined ? undefined : Number(req.body.priceOverride),
    minStayOverride: req.body.minStayOverride === undefined ? undefined : Number(req.body.minStayOverride),
    note: req.body.note,
  });

  return ok(res, {
    message: `Availability updated for ${result.nightCount} night(s).`,
    room: { _id: room._id, name: room.name, totalRooms: room.totalRooms },
    ...result,
  });
});

/* ================================ blocks ================================ */

/** GET /api/hotel/availability/blocks */
exports.getBlocks = asyncHandler(async (req, res) => {
  const filter = { hotelId: req.user._id };
  if (req.query.isActive === "true") filter.isActive = true;
  if (req.query.isActive === "false") filter.isActive = false;

  const blocks = await AvailabilityBlock.find(filter)
    .sort({ startDate: -1 })
    .limit(200)
    .populate("roomTypeId", "name")
    .lean();

  return ok(res, {
    blocks: blocks.map((block) => ({
      _id: block._id,
      roomTypeId: block.roomTypeId?._id || null,
      scope: block.roomTypeId ? "room" : "hotel",
      roomName: block.roomTypeId?.name || null,
      startDate: toDateKey(block.startDate),
      endDate: toDateKey(block.endDate),
      reason: block.reason,
      isActive: block.isActive,
      source: block.source,
      createdAt: block.createdAt,
    })),
  });
});

/** POST /api/hotel/availability/blocks */
exports.createBlock = asyncHandler(async (req, res) => {
  const hotelId = req.user._id;
  const { startDate, endDate, reason, roomTypeId } = req.body;

  const start = normalizeDate(startDate, "startDate");
  const end = normalizeDate(endDate, "endDate");
  const today = todayUTC();

  if (end < start) throw new ApiError(400, '"endDate" cannot be earlier than "startDate".');
  if (start < today) {
    throw new ApiError(400, 'Blocks cannot start in the past. Use a date from today onwards.');
  }
  if (eachNight(start, new Date(end.getTime() + 86400000)).length > MAX_CALENDAR_DAYS) {
    throw new ApiError(400, `A block may not exceed ${MAX_CALENDAR_DAYS} nights.`);
  }

  // The target room must belong to this hotel.
  if (roomTypeId) {
    if (!isValidObjectId(roomTypeId)) throw new ApiError(400, "Invalid roomTypeId.");
    const room = await RoomType.findOne({ _id: roomTypeId, hotelId }).select("_id").lean();
    if (!room) throw new ApiError(404, "Room not found");
  }

  // Refuse an exact duplicate of an existing active block.
  const duplicate = await AvailabilityBlock.findOne({
    hotelId,
    roomTypeId: roomTypeId || null,
    startDate: start,
    endDate: end,
    isActive: true,
  }).lean();
  if (duplicate) {
    throw new ApiError(409, "These dates are already blocked.", { blockId: duplicate._id });
  }

  const block = await AvailabilityBlock.create({
    hotelId,
    roomTypeId: roomTypeId || null,
    startDate: start,
    endDate: end,
    reason: reason ? String(reason).trim().slice(0, 500) : "",
    isActive: true,
    source: "hotel",
    createdBy: hotelId,
  });

  return ok(
    res,
    {
      message: "Dates blocked.",
      block: {
        _id: block._id,
        roomTypeId: block.roomTypeId,
        scope: block.roomTypeId ? "room" : "hotel",
        startDate: toDateKey(block.startDate),
        endDate: toDateKey(block.endDate),
        reason: block.reason,
        isActive: block.isActive,
      },
    },
    201
  );
});

/** PUT /api/hotel/availability/blocks/:blockId */
exports.updateBlock = asyncHandler(async (req, res) => {
  const block = req.block;
  const { startDate, endDate, reason, isActive } = req.body;

  if (startDate !== undefined) block.startDate = normalizeDate(startDate, "startDate");
  if (endDate !== undefined) block.endDate = normalizeDate(endDate, "endDate");
  if (reason !== undefined) block.reason = String(reason).trim().slice(0, 500);
  if (isActive !== undefined) block.isActive = isActive === true || isActive === "true";

  if (block.endDate < block.startDate) {
    throw new ApiError(400, '"endDate" cannot be earlier than "startDate".');
  }

  await block.save();

  return ok(res, {
    message: block.isActive ? "Block updated." : "Dates unblocked.",
    block: {
      _id: block._id,
      roomTypeId: block.roomTypeId,
      scope: block.roomTypeId ? "room" : "hotel",
      startDate: toDateKey(block.startDate),
      endDate: toDateKey(block.endDate),
      reason: block.reason,
      isActive: block.isActive,
    },
  });
});

/** PUT /api/hotel/availability/blocks/:blockId/unblock */
exports.unblock = asyncHandler(async (req, res) => {
  const block = req.block;

  if (!block.isActive) throw new ApiError(409, "This block is already inactive.");

  const nights = eachNight(block.startDate, new Date(block.endDate.getTime() + 86400000));
  const today = todayUTC();
  const upcoming = nights.filter((night) => night >= today);

  const committed = await RoomAvailability.countDocuments({
    hotelId: req.user._id,
    date: { $in: upcoming },
    $or: [{ bookedCount: { $gt: 0 } }, { status: "blocked" }],
  });

  block.isActive = false;
  block.reason = block.reason ? `${block.reason} (unblocked)` : "Unblocked";
  await block.save();

  return ok(res, {
    message: "Dates unblocked.",
    blockId: block._id,
    reopenedNights: upcoming.length,
    warning:
      committed > 0
        ? `${committed} night(s) in this range were held back from a previous block and are still marked closed. Clear those overrides to reopen them.`
        : null,
  });
});

/** DELETE /api/hotel/availability/blocks/:blockId */
exports.deleteBlock = asyncHandler(async (req, res) => {
  await req.block.deleteOne();
  return ok(res, { message: "Block deleted." });
});
