const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const Amenity = require("../models/Amenity");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const RoomAvailability = require("../models/RoomAvailability");
const { ok, ApiError, asyncHandler } = require("../utils/http");
const { ACCOMMODATION_TYPES } = require("../models/Hotel");
const { AMENITIES, AMENITY_KEYS } = require("../utils/hotelAmenities");
const {
  validateStayRange,
  isValidObjectId,
  toDateKey,
  eachNight,
  nightPrice,
  MS_PER_DAY,
} = require("../utils/hotelAvailability");

/**
 * Public accommodation API.
 * ------------------------------------------------------------------
 * No authentication. Every query is hard-limited to listings that an admin has
 * approved (`listingStatus: "published"` with a `publishedSnapshot`), and all
 * content is read from the frozen snapshot — never from the live document. A
 * hotel editing its draft therefore cannot affect anything here.
 *
 * Filters query `publishedSnapshot.profile.*` / `publishedSnapshot.rooms.*`, all of
 * which are indexed, so the customer Stay page stays fast as inventory grows.
 * Room *availability* is intentionally not snapshotted: it is read live from
 * `RoomAvailability` / `AvailabilityBlock` so a booking can never be offered for
 * a night the hotel has since closed.
 */

const PUBLIC_FILTER = { listingStatus: "published", "publishedSnapshot.approvedAt": { $ne: null } };

