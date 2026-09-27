const mongoose = require("mongoose");

/**
 * Amenity catalog.
 * ------------------------------------------------------------------
 * Hotels and room types store amenity *keys* (slugs) rather than free text,
 * so the public accommodation page can filter with a single indexed
 * query such as `{ "publishedSnapshot.profile.amenities": { $in: keys } }`.
 *
 * Seeded idempotently from `data/hotelAmenities.js` on server start.
 */
const amenitySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9_]+$/,
    },
    label: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "connectivity",
        "parking",
        "climate",
        "food",
        "bathroom",
        "bedroom",
        "facilities",
        "family",
        "outdoor",
        "policy",
      ],
    },
    /** react-icons component name, used by the customer filter checklist. */
    icon: { type: String, trim: true, default: "" },
    /** Where this amenity may be attached. */
    scope: {
      type: [String],
      enum: ["hotel", "room"],
      default: ["hotel", "room"],
    },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

amenitySchema.index({ category: 1, order: 1 });
amenitySchema.index({ isActive: 1, scope: 1 });

const Amenity = mongoose.model("Amenity", amenitySchema);
module.exports = Amenity;
