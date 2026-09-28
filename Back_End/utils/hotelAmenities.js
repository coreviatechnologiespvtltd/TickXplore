const Amenity = require("../models/Amenity");
const { HOTEL_AMENITIES } = require("../data/hotelAmenities");
const { ApiError } = require("./http");

/**
 * Amenity catalog helpers.
 * ------------------------------------------------------------------
 * The static catalog in `data/hotelAmenities.js` is the source of truth used for
 * validation, so validation keeps working even before the catalog has been
 * seeded into MongoDB. `seedAmenityCatalog()` then mirrors it into the
 * `amenities` collection for the public filter checklist.
 */

const AMENITIES = HOTEL_AMENITIES;
const AMENITY_KEYS = AMENITIES.map((a) => a.key);
const AMENITY_KEY_SET = new Set(AMENITY_KEYS);
const AMENITY_MAP = new Map(AMENITIES.map((a) => [a.key, a]));

/**
 * Coerce incoming amenity input into a flat list of raw key candidates.
 * Accepts an array, a comma-separated string or a JSON string (multipart forms
 * can only send strings).
 */
const parseAmenityInput = (input) => {
  let raw = input;

  if (raw == null || raw === "") return [];

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed.split(",");
      }
    } else {
      raw = trimmed.split(",");
    }
  }

  if (!Array.isArray(raw)) raw = [raw];

  return raw
    .map((value) => (typeof value === "string" ? value : value?.key))
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, "_"));
};

/**
 * Coerce incoming amenity input into a deduplicated array of known keys.
 * Unknown keys are dropped silently — use {@link assertValidAmenities} when the
 * client should be told about them.
 *
 * @returns {string[]} sorted, de-duplicated, valid amenity keys
 */
const normalizeAmenities = (input) =>
  [...new Set(parseAmenityInput(input).filter((key) => AMENITY_KEY_SET.has(key)))].sort();

/**
 * Validate amenity keys, rejecting unknown ones with a helpful 400.
 *
 * @param {unknown} input
 * @param {"hotel"|"room"} scope Restrict to amenities available at this level
 */
const assertValidAmenities = (input, scope) => {
  const requested = [...new Set(parseAmenityInput(input))];

  const unknown = requested.filter((key) => !AMENITY_KEY_SET.has(key));
  if (unknown.length > 0) {
    throw new ApiError(400, `Unknown amenity key(s): ${unknown.join(", ")}`, {
      unknown,
      validKeys: AMENITY_KEYS,
    });
  }

  const outOfScope = requested.filter((key) => {
    const amenity = AMENITY_MAP.get(key);
    return amenity && scope && !amenity.scope.includes(scope);
  });
  if (outOfScope.length > 0) {
    throw new ApiError(
      400,
      `Amenity key(s) not available at the ${scope} level: ${outOfScope.join(", ")}`,
      {
        outOfScope,
        validKeys: AMENITY_KEYS.filter((key) => AMENITY_MAP.get(key).scope.includes(scope)),
      }
    );
  }

  return normalizeAmenities(input);
};

/** Static catalog grouped by category — used to seed and as a DB-free fallback. */
const catalogByCategory = () =>
  AMENITIES.reduce((acc, amenity) => {
    (acc[amenity.category] ||= []).push(amenity);
    return acc;
  }, {});

/**
 * Idempotently mirror the static catalog into MongoDB.
 * Safe to call on every boot; never throws (seeding is not critical path).
 *
 * @returns {Promise<{ok: boolean, count?: number, error?: string}>}
 */
const seedAmenityCatalog = async () => {
  try {
    const operations = AMENITIES.map((amenity, index) => ({
      updateOne: {
        filter: { key: amenity.key },
        update: {
          $set: {
            label: amenity.label,
            category: amenity.category,
            icon: amenity.icon,
            scope: amenity.scope,
            isActive: true,
            order: index,
          },
        },
        upsert: true,
      },
    }));

    const result = await Amenity.bulkWrite(operations, { ordered: false });
    return { ok: true, count: result.upsertedCount + result.modifiedCount };
  } catch (error) {
    console.warn("  Amenity catalog seed skipped:", error.message);
    return { ok: false, error: error.message };
  }
};

module.exports = {
  AMENITIES,
  AMENITY_KEYS,
  AMENITY_MAP,
  normalizeAmenities,
  assertValidAmenities,
  catalogByCategory,
  seedAmenityCatalog,
};