/** Parse `?amenities=a&amenities=b` or `?amenities=a,b` into known keys. */
const readAmenities = (raw) => {
  const candidates = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const keys = candidates
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((value) => AMENITY_KEYS.includes(value));
  return [...new Set(keys)];
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildFilter = (query) => {
  const filter = { ...PUBLIC_FILTER };

  if (query.q) {
    const pattern = { $regex: escapeRegex(query.q), $options: "i" };
    filter.$or = [
      { "publishedSnapshot.profile.hotelName": pattern },
      { "publishedSnapshot.profile.description": pattern },
      { "publishedSnapshot.profile.address": pattern },
      { "publishedSnapshot.profile.area": pattern },
      { "publishedSnapshot.profile.city": pattern },
    ];
  }

  if (query.city) {
    filter["publishedSnapshot.profile.city"] = { $regex: `^${escapeRegex(query.city)}$`, $options: "i" };
  }
  if (query.type) filter["publishedSnapshot.profile.type"] = query.type;
  if (query.starRating) filter["publishedSnapshot.profile.starRating"] = { $gte: Number(query.starRating) };

  const amenities = readAmenities(query.amenities);
  if (amenities.length > 0) {
    // A guest requiring several amenities needs a listing that has all of them.
    filter["publishedSnapshot.profile.amenities"] = { $all: amenities };
  }

  const roomsMatch = {};
  if (query.guests) roomsMatch.maxGuests = { $gte: Number(query.guests) };
  if (query.minPrice != null || query.maxPrice != null) {
    const price = {};
    if (query.minPrice != null) price.$gte = Number(query.minPrice);
    if (query.maxPrice != null) price.$lte = Number(query.maxPrice);
    roomsMatch["pricing.basePrice"] = price;
  }
  if (Object.keys(roomsMatch).length > 0) {
    filter["publishedSnapshot.rooms"] = { $elemMatch: roomsMatch };
  }

  // Proximity search
  if (query.lat != null && query.lng != null) {
    filter.location = {
      $near: {
        $geometry: { type: "Point", coordinates: [Number(query.lng), Number(query.lat)] },
        ...(query.radiusKm ? { $maxDistance: Number(query.radiusKm) * 1000 } : {}),
      },
    };
  }

  return { filter, amenities };
};

const buildSort = (sort, hasLocation) => {
  switch (sort) {
    case "price-asc":
      return { "publishedSnapshot.profile.priceRange.min": 1 };
    case "price-desc":
      return { "publishedSnapshot.profile.priceRange.min": -1 };
    case "rating":
      return { "publishedSnapshot.profile.ratingSummary.average": -1, "publishedSnapshot.profile.ratingSummary.count": -1 };
    case "name":
      return { "publishedSnapshot.profile.hotelName": 1 };
    case "newest":
      return { "publishedSnapshot.approvedAt": -1 };
    case "distance":
      return hasLocation ? { distance: 1 } : { "publishedSnapshot.profile.ratingSummary.average": -1 };
    case "recommended":
    default:
      return { "publishedSnapshot.profile.ratingSummary.average": -1, "publishedSnapshot.profile.priceRange.min": 1 };
  }
};

/**
 * Rough pre-booking total for one room over the selected nights.
 * Mirrors the order in which fees are applied so the figure shown in search
 * matches the figure taken at checkout.
 */
const quoteEstimate = (pricing = {}, nights = [], guests = 1, maxGuests = 2) => {
  const rooms = Math.max(1, Math.ceil((guests || 1) / Math.max(1, maxGuests || 1)));
  const extraGuests = Math.max(0, (guests || 1) - maxGuests * rooms);

  let roomSubtotal = 0;
  let extras = 0;
  for (const night of nights) {
    roomSubtotal += night.price * rooms;
    extras += (pricing.extraGuestPrice || 0) * extraGuests;
  }

  const beforeDiscount = roomSubtotal + extras;
  const percentOff = beforeDiscount * ((pricing.discountPercent || 0) / 100);
  const discount = Math.min(percentOff + (pricing.discountAmount || 0), beforeDiscount);
  const afterDiscount = beforeDiscount - discount;
  const tax = afterDiscount * ((pricing.taxPercent || 0) / 100);
  const serviceFee = afterDiscount * ((pricing.serviceFeePercent || 0) / 100);

  return {
    currency: pricing.currency || "NPR",
    rooms,
    nights: nights.length,
    extraGuests,
    roomSubtotal: Math.round(roomSubtotal),
    extrasTotal: Math.round(extras),
    discount: Math.round(discount),
    tax: Math.round(tax),
    serviceFee: Math.round(serviceFee),
    total: Math.round(afterDiscount + tax + serviceFee),
  };
};

/**
 * Availability for a set of hotels, evaluated against their *published* rooms.
 * Room availability is real-time (blocks and inventory are never snapshotted);
 * only the room list itself comes from the approved snapshot.
 */
const attachAvailability = async (hotels, range, guests) => {
  if (!range || hotels.length === 0) return new Map();

  const snapshotsByHotel = new Map(
    hotels.map((hotel) => [String(hotel._id), hotel.publishedSnapshot?.rooms || []])
  );
  const roomIds = [...snapshotsByHotel.values()].flat().map((room) => room.roomTypeId);

  if (roomIds.length === 0) return new Map();

  const liveRooms = await RoomType.find({ _id: { $in: roomIds } })
    .select("name totalRooms pricing beds maxGuests bedrooms bathrooms attachedBathrooms maxChildren")
    .lean();

  const byId = new Map(liveRooms.map((room) => [String(room._id), room]));

  const hotelIds = hotels.map((hotel) => hotel._id);
  const nights = eachNight(range.from, range.to);
  const lastNight = nights[nights.length - 1] || range.from;

  // Blocks and inventory can be read hotel-wide in two queries.
  const [blocks, inventory] = await Promise.all([
    AvailabilityBlock.find({
      hotelId: { $in: hotelIds },
      isActive: true,
      startDate: { $lte: lastNight },
      endDate: { $gte: range.from },
    }).lean(),
    RoomAvailability.find({
      hotelId: { $in: hotelIds },
      date: { $gte: range.from, $lte: lastNight },
    })
      .select("roomTypeId date availableCount bookedCount priceOverride")
      .lean(),
  ]);

  const inventoryByKey = new Map(
    inventory.map((row) => [`${row.roomTypeId}|${toDateKey(row.date)}`, row])
  );

  const results = new Map();

  for (const hotel of hotels) {
    const publishedRooms = snapshotsByHotel.get(String(hotel._id)) || [];
    const hotelBlocks = blocks.filter((block) => String(block.hotelId) === String(hotel._id));

    const availableRooms = [];
    let availableNow = false;

    for (const published of publishedRooms) {
      const live = byId.get(String(published.roomTypeId));
      // A room removed from the live inventory stops being bookable immediately.
      if (!live) continue;
      if (guests && live.maxGuests < guests) continue;

      const perNight = nights.map((night) => {
        const key = toDateKey(night);
        const blocked = hotelBlocks.some(
          (block) =>
            (block.roomTypeId == null || String(block.roomTypeId) === String(published.roomTypeId)) &&
            new Date(block.startDate).getTime() <= night.getTime() &&
            new Date(block.endDate).getTime() >= night.getTime()
        );
        const row = inventoryByKey.get(`${published.roomTypeId}|${key}`);
        const free = blocked
          ? 0
          : Math.max(0, (row?.availableCount ?? live.totalRooms ?? 0) - (row?.bookedCount ?? 0));

        return { date: key, free, price: nightPrice(live, night, row), isBlocked: blocked };
      });

      const bookable = perNight.every((night) => night.free > 0);
      if (bookable) {
        availableRooms.push({
          roomTypeId: published.roomTypeId,
          name: published.name,
          maxGuests: published.maxGuests,
          bedrooms: published.bedrooms,
          bathrooms: published.bathrooms,
          attachedBathrooms: published.attachedBathrooms,
          beds: published.beds,
          amenities: published.amenities,
          images: published.images,
          coverImage: published.coverImage,
          description: published.description,
          type: published.type,
          totalRooms: live.totalRooms,
          pricing: published.pricing,
          nights: perNight,
          estimate: quoteEstimate(published.pricing, perNight, guests, live.maxGuests),
        });
        availableNow = true;
      }
    }

    results.set(String(hotel._id), { isAvailable: availableNow, availableRooms });
  }

  return results;
};

/** GET /api/hotels */
exports.listHotels = asyncHandler(async (req, res) => {
  const query = req.query;
  const { filter, amenities } = buildFilter(query);

  const page = Number(query.page) || 1;
  const limit = Math.min(Number(query.limit) || 12, 50);
  const skip = (page - 1) * limit;

  const hasLocation = query.lat != null && query.lng != null;
  const sort = buildSort(query.sort, hasLocation);

  // Dates are optional, but both are required together for an availability search.
  let range = null;
  if (query.checkIn && query.checkOut) {
    range = validateStayRange(query.checkIn, query.checkOut, { allowPast: true, maxNights: 365 });
  }

  const [hotels, total] = await Promise.all([
    Hotel.find(filter)
      .select("publishedSnapshot listingStatus")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Hotel.countDocuments(filter),
  ]);

  const availability = await attachAvailability(hotels, range, query.guests ? Number(query.guests) : null);

  const results = hotels
    .map((hotel) => {
      const profile = hotel.publishedSnapshot?.profile;
      if (!profile) return null;

      const state = availability.get(String(hotel._id));
      // With dates supplied, only surface stays that can actually take the booking.
      if (range && (!state || !state.isAvailable)) return null;

      const { images, ...rest } = profile;
      return {
        id: String(hotel._id),
        ...rest,
        amenities: profile.amenities || [],
        amenitiesDetail: (profile.amenities || []).map((key) => AMENITIES.find((a) => a.key === key)).filter(Boolean),
        image: profile.coverImage || images?.[0]?.url || null,
        gallery: (images || []).map((image) => image.url),
        availableNow: range ? Boolean(state?.isAvailable) : undefined,
        availableRoomCount: state ? state.availableRooms.length : undefined,
        distanceKm: hotel.distance != null ? Math.round(hotel.distance / 10) / 100 : undefined,
        listingApprovedAt: hotel.publishedSnapshot?.approvedAt,
      };
    })
    .filter(Boolean);

  return ok(res, {
    hotels: results,
    count: results.length,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    filters: { applied: { q: query.q, city: query.city, type: query.type, amenities, guests: query.guests, checkIn: query.checkIn, checkOut: query.checkOut } },
  });
});

/** GET /api/hotels/:id */
exports.getHotel = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findOne({ _id: id, ...PUBLIC_FILTER }).lean();
  if (!hotel || !hotel.publishedSnapshot) throw new ApiError(404, "Hotel not found");

  const profile = hotel.publishedSnapshot.profile;
  const rooms = hotel.publishedSnapshot.rooms || [];

  return ok(res, {
    hotel: {
      id: String(hotel._id),
      ...profile,
      image: profile.coverImage || profile.images?.[0]?.url || null,
      gallery: (profile.images || []).map((image) => image.url),
      amenitiesDetail: (profile.amenities || []).map((key) => AMENITIES.find((a) => a.key === key)).filter(Boolean),
      listingApprovedAt: hotel.publishedSnapshot.approvedAt,
    },
    rooms: rooms.map((room) => ({
      ...room,
      image: room.coverImage || room.images?.[0]?.url || null,
    })),
  });
});

