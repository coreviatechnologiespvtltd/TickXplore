const crypto = require("crypto");
const { toDateKey } = require("./hotelAvailability");

/**
 * Listing snapshot helpers.
 * ------------------------------------------------------------------
 * Public APIs never read a hotel's live listing content. They read
 * `Hotel.publishedSnapshot`, which is frozen at approval time. That is what makes
 * "public APIs only return approved content" true by construction rather than by
 * convention: a hotel editing a published listing cannot change what customers
 * see until an admin approves the new version.
 */

/** Deterministic JSON so two structurally equal payloads hash identically. */
const stableStringify = (value) => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (typeof value.toJSON === "function" && value._id !== undefined) {
      return stableStringify(value.toJSON());
    }
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const contentHash = (payload) =>
  crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");

/** Deep clone that also strips Mongoose internals. */
const plain = (doc) => {
  if (!doc) return doc;
  return typeof doc.toJSON === "function" ? doc.toJSON() : JSON.parse(JSON.stringify(doc));
};

const mapImages = (images = []) =>
  images.map((image) => ({
    _id: String(image._id),
    url: image.url,
    caption: image.caption || "",
    order: image.order ?? 0,
    isCover: Boolean(image.isCover),
  }));

/** The public-facing projection of a hotel, stored inside the snapshot. */
const buildProfile = (hotel) => {
  const source = plain(hotel);
  const amenities = [...(source.amenities || [])].sort();
  const images = mapImages(source.images);
  const coverImage =
    source.coverImage || images.find((image) => image.isCover)?.url || images[0]?.url || "";

  return {
    hotelName: source.hotelName || "",
    hotelId: source.hotelId,
    description: source.description || "",
    type: source.type,
    starRating: source.starRating,
    contact: {
      phone: source.contact?.phone || source.phoneNumber || "",
      alternatePhone: source.contact?.alternatePhone || "",
      email: source.contact?.email || source.email || "",
      website: source.contact?.website || "",
      whatsapp: source.contact?.whatsapp || "",
    },
    address: source.address || "",
    area: source.area || "",
    city: source.city || source.hotelLocation || "",
    district: source.district || "",
    country: source.country || "Nepal",
    location: source.location?.coordinates?.length === 2 ? source.location : null,
    amenities,
    images,
    coverImage,
    policies: source.policies || {},
    ratingSummary: source.ratingSummary || { average: 0, count: 0 },
    // Filled in by buildListingSnapshot once room pricing is known.
    priceRange: { min: 0, max: 0, currency: "NPR" },
    totalRooms: 0,
  };
};

/** The public-facing projection of a room type. */
const buildRoom = (room) => {
  const source = plain(room);
  const images = mapImages(source.images);

  return {
    roomTypeId: String(source._id),
    name: source.name,
    description: source.description || "",
    type: source.type,
    pricing: source.pricing || {},
    totalRooms: source.totalRooms,
    maxGuests: source.maxGuests,
    maxAdults: source.maxAdults ?? null,
    maxChildren: source.maxChildren ?? 0,
    bedrooms: source.bedrooms ?? 1,
    bathrooms: source.bathrooms ?? 1,
    attachedBathrooms: source.attachedBathrooms ?? 0,
    beds: (source.beds || []).map((bed) => ({ type: bed.type, count: bed.count })),
    sizeSqm: source.sizeSqm ?? null,
    amenities: [...(source.amenities || [])].sort(),
    images,
    coverImage: images.find((image) => image.isCover)?.url || images[0]?.url || "",
    ratingSummary: source.ratingSummary || { average: 0, count: 0 },
  };
};

/**
 * Freeze the hotel's current content for admin review.
 *
 * @param {import("mongoose").Document} hotel
 * @param {import("mongoose").Document[]} rooms
 */
const buildListingSnapshot = (hotel, rooms) => {
  const profile = buildProfile(hotel);
  const roomPayloads = rooms.map(buildRoom);

  const prices = roomPayloads
    .map((room) => room.pricing?.basePrice)
    .filter((price) => typeof price === "number" && !Number.isNaN(price));

  profile.priceRange = {
    min: prices.length ? Math.min(...prices) : 0,
    max: prices.length ? Math.max(...prices) : 0,
    currency: roomPayloads[0]?.pricing?.currency || "NPR",
  };
  profile.totalRooms = roomPayloads.reduce((sum, room) => sum + (room.totalRooms || 0), 0);

  const payload = { profile, rooms: roomPayloads };

  return {
    version: (hotel.publishedSnapshot?.version || 0) + 1,
    contentHash: contentHash(payload),
    profile,
    rooms: roomPayloads,
  };
};

