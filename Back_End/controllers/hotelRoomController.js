const RoomType = require("../models/RoomType");
const RoomAvailability = require("../models/RoomAvailability");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const { ok, ApiError, asyncHandler } = require("../utils/http");
const { assertValidAmenities } = require("../utils/hotelAmenities");
const { resolveAvailability, isValidObjectId, todayUTC, validateStayRange, eachNight } = require("../utils/hotelAvailability");
const { saveImage, removeImage, toArray, ALLOWED_LABEL } = require("../utils/uploadImage");

/**
 * Hotel dashboard — room type inventory.
 * ------------------------------------------------------------------
 * Rooms are always read and written through `hotelId: req.user._id`, either via
 * `loadOwnRoom` (single room) or an explicit filter (lists), so a hotel can never
 * touch another hotel's inventory.
 */

const MAX_ROOM_IMAGES = 8;

/** Normalise the `beds` field, which may arrive as JSON from multipart forms. */
const parseBeds = (input) => {
  if (input === undefined) return undefined;
  if (input === null || input === "") return [];

  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new ApiError(400, '"beds" must be a JSON array such as [{"type":"king","count":1}].');
    }
  }
  if (!Array.isArray(raw)) {
    throw new ApiError(400, '"beds" must be an array of { type, count } entries.');
  }

  return raw.map((bed, index) => {
    const type = bed?.type;
    const count = bed?.count === undefined ? 1 : Number(bed.count);
    if (!type || !Number.isInteger(count) || count < 1 || count > 20) {
      throw new ApiError(400, `"beds[${index}]" needs a "type" and a "count" between 1 and 20.`);
    }
    return { type, count };
  });
};

/** Normalise the `pricing` field, coercing numeric strings from form data. */
const parsePricing = (input) => {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new ApiError(400, '"pricing" must be an object.');
    }
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, '"pricing" must be an object.');
  }

  const numeric = [
    "basePrice",
    "weekendPrice",
    "seasonalPrice",
    "extraGuestPrice",
    "childPrice",
    "discountPercent",
    "discountAmount",
    "taxPercent",
    "serviceFeePercent",
  ];

  const pricing = { ...input };
  for (const key of numeric) {
    if (pricing[key] === undefined) continue;
    if (pricing[key] === null || pricing[key] === "") {
      delete pricing[key];
      continue;
    }
    pricing[key] = Number(pricing[key]);
  }

  if (Array.isArray(pricing.seasonalRates)) {
    pricing.seasonalRates = pricing.seasonalRates
      .filter((rate) => rate && rate.startDate && rate.endDate && rate.price !== undefined)
      .map((rate) => ({
        name: rate.name ? String(rate.name).trim().slice(0, 100) : "",
        startDate: new Date(rate.startDate),
        endDate: new Date(rate.endDate),
        price: Number(rate.price),
        minStayNights: rate.minStayNights ? Number(rate.minStayNights) : null,
      }));
  } else {
    delete pricing.seasonalRates;
  }

  return pricing;
};

const syncRoomCover = (images) => images.find((image) => image.isCover) || images[0] || null;

const roomPayload = (room) => ({
  ...room.toJSON(),
  coverImage: syncRoomCover(room.images || [])?.url || "",
  bedCount: (room.beds || []).reduce((sum, bed) => sum + bed.count, 0),
});

/** Reject a room name already used by a non-archived room of this hotel. */
const assertNameAvailable = async (hotelId, name, excludeId = null) => {
  const filter = { hotelId, name, isArchived: false };
  if (excludeId) filter._id = { $ne: excludeId };

  const clash = await RoomType.findOne(filter).select("_id name").lean();
  if (clash) {
    throw new ApiError(409, `You already have a room type named "${name}". Room names must be unique.`, {
      conflictingRoomId: clash._id,
    });
  }
};

/* ================================= list ================================= */

