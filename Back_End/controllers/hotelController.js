const bcrypt = require("bcryptjs");
const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const RoomAvailability = require("../models/RoomAvailability");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const Notification = require("../models/Notification");
const { ok, ApiError, asyncHandler } = require("../utils/http");
const { assertValidAmenities } = require("../utils/hotelAmenities");
const { buildListingSnapshot, selectSubmittableRooms, checkReadiness, hasUnpublishedChanges } = require("../utils/hotelListing");
const { todayUTC, isValidObjectId } = require("../utils/hotelAvailability");
const { saveImage, removeImage, toArray, ALLOWED_LABEL } = require("../utils/uploadImage");
const { notifyAdmins } = require("../utils/hotelNotify");
const { sendEmail } = require("../utils/sendEmail");

/**
 * Hotel dashboard — profile, images, amenities, policies and listing lifecycle.
 * Every handler here operates on `req.hotel` (the authenticated hotel) or on
 * resources pre-scoped by `middleware/hotelAuth.js`.
 */

const MAX_HOTEL_IMAGES = 12;
const MAX_IMAGE_FILES_PER_REQUEST = 6;

/** Copy only the keys actually present in `source` onto `target`. */
const assignDefined = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
};

/** Keep exactly one `isCover` image and mirror it onto `hotel.coverImage`. */
const syncCoverImage = (images) => {
  const list = images || [];
  const cover = list.find((image) => image.isCover) || list[0] || null;
  for (const image of list) image.isCover = Boolean(cover) && String(image._id) === String(cover._id);
  return cover ? cover.url : "";
};

/* ================================ profile ================================ */

/** GET /api/hotel/profile */
exports.getProfile = asyncHandler(async (req, res) => {
  const hotel = req.hotel;

  const [roomCount, activeRoomCount, totalInventory] = await Promise.all([
    RoomType.countDocuments({ hotelId: hotel._id, isArchived: false }),
    RoomType.countDocuments({ hotelId: hotel._id, isArchived: false, isActive: true }),
    RoomType.aggregate([
      { $match: { hotelId: hotel._id, isArchived: false } },
      { $group: { _id: null, total: { $sum: "$totalRooms" } } },
    ]),
  ]);

  const rooms = await selectSubmittableRooms(RoomType, hotel._id);

  return ok(res, {
    hotel: hotel.toJSON(),
    summary: {
      listingStatus: hotel.listingStatus,
      roomCount,
      activeRoomCount,
      totalInventory: totalInventory[0]?.total || 0,
      hasUnpublishedChanges: hasUnpublishedChanges(hotel, rooms),
      publishedVersion: hotel.publishedSnapshot?.version || 0,
    },
  });
});

/** PUT /api/hotel/profile */
exports.updateProfile = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const body = req.body;

  assignDefined(hotel, {
    hotelName: body.hotelName,
    description: body.description,
    type: body.type,
    starRating: body.starRating,
    address: body.address,
    area: body.area,
    city: body.city,
    district: body.district,
    country: body.country,
    hotelLocation: body.hotelLocation,
  });

  if (body.contact !== undefined) {
    if (body.contact === null) {
      hotel.contact = {};
    } else {
      hotel.contact = assignDefined(hotel.contact.toObject?.() || {}, body.contact);
    }
  }

  // GeoJSON point — accepted as `latitude`/`longitude` or a full `location` object.
  const hasLat = body.latitude !== undefined;
  const hasLng = body.longitude !== undefined;
  if (hasLat || hasLng) {
    if (body.latitude == null || body.longitude == null) {
      hotel.set("location", undefined);
    } else {
      hotel.location = { type: "Point", coordinates: [Number(body.longitude), Number(body.latitude)] };
    }
  } else if (body.location && Array.isArray(body.location.coordinates)) {
    const [lng, lat] = body.location.coordinates.map(Number);
    hotel.location = { type: "Point", coordinates: [lng, lat] };
  }

  if (body.amenities !== undefined) {
    hotel.amenities = assertValidAmenities(body.amenities, "hotel");
  }

  // Editing listing content invalidates a pending review of the old content.
  if (hotel.listingStatus === "pending_approval") {
    hotel.listingStatus = "draft";
    hotel.statusHistory.push({
      from: "pending_approval",
      to: "draft",
      reason: "Listing content was edited while awaiting review.",
      by: hotel._id,
    });
    hotel.statusMeta.submittedAt = undefined;
  }

  await hotel.save();

  return ok(res, { message: "Hotel profile updated successfully.", hotel: hotel.toJSON() });
});

