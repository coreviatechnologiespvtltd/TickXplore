const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const RoomAvailability = require("../models/RoomAvailability");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const { ok, ApiError, asyncHandler } = require("../utils/http");
const { buildListingSnapshot, selectSubmittableRooms, checkReadiness, hasUnpublishedChanges } = require("../utils/hotelListing");
const { notifyHotel, emailHotel } = require("../utils/hotelNotify");
const { isValidObjectId } = require("../utils/hotelAvailability");

/**
 * Admin moderation for hotel listings.
 * ------------------------------------------------------------------
 * Mirrors the existing vendor approval flow (`approveVendor` / `declineVendor`)
 * but adds the listing state machine, since a hotel's *content* is reviewed
 * separately from its *account activation*.
 */

const listingSummary = (hotel) => ({
  _id: hotel._id,
  hotelId: hotel.hotelId,
  hotelName: hotel.hotelName,
  email: hotel.email,
  phoneNumber: hotel.phoneNumber,
  city: hotel.city,
  address: hotel.address,
  type: hotel.type,
  starRating: hotel.starRating,
  coverImage: hotel.coverImage,
  imageCount: hotel.images?.length || 0,
  amenityCount: hotel.amenities?.length || 0,
  isActive: hotel.isActive,
  applicationStatus: hotel.applicationStatus,
  listingStatus: hotel.listingStatus,
  submittedAt: hotel.statusMeta?.submittedAt,
  publishedAt: hotel.publishedSnapshot?.approvedAt,
  publishedVersion: hotel.publishedSnapshot?.version || 0,
  createdAt: hotel.createdAt,
});

/** GET /admin/hotels */
exports.getAllHotels = asyncHandler(async (req, res) => {
  const { listingStatus, applicationStatus, isActive, city, q } = req.query;

  const filter = {};
  if (listingStatus) filter.listingStatus = listingStatus;
  if (applicationStatus) filter.applicationStatus = applicationStatus;
  if (isActive !== undefined) filter.isActive = isActive === "true" || isActive === true;
  if (city) filter.city = { $regex: String(city), $options: "i" };
  if (q) {
    const pattern = { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ hotelName: pattern }, { email: pattern }, { hotelId: pattern }, { city: pattern }];
  }

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const [hotels, total] = await Promise.all([
    Hotel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Hotel.countDocuments(filter),
  ]);

  return ok(res, {
    hotels: hotels.map((hotel) => listingSummary(hotel)),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

/** GET /admin/hotels/summary — counts per listing status for the moderation UI. */
exports.getStatusSummary = asyncHandler(async (req, res) => {
  const counts = await Hotel.aggregate([{ $group: { _id: "$listingStatus", count: { $sum: 1 } } }]);
  const byStatus = Object.fromEntries(counts.map((entry) => [entry._id, entry.count]));

  return ok(res, {
    byStatus,
    total: counts.reduce((sum, entry) => sum + entry.count, 0),
    pendingAccountActivation: await Hotel.countDocuments({ isActive: false }),
  });
});

/** GET /admin/hotels/pending */
exports.getPendingListings = asyncHandler(async (req, res) => {
  const hotels = await Hotel.find({ listingStatus: "pending_approval" }).sort({ "statusMeta.submittedAt": 1 });

  const withReadiness = await Promise.all(
    hotels.map(async (hotel) => ({
      ...listingSummary(hotel),
      readiness: await checkReadiness(Hotel, RoomType, hotel),
    }))
  );

  return ok(res, { hotels: withReadiness, count: withReadiness.length });
});

/** GET /admin/hotels/:id — full record including unpublished draft content. */
exports.getHotel = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id).select("-password");
  if (!hotel) throw new ApiError(404, "Hotel not found");

  const [rooms, readiness] = await Promise.all([
    RoomType.find({ hotelId: id }).sort({ createdAt: 1 }),
    checkReadiness(Hotel, RoomType, hotel),
  ]);

  return ok(res, {
    hotel: hotel.toJSON(),
    rooms,
    readiness,
    hasUnpublishedChanges: hasUnpublishedChanges(hotel, rooms.filter((room) => !room.isArchived && room.isActive)),
  });
});

/* ============================== moderation ============================== */