/** GET /api/hotel/rooms */
exports.getRooms = asyncHandler(async (req, res) => {
  const { includeArchived, isActive, search } = req.query;

  const filter = { hotelId: req.user._id };
  if (includeArchived !== "true") filter.isArchived = false;
  if (isActive === "true") filter.isActive = true;
  if (isActive === "false") filter.isActive = false;
  if (search) filter.name = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const rooms = await RoomType.find(filter).sort({ createdAt: 1 });

  return ok(res, { rooms: rooms.map(roomPayload), count: rooms.length });
});

/** GET /api/hotel/rooms/:roomId */
exports.getRoom = asyncHandler(async (req, res) => {
  return ok(res, { room: roomPayload(req.room) });
});

/* ================================ create ================================ */

/** POST /api/hotel/rooms */
exports.createRoom = asyncHandler(async (req, res) => {
  const hotelId = req.user._id;
  const body = req.body;

  const name = String(body.name || "").trim();
  const pricing = parsePricing(body.pricing);
  if (!pricing || pricing.basePrice === undefined) {
    throw new ApiError(400, '"pricing.basePrice" is required.');
  }

  await assertNameAvailable(hotelId, name);

  const room = new RoomType({
    hotelId,
    name,
    description: body.description,
    type: body.type,
    totalRooms: body.totalRooms,
    maxGuests: body.maxGuests,
    maxAdults: body.maxAdults ?? null,
    maxChildren: body.maxChildren ?? 0,
    bedrooms: body.bedrooms ?? 1,
    bathrooms: body.bathrooms ?? 1,
    attachedBathrooms: body.attachedBathrooms ?? 0,
    sizeSqm: body.sizeSqm ?? null,
    beds: parseBeds(body.beds) ?? [],
    pricing,
    amenities: body.amenities !== undefined ? assertValidAmenities(body.amenities, "room") : [],
    isActive: body.isActive !== undefined ? body.isActive : true,
  });

  await room.save(); // schema-level cross-field rules (beds vs capacity, etc.)

  return ok(res, { message: "Room type created successfully.", room: roomPayload(room) }, 201);
});

/* ================================ update ================================ */

/** PUT /api/hotel/rooms/:roomId */
exports.updateRoom = asyncHandler(async (req, res) => {
  const room = req.room;
  const body = req.body;

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name !== room.name) await assertNameAvailable(room.hotelId, name, room._id);
    room.name = name;
  }

  for (const key of [
    "description",
    "type",
    "totalRooms",
    "maxGuests",
    "maxAdults",
    "maxChildren",
    "bedrooms",
    "bathrooms",
    "attachedBathrooms",
    "sizeSqm",
    "isActive",
  ]) {
    if (body[key] !== undefined) room[key] = body[key];
  }

  const beds = parseBeds(body.beds);
  if (beds !== undefined) room.beds = beds;

  const pricing = parsePricing(body.pricing);
  if (pricing !== undefined) room.pricing = { ...room.pricing.toObject(), ...pricing };

  if (body.amenities !== undefined) {
    room.amenities = assertValidAmenities(body.amenities, "room");
  }

  // Inventory may never drop below what is already committed or explicitly set.
  if (body.totalRooms !== undefined && Number(body.totalRooms) < room.totalRooms) {
    const committed = await RoomAvailability.aggregate([
      { $match: { roomTypeId: room._id } },
      {
        $group: {
          _id: null,
          maxAvailable: { $max: "$availableCount" },
          maxBooked: { $max: "$bookedCount" },
        },
      },
    ]);
    const needed = Math.max(committed[0]?.maxAvailable ?? 0, committed[0]?.maxBooked ?? 0);
    if (Number(body.totalRooms) < needed) {
      throw new ApiError(
        409,
        `Inventory cannot be reduced to ${body.totalRooms} because nights already reference up to ${needed} room(s). Adjust those dates first.`
      );
    }
  }

  await room.save();

  return ok(res, { message: "Room type updated successfully.", room: roomPayload(room) });
});