/* ================================ images ================================ */

/** POST /api/hotel/profile/images */
exports.uploadImages = asyncHandler(async (req, res) => {
  const hotel = req.hotel;

  const files = [...toArray(req.files?.images), ...toArray(req.files?.image)];
  if (files.length === 0) {
    throw new ApiError(400, `Attach at least one image under the "images" field. Allowed types: ${ALLOWED_LABEL}.`);
  }
  if (files.length > MAX_IMAGE_FILES_PER_REQUEST) {
    throw new ApiError(400, `Upload at most ${MAX_IMAGE_FILES_PER_REQUEST} images per request.`);
  }
  if ((hotel.images?.length || 0) + files.length > MAX_HOTEL_IMAGES) {
    throw new ApiError(400, `A hotel can have at most ${MAX_HOTEL_IMAGES} images.`);
  }

  const hasCoverUpload = toArray(req.files?.cover).length > 0;
  const shouldSetCover = ["1", "true", "yes"].includes(String(req.body?.setCover).toLowerCase());
  const makeFirstCover = (hotel.images?.length || 0) === 0;

  const saved = [];
  for (const file of files) {
    saved.push({ url: await saveImage(file, "hotel"), caption: "", order: hotel.images.length, isCover: false });
  }

  hotel.images.push(...saved);

  if (hasCoverUpload) {
    const coverUrl = await saveImage(toArray(req.files.cover)[0], "hotel");
    hotel.images.push({ url: coverUrl, caption: "", order: hotel.images.length, isCover: true });
  } else if (shouldSetCover || makeFirstCover) {
    hotel.images[0].isCover = true;
  }

  hotel.coverImage = syncCoverImage(hotel.images);
  await hotel.save();

  return ok(res, { message: "Images uploaded successfully.", images: hotel.images, coverImage: hotel.coverImage }, 201);
});

/** DELETE /api/hotel/profile/images/:imageId */
exports.deleteImage = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const { imageId } = req.params;

  const image = hotel.images.id(imageId);
  if (!image) throw new ApiError(404, "Image not found");

  const removedUrl = image.url;
  hotel.images.pull(imageId);
  hotel.coverImage = syncCoverImage(hotel.images);
  await hotel.save();

  // Only drop the file when no other entity still points at it.
  const stillReferenced = await Hotel.exists({ _id: { $ne: hotel._id }, "images.url": removedUrl });
  if (!stillReferenced) removeImage(removedUrl);

  return ok(res, {
    message: "Image removed successfully.",
    images: hotel.images,
    coverImage: hotel.coverImage,
  });
});

/** PUT /api/hotel/profile/cover */
exports.setCoverImage = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const { imageId, url } = req.body;

  if (!hotel.images?.length) {
    throw new ApiError(400, "Upload at least one image before choosing a cover image.");
  }

  let target = null;
  if (imageId) {
    if (!isValidObjectId(imageId)) throw new ApiError(400, "Invalid image id.");
    target = hotel.images.id(imageId);
    if (!target) throw new ApiError(404, "Image not found");
  } else if (url) {
    target = hotel.images.find((image) => image.url === url);
    if (!target) throw new ApiError(404, "Image not found");
  } else {
    target = hotel.images[0];
  }

  for (const image of hotel.images) {
    image.isCover = String(image._id) === String(target._id);
  }
  hotel.coverImage = target.url;
  await hotel.save();

  return ok(res, { message: "Cover image updated.", coverImage: hotel.coverImage, images: hotel.images });
});

/** PUT /api/hotel/profile/images/reorder */
exports.reorderImages = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const { order } = req.body;

  if (!Array.isArray(order)) {
    throw new ApiError(400, '"order" must be an array of image ids, most important first.');
  }

  const known = new Set(hotel.images.map((image) => String(image._id)));
  if (order.length !== hotel.images.length || order.some((id) => !known.has(String(id)))) {
    throw new ApiError(400, '"order" must list every image id of this hotel exactly once.');
  }

  order.forEach((id, index) => {
    hotel.images.id(id).order = index;
  });

  await hotel.save();
  return ok(res, { message: "Image order updated.", images: hotel.images });
});

/* =============================== amenities =============================== */

/** PUT /api/hotel/profile/amenities */
exports.setAmenities = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  hotel.amenities = assertValidAmenities(req.body.amenities, "hotel");
  await hotel.save();
  return ok(res, { message: "Hotel amenities updated.", amenities: hotel.amenities });
});