/** PUT /admin/hotels/:id/review/approve — pending_approval -> published. */
exports.approveListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  if (hotel.listingStatus !== "pending_approval") {
    throw new ApiError(409, `Only a "pending_approval" listing can be approved (current: ${hotel.listingStatus}).`);
  }

  const rooms = await selectSubmittableRooms(RoomType, hotel._id);
  if (rooms.length === 0) {
    throw new ApiError(422, "This listing has no active room types and cannot be published.");
  }

  // Freeze exactly what the admin is approving, so later edits stay private.
  const snapshot = buildListingSnapshot(hotel, rooms);
  const previous = hotel.listingStatus;

  hotel.listingStatus = "published";
  hotel.publishedSnapshot = {
    version: snapshot.version,
    approvedAt: new Date(),
    approvedBy: req.user._id,
    contentHash: snapshot.contentHash,
    profile: snapshot.profile,
    rooms: snapshot.rooms,
  };
  hotel.statusMeta.reviewedAt = new Date();
  hotel.statusMeta.reviewedBy = req.user._id;
  hotel.statusMeta.rejectionReason = "";
  hotel.statusMeta.suspendedReason = "";
  hotel.statusHistory.push({
    from: previous,
    to: "published",
    reason: req.body?.reason || "Approved by admin.",
    by: req.user._id,
  });
  await hotel.save();

  await notifyHotel(
    hotel,
    `Your listing "${hotel.hotelName}" was approved and is now live on TickXplore.`
  );
  await emailHotel(
    hotel,
    "Your TickXplore hotel listing is now live",
    `<h2>Congratulations!</h2>
     <p>Your listing <strong>${hotel.hotelName}</strong> has been approved and is now visible to customers on TickXplore.</p>
     <p>Any edits you make from now on stay private until you submit them for review again.</p>`
  );

  return ok(res, { message: "Listing approved and published.", hotel: listingSummary(hotel) });
});

/** PUT /admin/hotels/:id/review/reject — pending_approval -> rejected. */
exports.rejectListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reason = req.body.reason;

  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  if (hotel.listingStatus !== "pending_approval") {
    throw new ApiError(409, `Only a "pending_approval" listing can be rejected (current: ${hotel.listingStatus}).`);
  }

  const previous = hotel.listingStatus;
  hotel.listingStatus = "rejected";
  hotel.statusMeta.reviewedAt = new Date();
  hotel.statusMeta.reviewedBy = req.user._id;
  hotel.statusMeta.rejectionReason = reason;
  hotel.statusHistory.push({
    from: previous,
    to: "rejected",
    reason,
    by: req.user._id,
  });
  await hotel.save();

  await notifyHotel(hotel, `Your listing "${hotel.hotelName}" was not approved: ${reason}`);
  await emailHotel(
    hotel,
    "Update on your TickXplore hotel listing",
    `<h2>Hello ${hotel.hotelName || "there"},</h2>
     <p>Thank you for submitting your listing. Our review team could not approve it yet:</p>
     <blockquote>${reason}</blockquote>
     <p>Please update your listing and submit it again whenever you are ready.</p>`
  );

  return ok(res, { message: "Listing rejected.", hotel: listingSummary(hotel), reason });
});

/** PUT /admin/hotels/:id/status/suspend */
exports.suspendListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  if (hotel.listingStatus !== "published") {
    throw new ApiError(409, `Only a "published" listing can be suspended (current: ${hotel.listingStatus}).`);
  }

  const reason = req.body?.reason || "Suspended by admin.";
  hotel.listingStatus = "suspended";
  hotel.statusMeta.suspendedAt = new Date();
  hotel.statusMeta.suspendedReason = reason;
  hotel.statusHistory.push({ from: "published", to: "suspended", reason, by: req.user._id });
  await hotel.save();

  await notifyHotel(hotel, `Your listing "${hotel.hotelName}" has been suspended: ${reason}`);
  await emailHotel(
    hotel,
    "Your TickXplore hotel listing has been suspended",
    `<h2>Hello ${hotel.hotelName || "there"},</h2>
     <p>Your listing has been temporarily removed from TickXplore:</p>
     <blockquote>${reason}</blockquote>
     <p>Please contact support if you believe this is a mistake.</p>`
  );

  return ok(res, { message: "Listing suspended and hidden from the public site.", hotel: listingSummary(hotel) });
});