/** PUT /api/hotel/rooms/:roomId/pricing */
exports.updatePricing = asyncHandler(async (req, res) => {
  const room = req.room;
  const pricing = parsePricing({ ...room.pricing.toObject(), ...req.body });

  if (pricing.basePrice === undefined) {
    throw new ApiError(400, '"pricing.basePrice" is required.');
  }

  room.pricing = pricing;
  await room.save();

  return ok(res, { message: "Room pricing updated successfully.", pricing: room.pricing });
});

/** PUT /api/hotel/rooms/:roomId/amenities */
exports.setRoomAmenities = asyncHandler(async (req, res) => {
  const room = req.room;
  room.amenities = assertValidAmenities(req.body.amenities, "room");
  await room.save();
  return ok(res, { message: "Room amenities updated.", amenities: room.amenities });
});

/* ================================ images ================================ */

/** POST /api/hotel/rooms/:roomId/images */
exports.uploadRoomImages = asyncHandler(async (req, res) => {
  const room = req.room;

  const files = [...toArray(req.files?.images), ...toArray(req.files?.image)];
  if (files.length === 0) {
    throw new ApiError(400, `Attach at least one image under the "images" field. Allowed types: ${ALLOWED_LABEL}.`);
  }
  if ((room.images?.length || 0) + files.length > MAX_ROOM_IMAGES) {
    throw new ApiError(400, `A room can have at most ${MAX_ROOM_IMAGES} images.`);
  }

  for (const file of files) {
    room.images.push({
      url: await saveImage(file, "room"),
      caption: "",
      order: room.images.length,
      isCover: false,
    });
  }

  if (!syncRoomCover(room.images)) {
    room.images[0].isCover = true;
  }

  await room.save();

  return ok(res, { message: "Room images uploaded successfully.", room: roomPayload(room) }, 201);
});

/** DELETE /api/hotel/rooms/:roomId/images/:imageId */
exports.deleteRoomImage = asyncHandler(async (req, res) => {
  const room = req.room;
  const { imageId } = req.params;

  if (!isValidObjectId(imageId)) throw new ApiError(404, "Image not found");

  const image = room.images.id(imageId);
  if (!image) throw new ApiError(404, "Image not found");

  const removedUrl = image.url;
  room.images.pull(imageId);
  if (!room.images.find((img) => img.isCover) && room.images.length > 0) {
    room.images[0].isCover = true;
  }
  await room.save();

  const stillReferenced = await RoomType.exists({ _id: { $ne: room._id }, "images.url": removedUrl });
  if (!stillReferenced) removeImage(removedUrl);

  return ok(res, { message: "Room image removed.", room: roomPayload(room) });
});

/** PUT /api/hotel/rooms/:roomId/images/:imageId/cover */
exports.setRoomCover = asyncHandler(async (req, res) => {
  const room = req.room;
  const { imageId } = req.params;

  const image = room.images.id(imageId);
  if (!image) throw new ApiError(404, "Image not found");

  room.images.forEach((img) => {
    img.isCover = String(img._id) === String(image._id);
  });
  await room.save();

  return ok(res, { message: "Room cover image updated.", room: roomPayload(room) });
});

/* ============================ archive / delete ============================ */