/* ================================ policies ================================ */

/** PUT /api/hotel/policies */
exports.updatePolicies = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const body = req.body;

  assignDefined(hotel.policies, {
    checkInTime: body.checkInTime,
    checkOutTime: body.checkOutTime,
    minStayNights: body.minStayNights,
    maxStayNights: body.maxStayNights,
    childrenPolicy: body.childrenPolicy,
    petPolicy: body.petPolicy,
  });

  if (body.houseRules !== undefined) {
    const raw = Array.isArray(body.houseRules)
      ? body.houseRules
      : String(body.houseRules).split(/[\n,]/);
    hotel.policies.houseRules = [
      ...new Set(
        raw
          .map((rule) => String(rule).trim())
          .filter(Boolean)
          .slice(0, 30)
      ),
    ];
  }

  const cancellationInput = body.cancellationPolicy;
  if (cancellationInput !== undefined) {
    if (cancellationInput === null) {
      hotel.policies.cancellationPolicy = {};
    } else {
      const policy = hotel.policies.cancellationPolicy;
      assignDefined(policy, {
        freeCancellationDays: cancellationInput.freeCancellationDays,
        nonRefundableAfterDays: cancellationInput.nonRefundableAfterDays,
        notes: cancellationInput.notes,
      });

      if (cancellationInput.tiers !== undefined) {
        if (!Array.isArray(cancellationInput.tiers)) {
          throw new ApiError(400, '"cancellationPolicy.tiers" must be an array.');
        }
        const tiers = cancellationInput.tiers
          .filter((tier) => tier && tier.daysBeforeCheckIn !== undefined && tier.refundPercent !== undefined)
          .map((tier) => ({
            daysBeforeCheckIn: Number(tier.daysBeforeCheckIn),
            refundPercent: Number(tier.refundPercent),
            label: tier.label ? String(tier.label).trim().slice(0, 120) : "",
          }))
          .sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn);

        const seen = new Set();
        for (const tier of tiers) {
          if (seen.has(tier.daysBeforeCheckIn)) {
            throw new ApiError(
              400,
              `Duplicate cancellation tier for ${tier.daysBeforeCheckIn} day(s) before check-in.`
            );
          }
          seen.add(tier.daysBeforeCheckIn);
        }
        policy.tiers = tiers;
      }
    }
  }

  await hotel.save(); // schema-level cross-field validation runs here

  return ok(res, { message: "Policies updated successfully.", policies: hotel.policies });
});

/* ================================ stats ================================ */

/** GET /api/hotel/stats */
exports.getStats = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const today = todayUTC();
  const horizon = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);

  const [
    roomCount,
    activeRooms,
    archivedRooms,
    inventory,
    blockedNights,
    overrideNights,
    soldOutNights,
    availableNow,
    totalEarnings,
  ] = await Promise.all([
    RoomType.countDocuments({ hotelId: hotel._id, isArchived: false }),
    RoomType.countDocuments({ hotelId: hotel._id, isArchived: false, isActive: true }),
    RoomType.countDocuments({ hotelId: hotel._id, isArchived: true }),
    RoomType.aggregate([
      { $match: { hotelId: hotel._id, isArchived: false } },
      { $group: { _id: null, total: { $sum: "$totalRooms" } } },
    ]),
    AvailabilityBlock.countDocuments({
      hotelId: hotel._id,
      isActive: true,
      startDate: { $gte: today },
      endDate: { $lte: horizon },
    }),
    RoomAvailability.countDocuments({ hotelId: hotel._id, date: { $gte: today, $lte: horizon } }),
    RoomAvailability.countDocuments({
      hotelId: hotel._id,
      date: { $gte: today, $lte: horizon },
      $expr: { $lte: [{ $ifNull: ["$availableCount", 999] }, 0] },
    }),
    RoomAvailability.countDocuments({
      hotelId: hotel._id,
      date: today,
      status: { $ne: "blocked" },
      $expr: { $gt: [{ $subtract: [{ $ifNull: ["$availableCount", 1] }, { $ifNull: ["$bookedCount", 0] }] }, 0] },
    }),
    RoomType.aggregate([
      { $match: { hotelId: hotel._id } },
      { $group: { _id: null, total: { $sum: "$totalEarnings" } } },
    ]),
  ]);

  const rooms = await selectSubmittableRooms(RoomType, hotel._id);

  return ok(res, {
    stats: {
      listingStatus: hotel.listingStatus,
      isAccountActive: hotel.isActive,
      roomCount,
      activeRooms,
      archivedRooms,
      totalInventory: inventory[0]?.total || 0,
      blockedNights,
      overrideNights,
      soldOutNights,
      availableNow,
      totalEarnings: totalEarnings[0]?.total || 0,
      totalCommission: hotel.totalCommission || 0,
      publishedVersion: hotel.publishedSnapshot?.version || 0,
      hasUnpublishedChanges: hasUnpublishedChanges(hotel, rooms),
    },
  });
});

