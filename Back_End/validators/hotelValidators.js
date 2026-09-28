const { body, param, query } = require("express-validator");
const { ACCOMMODATION_TYPES, LISTING_STATUSES } = require("../models/Hotel");
const { ROOM_TYPES, BED_TYPES } = require("../models/RoomType");
const { AMENITY_KEYS } = require("../utils/hotelAmenities");

/**
 * Shared express-validator chains for the hotel APIs.
 * ------------------------------------------------------------------
 * Chains are attached to the `express-validator` request objects here and run by
 * `middleware/validation.js`. Everything the dashboard submits is checked here
 * before it reaches a controller, in addition to the Mongoose schema rules.
 */

const objectId = (name = "id") =>
  param(name).isMongoId().withMessage(`"${name}" is not a valid id.`);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Trim + normalise an optional string. */
const optionalString = (name, { max = 500, required = false } = {}) => {
  let chain = body(name);
  if (required) chain = chain.exists().withMessage(`"${name}" is required.`);
  return chain
    .optional()
    .trim()
    .isLength({ max })
    .withMessage(`"${name}" must be at most ${max} characters.`)
    .customSanitizer((value) => (typeof value === "string" ? value.trim() : value));
};

const optionalNumber = (name, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) =>
  body(name)
    .optional({ values: "null" })
    .isFloat()
    .withMessage(`"${name}" must be a number.`)
    .toFloat()
    .bail()
    .custom((value) => (integer ? Number.isInteger(value) : true))
    .withMessage(`"${name}" must be${integer ? " a whole number" : ""}.`)
    .bail()
    .custom((value) => value >= min && value <= max)
    .withMessage(`"${name}" must be between ${min} and ${max}.`);

/** Coordinates arrive as `lat,lng` or as `location.coordinates[0..1]`. */
const latitude = () =>
  body("latitude")
    .optional({ values: "null" })
    .isFloat()
    .withMessage('"latitude" must be a number.')
    .toFloat()
    .bail()
    .custom((value) => value >= -90 && value <= 90)
    .withMessage('"latitude" must be between -90 and 90.');

const longitude = () =>
  body("longitude")
    .optional({ values: "null" })
    .isFloat()
    .withMessage('"longitude" must be a number.')
    .toFloat()
    .bail()
    .custom((value) => value >= -180 && value <= 180)
    .withMessage('"longitude" must be between -180 and 180.');

const isoDate = (name) =>
  body(name)
    .isISO8601()
    .withMessage(`"${name}" must be a valid date (YYYY-MM-DD).`);

const timeString = (name, { required = false } = {}) => {
  let chain = body(name);
  if (required) chain = chain.exists().withMessage(`"${name}" is required.`);
  return chain
    .optional()
    .trim()
    .matches(TIME_PATTERN)
    .withMessage(`"${name}" must be a 24-hour time such as 14:00.`);
};

/** Amenity keys are validated against the catalog in the controller as well. */
const amenitiesField = (name = "amenities") =>
  body(name)
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      if (typeof value === "string") return true;
      return false;
    })
    .withMessage(`"${name}" must be an array of amenity keys or a comma-separated string.`);

/* ------------------------------- hotel profile ------------------------------- */