/** DELETE /api/hotel/rooms/:roomId — soft-archives; hard-deletes when never used. */
exports.deleteRoom = asyncHandler(async (req, res) => {
  const room = req.room;
  const force = ["1", "true", "yes"].includes(String(req.query.force).toLowerCase());

  const [committedNights, activeBlocks] = await Promise.all([
    RoomAvailability.countDocuments({ roomTypeId: room._id, $or: [{ bookedCount: { $gt: 0 } }, { availableCount: { $ne: null } }] }),
    AvailabilityBlock.countDocuments({ roomTypeId: room._id, isActive: true }),
  ]);

  const hasHistory = committedNights > 0 || activeBlocks > 0;

  if (force && !hasHistory) {
    await RoomAvailability.deleteMany({ roomTypeId: room._id });
    await room.deleteOne();
    return ok(res, { message: "Room type permanently deleted." });
  }

  if (force && hasHistory) {
    throw new ApiError(
      409,
      "This room has availability or booking history and cannot be permanently deleted. It has been archived instead."
    );
  }

  room.isArchived = true;
  room.isActive = false;
  room.archivedAt = todayUTC();
  await room.save();

  // Closing the room removes any active blocks so the room cannot silently
  // keep hiding other room types via a hotel-wide rollup.
  await AvailabilityBlock.updateMany(
    { roomTypeId: room._id, isActive: true },
    { $set: { isActive: false, reason: "Room archived." } }
  );

  return ok(res, {
    message:
      "Room type archived. It is hidden from the dashboard and public site; its history is preserved.",
    room: roomPayload(room),
    permanentlyDeleted: false,
  });
});

/** POST /api/hotel/rooms/:roomId/restore */
exports.restoreRoom = asyncHandler(async (req, res) => {
  const room = req.room;

  if (!room.isArchived) {
    throw new ApiError(409, "This room is not archived.");
  }

  room.isArchived = false;
  room.isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;
  room.archivedAt = undefined;
  await room.save();

  return ok(res, { message: "Room type restored as a draft.", room: roomPayload(room) });
});

/* ============================= availability ============================= */

/** GET /api/hotel/rooms/:roomId/availability */
exports.getRoomAvailability = asyncHandler(async (req, res) => {
  const range = validateStayRange(req.query.from, req.query.to, {
    maxNights: 366,
    allowPast: true,
    labels: { from: "from", to: "to" },
  });

  const resolved = await resolveAvailability({
    hotel: req.hotel,
    rooms: [req.room],
    from: range.from,
    to: range.to,
  });

  const [blocks, overrides] = await Promise.all([
    AvailabilityBlock.find({ roomTypeId: req.room._id }).sort({ startDate: 1 }).lean(),
    RoomAvailability.find({ roomTypeId: req.room._id }).sort({ date: 1 }).lean(),
  ]);

  return ok(res, {
    room: { _id: req.room._id, name: req.room.name, totalRooms: req.room.totalRooms },
    availability: resolved.rooms[0] || null,
    blocks,
    overrides: overrides.map((row) => ({
      date: row.date,
      availableCount: row.availableCount,
      bookedCount: row.bookedCount,
      status: row.status,
      priceOverride: row.priceOverride,
      minStayOverride: row.minStayOverride,
      note: row.note,
    })),
  });
});

/** DELETE /api/hotel/rooms/:roomId/availability — clears manual overrides. */
exports.clearRoomAvailability = asyncHandler(async (req, res) => {
  const { from, to } = validateStayRange(req.query.from, req.query.to, {
    maxNights: 366,
    allowPast: true,
    labels: { from: "from", to: "to" },
  });
  const nights = eachNight(from, to);

  const protectedNights = await RoomAvailability.countDocuments({
    roomTypeId: req.room._id,
    date: { $in: nights },
    $or: [{ bookedCount: { $gt: 0 } }, { status: { $in: ["blocked", "booked"] } }],
  });
  if (protectedNights > 0) {
    throw new ApiError(
      409,
      `${protectedNights} night(s) in this range are blocked or booked and cannot be reset.`
    );
  }

  const result = await RoomAvailability.deleteMany({ roomTypeId: req.room._id, date: { $in: nights } });

  return ok(res, {
    message: `Cleared ${result.deletedCount} availability override(s). These nights revert to full inventory at standard pricing.`,
    cleared: result.deletedCount,
  });
});

module.exports = { ...exports, MAX_ROOM_IMAGES, roomPayload };