/** GET /api/hotels/:id/rooms */
exports.getHotelRooms = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findOne({ _id: id, ...PUBLIC_FILTER })
    .select("publishedSnapshot")
    .lean();
  if (!hotel?.publishedSnapshot) throw new ApiError(404, "Hotel not found");

  const guests = req.query.guests ? Number(req.query.guests) : null;
  const rooms = (hotel.publishedSnapshot.rooms || [])
    .filter((room) => !guests || room.maxGuests >= guests)
    .map((room) => ({ ...room, image: room.coverImage || room.images?.[0]?.url || null }));

  return ok(res, { rooms, count: rooms.length });
});

/** GET /api/hotels/:id/availability */
exports.getHotelAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) throw new ApiError(404, "Hotel not found");

  const hotel = await Hotel.findOne({ _id: id, ...PUBLIC_FILTER })
    .select("publishedSnapshot policies")
    .lean();
  if (!hotel?.publishedSnapshot) throw new ApiError(404, "Hotel not found");

  const range = validateStayRange(req.query.checkIn, req.query.checkOut, { allowPast: true, maxNights: 365 });
  const guests = req.query.guests ? Number(req.query.guests) : 1;
  const roomsWanted = req.query.rooms ? Number(req.query.rooms) : 1;

  const publishedRooms = hotel.publishedSnapshot.rooms || [];
  const roomIds = publishedRooms.map((room) => room.roomTypeId);
  const liveRooms = await RoomType.find({ _id: { $in: roomIds } })
    .select("name totalRooms pricing maxGuests bedrooms bathrooms attachedBathrooms beds maxChildren amenities images")
    .lean();
  const byId = new Map(liveRooms.map((room) => [String(room._id), room]));

  const [blocks, inventory] = await Promise.all([
    AvailabilityBlock.find({
      hotelId: id,
      isActive: true,
      startDate: { $lte: new Date(range.to.getTime() - MS_PER_DAY) },
      endDate: { $gte: range.from },
    }).lean(),
    RoomAvailability.find({
      hotelId: id,
      date: { $gte: range.from, $lte: new Date(range.to.getTime() - MS_PER_DAY) },
    })
      .select("roomTypeId date availableCount bookedCount priceOverride")
      .lean(),
  ]);

  const inventoryByKey = new Map(
    inventory.map((row) => [`${row.roomTypeId}|${toDateKey(row.date)}`, row])
  );

  const nights = eachNight(range.from, range.to);
  const policies = hotel.policies || {};
  const minStayNights = policies.minStayNights || 1;
  const maxStayNights = policies.maxStayNights || 30;
  const stayIsAllowed = range.nightCount >= minStayNights && range.nightCount <= maxStayNights;

  const rooms = publishedRooms
    .map((published) => {
      const live = byId.get(String(published.roomTypeId));
      if (!live) return null;
      if (live.maxGuests < guests) return null;

      const perNight = nights.map((night) => {
        const key = toDateKey(night);
        const blocked = blocks.some(
          (block) =>
            (block.roomTypeId == null || String(block.roomTypeId) === String(published.roomTypeId)) &&
            new Date(block.startDate).getTime() <= night.getTime() &&
            new Date(block.endDate).getTime() >= night.getTime()
        );
        const row = inventoryByKey.get(`${published.roomTypeId}|${key}`);
        return {
          date: key,
          availableCount: blocked
            ? 0
            : Math.max(0, (row?.availableCount ?? live.totalRooms ?? 0) - (row?.bookedCount ?? 0)),
          isBlocked: blocked,
          price: nightPrice(live, night, row),
        };
      });

      const isAvailable = perNight.every((night) => night.availableCount >= roomsWanted);

      return {
        roomTypeId: published.roomTypeId,
        name: published.name,
        description: published.description,
        type: published.type,
        bedrooms: published.bedrooms,
        bathrooms: published.bathrooms,
        attachedBathrooms: published.attachedBathrooms,
        beds: published.beds,
        amenities: published.amenities,
        images: published.images,
        coverImage: published.coverImage,
        maxGuests: live.maxGuests,
        maxChildren: live.maxChildren,
        totalRooms: live.totalRooms,
        pricing: published.pricing,
        isAvailable,
        nights: perNight,
        estimate: isAvailable
          ? quoteEstimate(published.pricing, perNight, guests, live.maxGuests)
          : null,
      };
    })
    .filter(Boolean);

  return ok(res, {
    range: { checkIn: toDateKey(range.from), checkOut: toDateKey(range.to), nights: range.nightCount },
    stayAllowed: stayIsAllowed,
    policy: {
      checkInTime: policies.checkInTime,
      checkOutTime: policies.checkOutTime,
      minStayNights,
      maxStayNights,
      cancellationPolicy: policies.cancellationPolicy,
      houseRules: policies.houseRules,
    },
    guests,
    rooms,
    availableRooms: rooms.filter((room) => room.isAvailable).length,
  });
});

