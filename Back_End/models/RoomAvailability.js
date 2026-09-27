const mongoose = require("mongoose");

/**
 * Nightly inventory for a room type.
 * ------------------------------------------------------------------
 * One row per `roomTypeId` + `date` (enforced by a unique index), which is what
 * makes oversell / double-booking impossible: an atomic guarded update can only
 * lower `availableCount` as far as the stored value allows.
 *
 * Rows are created lazily. When a night has no row it means "the full
 * `RoomType.totalRooms` are available at the room's normal pricing", so a hotel
 * does not have to pre-create a year of rows.
 */
const roomAvailabilitySchema = new mongoose.Schema(
  {
    hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },
    roomTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "RoomType", required: true, index: true },

    /** The stay night, normalised to 00:00:00 UTC. Check-out night is excluded. */
    date: { type: Date, required: true },

    status: {
      type: String,
      enum: ["available", "blocked", "booked"],
      default: "available",
    },

    /**
     * Rooms left for this night. `null` means "inherit `RoomType.totalRooms`".
     * Always kept within [0, totalRooms].
     */
    availableCount: { type: Number, min: 0, max: 500, default: null },

    /** Nights already committed by bookings. Reserved for the booking flow. */
    bookedCount: { type: Number, min: 0, max: 500, default: 0 },

    /** One-off nightly price, e.g. a festival or event night. */
    priceOverride: { type: Number, min: 0, max: 10000000, default: null },

    /** Overrides the hotel's `policies.minStayNights` for this night. */
    minStayOverride: { type: Number, min: 1, max: 365, default: null },

    note: { type: String, trim: true, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

/* ------------------------------ hard constraints ----------------------------- */
roomAvailabilitySchema.index({ roomTypeId: 1, date: 1 }, { unique: true });
roomAvailabilitySchema.index({ hotelId: 1, date: 1, status: 1 });

/* Set `availableCount` at most once per calendar night, regardless of timezone. */
roomAvailabilitySchema.pre("validate", function (next) {
  if (this.date) {
    const d = new Date(this.date);
    this.date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  next();
});

const RoomAvailability = mongoose.model("RoomAvailability", roomAvailabilitySchema);

module.exports = RoomAvailability;