/** PUT /admin/hotels/:id/status/reinstate */
exports.reinstateListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  if (!["suspended", "rejected"].includes(hotel.listingStatus)) {
    throw new ApiError(409, `Only a suspended or rejected listing can be reinstated (current: ${hotel.listingStatus}).`);
  }
  if (!hotel.publishedSnapshot?.approvedAt) {
    throw new ApiError(409, "This listing has never been approved, so it must be submitted and reviewed first.");
  }

  hotel.listingStatus = "published";
  hotel.statusMeta.suspendedAt = undefined;
  hotel.statusMeta.suspendedReason = "";
  hotel.statusHistory.push({
    from: "suspended",
    to: "published",
    reason: req.body?.reason || "Reinstated by admin.",
    by: req.user._id,
  });
  await hotel.save();

  await notifyHotel(hotel, `Your listing "${hotel.hotelName}" is live again.`);
  return ok(res, { message: "Listing reinstated.", hotel: listingSummary(hotel) });
});

/** PUT /admin/hotels/:id/status/archive */
exports.archiveListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");
  if (hotel.listingStatus === "archived") throw new ApiError(409, "This listing is already archived.");

  const previous = hotel.listingStatus;
  hotel.listingStatus = "archived";
  hotel.statusMeta.archivedAt = new Date();
  hotel.statusHistory.push({
    from: previous,
    to: "archived",
    reason: req.body?.reason || "Archived by admin.",
    by: req.user._id,
  });
  await hotel.save();

  await notifyHotel(hotel, `Your listing "${hotel.hotelName}" has been archived.`);
  return ok(res, { message: "Listing archived.", hotel: listingSummary(hotel) });
});

/* =========================== account activation =========================== */

/** PUT /admin/hotels/:id/activate — the login gate, separate from listing review. */
exports.activateAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  hotel.isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
  hotel.applicationStatus = hotel.isActive ? "approved" : "declined";
  await hotel.save();

  if (hotel.isActive) {
    await emailHotel(
      hotel,
      "Your TickXplore hotel account is now active",
      `<h2>Hello ${hotel.hotelName || "there"},</h2>
       <p>Your hotel account has been approved. You can now sign in and manage your listing.</p>`
    );
  }

  return ok(res, {
    message: hotel.isActive ? "Hotel account activated." : "Hotel account deactivated.",
    hotel: listingSummary(hotel),
  });
});

/* ================================ editing ================================ */

/** PUT /admin/hotels/:id — admin corrections to a hotel profile. */
exports.updateHotel = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  const editable = [
    "hotelName",
    "description",
    "type",
    "starRating",
    "address",
    "area",
    "city",
    "district",
    "country",
    "hotelLocation",
    "amenities",
    "coverImage",
  ];

  for (const key of editable) {
    if (req.body[key] !== undefined) hotel[key] = req.body[key];
  }

  if (req.body.location && Array.isArray(req.body.location.coordinates)) {
    const [lng, lat] = req.body.location.coordinates.map(Number);
    hotel.location = { type: "Point", coordinates: [lng, lat] };
  }

  if (req.body.contact !== undefined) {
    hotel.contact = { ...hotel.contact.toObject(), ...req.body.contact };
  }

  await hotel.save();

  return ok(res, { message: "Hotel updated successfully.", hotel: listingSummary(hotel) });
});

/** DELETE /admin/hotels/:id — blocks the account if the listing has history. */
exports.deleteHotel = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findById(id);
  if (!hotel) throw new ApiError(404, "Hotel not found");

  const [roomCount, committedNights] = await Promise.all([
    RoomType.countDocuments({ hotelId: id }),
    RoomAvailability.countDocuments({ hotelId: id, bookedCount: { $gt: 0 } }),
  ]);

  if (committedNights > 0) {
    throw new ApiError(
      409,
      `This hotel has ${committedNights} booked night(s) on record and cannot be deleted. Archive the listing and deactivate the account instead.`
    );
  }

  await Promise.all([
    RoomAvailability.deleteMany({ hotelId: id }),
    AvailabilityBlock.deleteMany({ hotelId: id }),
    RoomType.deleteMany({ hotelId: id }),
  ]);
  await hotel.deleteOne();

  return ok(res, {
    message: "Hotel deleted successfully.",
    removedRooms: roomCount,
  });
});

module.exports = { ...exports, listingSummary };