/** GET /api/hotels/meta/filters — everything the Stay page filter needs. */
exports.getFilterMeta = asyncHandler(async (req, res) => {
  const [cities, amenityDocs, rangeAgg] = await Promise.all([
    Hotel.aggregate([
      { $match: PUBLIC_FILTER },
      { $group: { _id: "$publishedSnapshot.profile.city", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Amenity.find({ isActive: true }).sort({ category: 1, order: 1 }).lean(),
    Hotel.aggregate([
      { $match: PUBLIC_FILTER },
      {
        $group: {
          _id: null,
          min: { $min: "$publishedSnapshot.profile.priceRange.min" },
          max: { $max: "$publishedSnapshot.profile.priceRange.max" },
        },
      },
    ]),
  ]);

  // Fall back to the static catalog if the collection has not been seeded yet.
  const amenityCatalog = amenityDocs.length
    ? amenityDocs.map(({ key, label, category, icon, scope }) => ({ key, label, category, icon, scope }))
    : AMENITIES.map(({ key, label, category, icon, scope }) => ({ key, label, category, icon, scope }));

  const priceRange = rangeAgg[0] || { min: 0, max: 0 };

  return ok(res, {
    cities: cities.map((city) => ({ city: city._id, count: city.count })).filter((entry) => entry.city),
    types: ACCOMMODATION_TYPES,
    amenities: amenityCatalog,
    priceRange: {
      min: priceRange.min ?? 0,
      max: priceRange.max ?? 0,
      currency: "NPR",
    },
    totalPublished: await Hotel.countDocuments(PUBLIC_FILTER),
  });
});

/** GET /api/hotels/amenities — the public amenity catalog. */
exports.getAmenities = asyncHandler(async (req, res) => {
  const docs = await Amenity.find({ isActive: true }).sort({ category: 1, order: 1 }).lean();
  const source = docs.length
    ? docs.map(({ key, label, category, icon, scope }) => ({ key, label, category, icon, scope }))
    : AMENITIES.map(({ key, label, category, icon, scope }) => ({ key, label, category, icon, scope }));

  const grouped = source.reduce((acc, amenity) => {
    (acc[amenity.category] ||= []).push(amenity);
    return acc;
  }, {});

  return ok(res, { amenities: source, byCategory: grouped, count: source.length });
});