/* =========================== listing lifecycle =========================== */

const listingPayload = (hotel) => ({
  listingStatus: hotel.listingStatus,
  statusMeta: hotel.statusMeta,
  statusHistory: [...(hotel.statusHistory || [])].reverse(),
  publishedVersion: hotel.publishedSnapshot?.version || 0,
  publishedAt: hotel.publishedSnapshot?.approvedAt || null,
});

/** GET /api/hotel/listing/status */
exports.getListingStatus = asyncHandler(async (req, res) => {
  const hotel = req.hotel;
  const rooms = await selectSubmittableRooms(RoomType, hotel._id);

  return ok(res, {
    ...listingPayload(hotel),
    hasUnpublishedChanges: hasUnpublishedChanges(hotel, rooms),
    rejectionReason: hotel.statusMeta?.rejectionReason || "",
    allowedActions: {
      canSubmit: ["draft", "rejected"].includes(hotel.listingStatus),
      canWithdraw: ["pending_approval", "published"].includes(hotel.listingStatus),
      canArchive: !["archived"].includes(hotel.listingStatus),
      canRestore: hotel.listingStatus === "archived",
    },
  });
});

/** GET /api/hotel/listing/readiness */
exports.getReadiness = asyncHandler(async (req, res) => {
  const report = await checkReadiness(Hotel, RoomType, req.hotel);
  return ok(res, { listingStatus: req.hotel.listingStatus, ...report });
});

/** POST /api/hotel/listing/submit */
exports.submitListing = asyncHandler(async (req, res) => {
  const hotel = req.hotel;

  if (!["draft", "rejected"].includes(hotel.listingStatus)) {
    throw new ApiError(
      409,
      `A listing with status "${hotel.listingStatus}" cannot be submitted. Withdraw it first if you need to make changes.`
    );
  }

  const report = await checkReadiness(Hotel, RoomType, hotel);
  if (!report.ready) {
    throw new ApiError(422, "Your listing is not ready for review yet.", {
      blockers: report.blockers,
      warnings: report.warnings,
    });
  }

  const rooms = await selectSubmittableRooms(RoomType, hotel._id);
  const snapshot = buildListingSnapshot(hotel, rooms);

  const previous = hotel.listingStatus;
  hotel.listingStatus = "pending_approval";
  hotel.publishedSnapshot = {
    version: snapshot.version,
    contentHash: snapshot.contentHash,
    profile: snapshot.profile,
    rooms: snapshot.rooms,
  };
  hotel.statusMeta.submittedAt = new Date();
  hotel.statusMeta.rejectionReason = "";
  hotel.statusHistory.push({
    from: previous,
    to: "pending_approval",
    reason: "Submitted by the hotel for admin approval.",
    by: hotel._id,
  });
  await hotel.save();

  await notifyAdmins(
    `${hotel.hotelName || "A hotel"} (${hotel.hotelId}) submitted a listing for approval.`
  );

  try {
    await sendEmail(
      hotel.email,
      "Your TickXplore listing is under review",
      `<h2>Hello ${hotel.hotelName || "there"},</h2>
       <p>We have received your listing <strong>${hotel.hotelName}</strong> and it is now pending admin approval.</p>
       <p>You can keep editing your draft; the public page keeps showing your last approved version until a new one is approved.</p>`
    );
  } catch (error) {
    console.warn(" Listing submission email failed:", error.message);
  }

  return ok(res, {
    message: "Listing submitted for admin approval.",
    ...listingPayload(hotel),
    warnings: report.warnings,
  });
});

/** POST /api/hotel/listing/withdraw */
exports.withdrawListing = asyncHandler(async (req, res) => {
  const hotel = req.hotel;

  if (!["pending_approval", "published"].includes(hotel.listingStatus)) {
    throw new ApiError(409, `A listing with status "${hotel.listingStatus}" cannot be withdrawn.`);
  }

  const wasPublished = hotel.listingStatus === "published";
  hotel.listingStatus = "draft";
  hotel.statusMeta.submittedAt = undefined;
  hotel.statusHistory.push({
    from: wasPublished ? "published" : "pending_approval",
    to: "draft",
    reason: req.body?.reason || "Withdrawn by the hotel.",
    by: hotel._id,
  });
  await hotel.save();

  return ok(res, {
    message: wasPublished
      ? "Listing withdrawn. It is no longer visible on the public site."
      : "Submission withdrawn. Your listing is a draft again.",
    ...listingPayload(hotel),
  });
});