const updateProfileRules = [
  optionalString("hotelName", { max: 150 }),
  body("hotelName").optional().custom((v) => !v || String(v).trim().length >= 2).withMessage('"hotelName" must be at least 2 characters.'),
  optionalString("description", { max: 6000 }),
  body("description")
    .optional()
    .custom((value) => !value || String(value).trim().length >= 20)
    .withMessage('"description" must be at least 20 characters.'),
  body("type").optional().isIn(ACCOMMODATION_TYPES).withMessage(`"type" must be one of: ${ACCOMMODATION_TYPES.join(", ")}.`),
  body("starRating").optional().isInt({ min: 1, max: 5 }).withMessage('"starRating" must be between 1 and 5.').toInt(),
  optionalString("address", { max: 400, required: true }),
  optionalString("area", { max: 150 }),
  body("city")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('"city" must be between 2 and 100 characters.'),
  optionalString("district", { max: 100 }),
  optionalString("country", { max: 80 }),
  optionalString("hotelLocation", { max: 200 }),
  latitude(),
  longitude(),
  body("location").optional().isObject().withMessage('"location" must be a GeoJSON point object.'),
  body("contact.phone")
    .optional({ values: "null" })
    .trim()
    .matches(/^[0-9+\-\s()]{5,20}$/)
    .withMessage('"contact.phone" must be a valid phone number.'),
  body("contact.alternatePhone")
    .optional({ values: "null" })
    .trim()
    .matches(/^[0-9+\-\s()]{5,20}$/)
    .withMessage('"contact.alternatePhone" must be a valid phone number.'),
  body("contact.email")
    .optional({ values: "null" })
    .trim()
    .isEmail()
    .withMessage('"contact.email" must be a valid email address.')
    .normalizeEmail(),
  body("contact.website")
    .optional({ values: "null" })
    .trim()
    .isURL({ require_protocol: false })
    .withMessage('"contact.website" must be a valid URL.'),
  body("contact.whatsapp")
    .optional({ values: "null" })
    .trim()
    .matches(/^[0-9+\-\s()]{5,20}$/)
    .withMessage('"contact.whatsapp" must be a valid phone number.'),
  amenitiesField(),
];

/* --------------------------------- policies --------------------------------- */

const updatePoliciesRules = [
  timeString("checkInTime"),
  timeString("checkOutTime"),
  body("minStayNights")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('"minStayNights" must be between 1 and 365.')
    .toInt(),
  body("maxStayNights")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('"maxStayNights" must be between 1 and 365.')
    .toInt(),
  body("policies.maxStayNights")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('"policies.maxStayNights" must be between 1 and 365.')
    .toInt(),
  body("policies.minStayNights")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage('"policies.minStayNights" must be between 1 and 365.')
    .toInt(),
  body("cancellationPolicy.freeCancellationDays")
    .optional({ values: "null" })
    .isInt({ min: 0, max: 365 })
    .withMessage('"cancellationPolicy.freeCancellationDays" must be between 0 and 365.')
    .toInt(),
  body("cancellationPolicy.nonRefundableAfterDays")
    .optional({ values: "null" })
    .isInt({ min: 0, max: 365 })
    .withMessage('"cancellationPolicy.nonRefundableAfterDays" must be between 0 and 365.')
    .toInt(),
  body("cancellationPolicy.tiers")
    .optional()
    .isArray()
    .withMessage('"cancellationPolicy.tiers" must be an array.'),
  body("cancellationPolicy.tiers.*.daysBeforeCheckIn")
    .optional()
    .isInt({ min: 0, max: 365 })
    .withMessage('Each tier needs "daysBeforeCheckIn" between 0 and 365.')
    .toInt(),
  body("cancellationPolicy.tiers.*.refundPercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Each tier needs "refundPercent" between 0 and 100.')
    .toFloat(),
  body("cancellationPolicy.tiers.*.label").optional().trim().isLength({ max: 120 }),
  body("cancellationPolicy.notes").optional().trim().isLength({ max: 2000 }),
  body("houseRules")
    .optional()
    .custom((value) => (Array.isArray(value) ? value.length <= 30 : typeof value === "string"))
    .withMessage('"houseRules" must be an array (max 30 rules) or a newline/comma separated string.'),
  optionalString("childrenPolicy", { max: 1000 }),
  optionalString("petPolicy", { max: 1000 }),
  body("childrenPolicy").optional().trim().isLength({ max: 1000 }),
  body("petPolicy").optional().trim().isLength({ max: 1000 }),
];

/* ---------------------------------- rooms ---------------------------------- */

const roomCoreRules = [
  body("name")
    .exists()
    .withMessage('"name" is required.')
    .bail()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('"name" must be between 2 and 120 characters.'),
  body("description")
    .exists()
    .withMessage('"description" is required.')
    .bail()
    .trim()
    .isLength({ min: 10, max: 4000 })
    .withMessage('"description" must be between 10 and 4000 characters.'),
  body("type").optional().isIn(ROOM_TYPES).withMessage(`"type" must be one of: ${ROOM_TYPES.join(", ")}.`),
  body("totalRooms")
    .exists()
    .withMessage('"totalRooms" is required.')
    .bail()
    .isInt({ min: 1, max: 500 })
    .withMessage('"totalRooms" must be between 1 and 500.')
    .toInt(),
  body("maxGuests")
    .exists()
    .withMessage('"maxGuests" is required.')
    .bail()
    .isInt({ min: 1, max: 50 })
    .withMessage('"maxGuests" must be between 1 and 50.')
    .toInt(),
  body("maxAdults")
    .optional({ values: "null" })
    .isInt({ min: 0, max: 50 })
    .withMessage('"maxAdults" must be between 0 and 50.')
    .toInt(),
  body("maxChildren")
    .optional({ values: "null" })
    .isInt({ min: 0, max: 50 })
    .withMessage('"maxChildren" must be between 0 and 50.')
    .toInt(),
  body("bedrooms").optional().isInt({ min: 0, max: 20 }).withMessage('"bedrooms" must be between 0 and 20.').toInt(),
  body("bathrooms").optional().isInt({ min: 0, max: 20 }).withMessage('"bathrooms" must be between 0 and 20.').toInt(),
  body("attachedBathrooms")
    .optional()
    .isInt({ min: 0, max: 20 })
    .withMessage('"attachedBathrooms" must be between 0 and 20.')
    .toInt(),
  body("sizeSqm").optional({ values: "null" }).isFloat({ min: 0, max: 10000 }).withMessage('"sizeSqm" must be between 0 and 10000.').toFloat(),
  body("beds")
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return value.length <= 10;
      if (typeof value === "string" && value.trim() === "") return true;
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) && parsed.length <= 10;
        } catch {
          return false;
        }
      }
      return false;
    })
    .withMessage('"beds" must be an array of at most 10 bed entries.'),
  body("beds.*.type").optional().isIn(BED_TYPES).withMessage(`Bed "type" must be one of: ${BED_TYPES.join(", ")}.`),
  body("beds.*.count")
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Each bed needs a "count" between 1 and 20.')
    .toInt(),
  body("isActive").optional().isBoolean().withMessage('"isActive" must be a boolean.').toBoolean(),
  amenitiesField(),
];

