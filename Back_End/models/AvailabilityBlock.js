const mongoose = require("mongoose");

/**
 * Date-range blackout.
 * ------------------------------------------------------------------
 * A block with no `roomTypeId` closes the whole property; with a `roomTypeId`
 * it closes only that room type. Blocking is *additive*: effective availability
 * for a night is the minimum of the hotel block, the room block and the nightly
 * inventory, so a block can never be bypassed by editing availability counts.
 */
const availabilityBlockSchema = new mongoose.Schema(
  {
    hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },

    /** `null` => the entire property is closed for the range. */
    roomTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomType",
      default: null,
      index: true,
    },

    /** Inclusive first closed night. */
    startDate: { type: Date, required: true },
    /** Inclusive last closed night (a stay may still check out on this day). */
    endDate: { type: Date, required: true },

    reason: { type: String, trim: true, default: "", maxlength: 500 },
    isActive: { type: Boolean, default: true },
    source: { type: String, enum: ["hotel", "admin"], default: "hotel" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" },
  },
  { timestamps: true }
);

availabilityBlockSchema.pre("validate", function (next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    this.invalidate("endDate", "End date cannot be earlier than the start date");
  }
  next();
});

availabilityBlockSchema.index({ hotelId: 1, roomTypeId: 1, startDate: 1, endDate: 1 });
availabilityBlockSchema.index({ hotelId: 1, isActive: 1, startDate: 1, endDate: 1 });

const AvailabilityBlock = mongoose.model("AvailabilityBlock", availabilityBlockSchema);

module.exports = AvailabilityBlock;