/** POST /api/hotel/listing/archive */
exports.archiveListing = asyncHandler(async (req, res) => {
  const hotel = req.hotel;

  if (hotel.listingStatus === "archived") {
    throw new ApiError(409, "This listing is already archived.");
  }
  if (["pending_approval"].includes(hotel.listingStatus)) {
    throw new ApiError(409, "Withdraw the pending submission before archiving.");
  }

  const previous = hotel.listingStatus;
  hotel.listingStatus = "archived";
  hotel.statusMeta.archivedAt = new Date();
  hotel.statusHistory.push({
    from: previous,
    to: "archived",
    reason: req.body?.reason || "Archived by the hotel.",
    by: hotel._id,
  });
  await hotel.save();

  return ok(res, { message: "Listing archived.", ...listingPayload(hotel) });
});

/** POST /api/hotel/listing/restore */
exports.restoreListing = asyncHandler(async (req, res) => {
  const hotel = req.hotel;

  if (hotel.listingStatus !== "archived") {
    throw new ApiError(409, "Only an archived listing can be restored.");
  }

  hotel.listingStatus = "draft";
  hotel.statusMeta.archivedAt = undefined;
  hotel.statusHistory.push({
    from: "archived",
    to: "draft",
    reason: "Restored to draft by the hotel. Submit it again for approval.",
    by: hotel._id,
  });
  await hotel.save();

  return ok(res, {
    message: "Listing restored as a draft. Submit it for approval to publish the changes.",
    ...listingPayload(hotel),
  });
});

/* ============================ account recovery ============================ */

/** POST /api/hotel/forgot-password */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, '"email" is required.');

  const hotel = await Hotel.findOne({ email: String(email).toLowerCase().trim() });
  // Same generic response for unknown addresses so emails cannot be enumerated.
  if (!hotel) return ok(res, { message: "If that email is registered, a reset code has been sent." });

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  hotel.resetCode = resetCode;
  hotel.resetCodeExpires = Date.now() + 10 * 60 * 1000;
  await hotel.save();

  try {
    await sendEmail(
      hotel.email,
      "TickXplore - Reset Password OTP",
      `<p>Hello ${hotel.hotelName || "there"},</p>
       <p>Your password reset code is <b>${resetCode}</b>. It expires in 10 minutes.</p>
       <p>If you did not request this, you can safely ignore this email.</p>`
    );
  } catch (error) {
    console.warn(" Password reset email failed:", error.message);
  }

  return ok(res, { message: "If that email is registered, a reset code has been sent." });
});

/** POST /api/hotel/reset-password */
exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    throw new ApiError(400, '"email", "code" and "newPassword" are required.');
  }
  if (String(newPassword).length < 6) {
    throw new ApiError(400, '"newPassword" must be at least 6 characters.');
  }

  const hotel = await Hotel.findOne({ email: String(email).toLowerCase().trim() });
  if (!hotel || hotel.resetCode !== String(code) || !hotel.resetCodeExpires || hotel.resetCodeExpires < new Date()) {
    throw new ApiError(400, "Invalid or expired reset code.");
  }

  hotel.password = await bcrypt.hash(String(newPassword), 10);
  hotel.resetCode = undefined;
  hotel.resetCodeExpires = undefined;
  await hotel.save();

  return ok(res, { message: "Password reset successfully." });
});

/* ============================== notifications ============================== */

/** GET /api/hotel/notifications */
exports.getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ userId: req.user._id, role: "hotel" })
    .sort({ createdAt: -1 })
    .limit(50);
  return ok(res, { notifications });
});

/** PUT /api/hotel/notifications/:notificationId/read */
exports.markNotificationRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;
  if (!isValidObjectId(notificationId)) throw new ApiError(404, "Notification not found");

  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, userId: req.user._id, role: "hotel" },
    { isRead: true },
    { new: true }
  );
  if (!notification) throw new ApiError(404, "Notification not found");

  return ok(res, { message: "Notification marked as read.", notification });
});

module.exports = {
  ...exports,
  MAX_HOTEL_IMAGES,
  syncCoverImage,
};