/**
 * Pricing chains, shared by room create/update and the pricing-only endpoint.
 *
 * @param {{requireBasePrice?: boolean}} [options]
 *   `requireBasePrice` is set for POST /rooms and PUT /rooms/:id/pricing, where a
 *   price must be supplied; it is cleared for the partial room update.
 */
const buildPricingRules = ({ requireBasePrice = false } = {}) => [
  requireBasePrice
    ? body("pricing.basePrice")
        .exists()
        .withMessage('"pricing.basePrice" is required.')
        .bail()
        .isFloat({ min: 0, max: 10000000 })
        .withMessage('"pricing.basePrice" must be between 0 and 10,000,000.')
        .toFloat()
    : body("pricing.basePrice")
        .optional({ values: "null" })
        .isFloat({ min: 0, max: 10000000 })
        .withMessage('"pricing.basePrice" must be between 0 and 10,000,000.')
        .toFloat(),
  body("pricing.weekendPrice")
    .optional({ values: "null" })
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('"pricing.weekendPrice" must be between 0 and 10,000,000.')
    .toFloat(),
  body("pricing.seasonalPrice")
    .optional({ values: "null" })
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('"pricing.seasonalPrice" must be between 0 and 10,000,000.')
    .toFloat(),
  body("pricing.extraGuestPrice")
    .optional()
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('"pricing.extraGuestPrice" must be between 0 and 10,000,000.')
    .toFloat(),
  body("pricing.childPrice")
    .optional()
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('"pricing.childPrice" must be between 0 and 10,000,000.')
    .toFloat(),
  body("pricing.discountPercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('"pricing.discountPercent" must be between 0 and 100.')
    .toFloat(),
  body("pricing.discountAmount")
    .optional()
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('"pricing.discountAmount" must be between 0 and 10,000,000.')
    .toFloat(),
  body("pricing.taxPercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('"pricing.taxPercent" must be between 0 and 100.')
    .toFloat(),
  body("pricing.serviceFeePercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('"pricing.serviceFeePercent" must be between 0 and 100.')
    .toFloat(),
  body("pricing.currency").optional().trim().isLength({ min: 3, max: 5 }).withMessage('"pricing.currency" must be a 3-letter code.'),
  body("pricing.seasonalRates")
    .optional()
    .isArray()
    .withMessage('"pricing.seasonalRates" must be an array.'),
  body("pricing.seasonalRates.*.startDate").optional().isISO8601().withMessage('Each seasonal rate needs a valid "startDate".'),
  body("pricing.seasonalRates.*.endDate").optional().isISO8601().withMessage('Each seasonal rate needs a valid "endDate".'),
  body("pricing.seasonalRates.*.price")
    .optional()
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('Each seasonal rate needs a "price" between 0 and 10,000,000.')
    .toFloat(),
  body("pricing.seasonalRates.*.minStayNights")
    .optional({ values: "null" })
    .isInt({ min: 1, max: 365 })
    .withMessage('Each seasonal rate "minStayNights" must be between 1 and 365.')
    .toInt(),
];

/** `basePrice` is mandatory when creating a room or replacing its price sheet. */
const pricingRules = buildPricingRules({ requireBasePrice: true });
/** Same chains, but `basePrice` may be omitted on a partial room update. */
const partialPricingRules = buildPricingRules();

const createRoomRules = [...roomCoreRules, ...pricingRules];
const updateRoomRules = [
  body("name").optional().trim().isLength({ min: 2, max: 120 }).withMessage('"name" must be between 2 and 120 characters.'),
  body("description").optional().trim().isLength({ min: 10, max: 4000 }).withMessage('"description" must be between 10 and 4000 characters.'),
  body("type").optional().isIn(ROOM_TYPES).withMessage(`"type" must be one of: ${ROOM_TYPES.join(", ")}.`),
  body("totalRooms").optional().isInt({ min: 1, max: 500 }).withMessage('"totalRooms" must be between 1 and 500.').toInt(),
  body("maxGuests").optional().isInt({ min: 1, max: 50 }).withMessage('"maxGuests" must be between 1 and 50.').toInt(),
  body("maxAdults").optional({ values: "null" }).isInt({ min: 0, max: 50 }).withMessage('"maxAdults" must be between 0 and 50.').toInt(),
  body("maxChildren").optional({ values: "null" }).isInt({ min: 0, max: 50 }).withMessage('"maxChildren" must be between 0 and 50.').toInt(),
  body("bedrooms").optional().isInt({ min: 0, max: 20 }).withMessage('"bedrooms" must be between 0 and 20.').toInt(),
  body("bathrooms").optional().isInt({ min: 0, max: 20 }).withMessage('"bathrooms" must be between 0 and 20.').toInt(),
  body("attachedBathrooms").optional().isInt({ min: 0, max: 20 }).withMessage('"attachedBathrooms" must be between 0 and 20.').toInt(),
  body("sizeSqm").optional({ values: "null" }).isFloat({ min: 0, max: 10000 }).withMessage('"sizeSqm" must be between 0 and 10000.').toFloat(),
  body("beds").optional().custom((value) => Array.isArray(value) ? value.length <= 10 : typeof value === "string"),
  body("beds.*.type").optional().isIn(BED_TYPES),
  body("beds.*.count").optional().isInt({ min: 1, max: 20 }).toInt(),
  body("isActive").optional().isBoolean().withMessage('"isActive" must be a boolean.').toBoolean(),
  ...partialPricingRules,
  amenitiesField(),
];

/* ------------------------------- availability ------------------------------- */

const rangeQueryRules = [
  query("from").exists().withMessage('"from" is required.').bail().isISO8601().withMessage('"from" must be a valid date.'),
  query("to").exists().withMessage('"to" is required.').bail().isISO8601().withMessage('"to" must be a valid date.'),
];

const setAvailabilityRules = [
  ...rangeQueryRules,
  body("availableCount")
    .optional({ values: "null" })
    .isInt({ min: 0, max: 500 })
    .withMessage('"availableCount" must be between 0 and 500.')
    .toInt(),
  body("priceOverride")
    .optional({ values: "null" })
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('"priceOverride" must be between 0 and 10,000,000.')
    .toFloat(),
  body("minStayOverride")
    .optional({ values: "null" })
    .isInt({ min: 1, max: 365 })
    .withMessage('"minStayOverride" must be between 1 and 365.')
    .toInt(),
  body("note").optional().trim().isLength({ max: 500 }),
  body().custom((value) => {
    const hasAny =
      value.availableCount !== undefined ||
      value.priceOverride !== undefined ||
      value.minStayOverride !== undefined ||
      (value.note !== undefined && value.note !== "");
    if (!hasAny) throw new Error("Provide at least one of availableCount, priceOverride, minStayOverride or note.");
    return true;
  }),
];

const createBlockRules = [
  isoDate("startDate"),
  isoDate("endDate"),
  body("roomTypeId")
    .optional({ values: "null" })
    .isMongoId()
    .withMessage('"roomTypeId" must be a valid room id (omit it to block the whole property).'),
  body("reason").optional().trim().isLength({ max: 500 }),
];

/* --------------------------------- listing --------------------------------- */

const listingActionRules = [
  body("reason").optional().trim().isLength({ max: 1000 }),
];

/* ---------------------------------- public --------------------------------- */

const publicListRules = [
  query("q").optional().trim().isLength({ max: 120 }),
  query("city").optional().trim().isLength({ max: 100 }),
  query("type").optional().isIn(ACCOMMODATION_TYPES).withMessage(`"type" must be one of: ${ACCOMMODATION_TYPES.join(", ")}.`),
  query("minPrice").optional().isFloat({ min: 0 }).toFloat(),
  query("maxPrice").optional().isFloat({ min: 0 }).toFloat(),
  query("guests").optional().isInt({ min: 1, max: 50 }).toInt(),
  query("rooms").optional().isInt({ min: 1, max: 20 }).toInt(),
  query("checkIn").optional().isISO8601().withMessage('"checkIn" must be a valid date.'),
  query("checkOut").optional().isISO8601().withMessage('"checkOut" must be a valid date.'),
  query("amenities")
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) return true;
      return typeof value === "string" && value.length <= 600;
    })
    .withMessage('"amenities" must be amenity keys (repeat the parameter or send a comma-separated list).'),
  query("sort")
    .optional()
    .isIn(["recommended", "price-asc", "price-desc", "rating", "name", "newest", "distance"])
    .withMessage('"sort" must be one of: recommended, price-asc, price-desc, rating, name, newest, distance.'),
  query("page").optional().isInt({ min: 1, max: 10000 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 50 }).toInt(),
  query("lat").optional().isFloat({ min: -90, max: 90 }).toFloat(),
  query("lng").optional().isFloat({ min: -180, max: 180 }).toFloat(),
  query("radiusKm").optional().isFloat({ min: 0.1, max: 500 }).toFloat(),
  query("starRating").optional().isInt({ min: 1, max: 5 }).toInt(),
];