/** Rooms a hotel may submit: active, not archived, with sellable inventory. */
const selectSubmittableRooms = async (RoomType, hotelId) =>
  RoomType.find({ hotelId, isArchived: false, isActive: true })
    .sort({ createdAt: 1 })
    .lean();

/**
 * Everything that must be true before a listing can be submitted.
 *
 * @returns {Promise<{ready: boolean, blockers: object[], warnings: object[]}>}
 */
const checkReadiness = async (Hotel, RoomType, hotel) => {
  const blockers = [];
  const warnings = [];

  if (!hotel.hotelName?.trim()) {
    blockers.push({ field: "hotelName", message: "Hotel name is required." });
  }
  if (!hotel.description?.trim() || hotel.description.trim().length < 50) {
    blockers.push({
      field: "description",
      message: "Description is required and should be at least 50 characters.",
    });
  }
  if (!hotel.address?.trim()) {
    blockers.push({ field: "address", message: "Address is required." });
  }
  if (!hotel.city?.trim() && !hotel.hotelLocation?.trim()) {
    blockers.push({ field: "city", message: "City is required." });
  }
  if (!hotel.location?.coordinates || hotel.location.coordinates.length !== 2) {
    warnings.push({
      field: "location",
      message: "Latitude/longitude is missing — the property will not appear in 'near me' results.",
    });
  }
  if (!hotel.contact?.phone && !hotel.contact?.email) {
    blockers.push({
      field: "contact",
      message: "At least one contact phone number or email is required.",
    });
  }
  if (!hotel.coverImage) {
    blockers.push({
      field: "coverImage",
      message: "A cover image is required — this is the first image customers see.",
    });
  } else if ((hotel.images || []).length < 3) {
    warnings.push({
      field: "images",
      message: "Listings with at least 3 photos get more bookings. Consider adding more images.",
    });
  }
  if ((hotel.amenities || []).length === 0) {
    warnings.push({ field: "amenities", message: "No amenities selected — customers filter on these." });
  }
  if (hotel.policies?.minStayNights > hotel.policies?.maxStayNights) {
    blockers.push({
      field: "policies.maxStayNights",
      message: "Maximum stay must be greater than or equal to the minimum stay.",
    });
  }
  if (Number(hotel.starRating) > 4) {
    warnings.push({
      field: "starRating",
      message: "A 5-star rating requires admin verification and may be adjusted on review.",
    });
  }

  const rooms = await selectSubmittableRooms(RoomType, hotel._id);

  if (rooms.length === 0) {
    blockers.push({
      field: "rooms",
      message: "Add at least one active room type before submitting.",
    });
  }

  for (const room of rooms) {
    if (!room.name?.trim()) {
      blockers.push({ roomId: room._id, field: "name", message: "Room name is required." });
    }
    if (!room.description?.trim()) {
      blockers.push({
        roomId: room._id,
        field: "description",
        message: `Room "${room.name || room._id}" needs a description.`,
      });
    }
    if (!room.pricing?.basePrice || room.pricing.basePrice <= 0) {
      blockers.push({
        roomId: room._id,
        field: "pricing.basePrice",
        message: `Room "${room.name}" needs a base price greater than 0.`,
      });
    }
    if (!room.totalRooms || room.totalRooms < 1) {
      blockers.push({
        roomId: room._id,
        field: "totalRooms",
        message: `Room "${room.name}" needs at least 1 room in inventory.`,
      });
    }
    if (!room.maxGuests || room.maxGuests < 1) {
      blockers.push({
        roomId: room._id,
        field: "maxGuests",
        message: `Room "${room.name}" needs a maximum guest count.`,
      });
    }
    if (!room.images?.length) {
      warnings.push({
        roomId: room._id,
        field: "images",
        message: `Room "${room.name}" has no photos.`,
      });
    }
  }

  return { ready: blockers.length === 0, blockers, warnings, roomCount: rooms.length };
};

/** Compare live content against the approved snapshot to flag pending edits. */
const hasUnpublishedChanges = (hotel, rooms) => {
  if (!hotel.publishedSnapshot?.contentHash) return Boolean(hotel.publishedSnapshot);

  const candidate = buildListingSnapshot(hotel, rooms);
  // buildListingSnapshot bumps the version; only the hash matters here.
  return candidate.contentHash !== hotel.publishedSnapshot.contentHash;
};

module.exports = {
  stableStringify,
  contentHash,
  buildProfile,
  buildRoom,
  buildListingSnapshot,
  selectSubmittableRooms,
  checkReadiness,
  hasUnpublishedChanges,
  toDateKey,
};