const publicAvailabilityRules = [
  query("checkIn").exists().withMessage('"checkIn" is required.').bail().isISO8601(),
  query("checkOut").exists().withMessage('"checkOut" is required.').bail().isISO8601(),
  query("guests").optional().isInt({ min: 1, max: 50 }).toInt(),
  query("rooms").optional().isInt({ min: 1, max: 20 }).toInt(),
];

const adminListRules = [
  query("listingStatus").optional().isIn(LISTING_STATUSES).withMessage(`"listingStatus" must be one of: ${LISTING_STATUSES.join(", ")}.`),
  query("applicationStatus").optional().isIn(["pending", "approved", "declined"]),
  query("isActive").optional().isBoolean().withMessage('"isActive" must be true or false.'),
  query("city").optional().trim().isLength({ max: 100 }),
  query("q").optional().trim().isLength({ max: 120 }),
  query("page").optional().isInt({ min: 1, max: 10000 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

const reviewRules = [
  body("reason").optional().trim().isLength({ max: 1000 }),
];

const rejectRules = [
  body("reason")
    .exists()
    .withMessage('"reason" is required when rejecting a listing.')
    .bail()
    .trim()
    .isLength({ min: 5, max: 1000 })
    .withMessage('"reason" must be between 5 and 1000 characters.'),
];

module.exports = {
  objectId,
  updateProfileRules,
  updatePoliciesRules,
  createRoomRules,
  updateRoomRules,
  pricingRules,
  setAvailabilityRules,
  createBlockRules,
  listingActionRules,
  publicListRules,
  publicAvailabilityRules,
  adminListRules,
  reviewRules,
  rejectRules,
  AMENITY_KEYS,
};
