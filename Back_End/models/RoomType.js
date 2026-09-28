const mongoose = require("mongoose");

/** Room categories used to describe a room type in the dashboard. */
const ROOM_TYPES = [
  "Standard",
  "Deluxe",
  "Superior",
  "Executive",
  "Suite",
  "Family Suite",
  "Studio",
  "Villa",
  "Bungalow",
  "Dormitory",
];

const BED_TYPES = [
  "king",
  "queen",
  "double",
  "twin",
  "single",
  "bunk",
  "sofa",
  "cot",
  "crib",
];

const roomImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true, default: "", maxlength: 200 },
    order: { type: Number, default: 0 },
    isCover: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const bedSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, enum: BED_TYPES },
    count: { type: Number, required: true, min: 1, max: 20, default: 1 },
  },
  { _id: false }
);

/**
 * Per-night price configuration for a room type.
 * A missing optional override falls back to `basePrice`.
 */
const pricingSchema = new mongoose.Schema(
  {
    currency: { type: String, trim: true, uppercase: true, default: "NPR", maxlength: 5 },
    basePrice: { type: Number, required: true, min: 0, max: 10000000 },
    /** Applied on Friday/Saturday nights. Falls back to `basePrice` when null. */
    weekendPrice: { type: Number, min: 0, max: 10000000, default: null },
    /** Applied on dates inside the hotel's seasonal windows. Falls back to `basePrice`. */
    seasonalPrice: { type: Number, min: 0, max: 10000000, default: null },
    /** Precise date windows that override the nightly price. */
    seasonalRates: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, trim: true, default: "", maxlength: 100 },
            startDate: { type: Date, required: true },
            endDate: { type: Date, required: true },
            price: { type: Number, required: true, min: 0, max: 10000000 },
            minStayNights: { type: Number, min: 1, max: 365, default: null },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    /** Charged for each guest above the room's included occupancy. */
    extraGuestPrice: { type: Number, min: 0, max: 10000000, default: 0 },
    /** Charged per child above the included occupancy. */
    childPrice: { type: Number, min: 0, max: 10000000, default: 0 },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    discountAmount: { type: Number, min: 0, max: 10000000, default: 0 },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    serviceFeePercent: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

const roomTypeSchema = new mongoose.Schema(
  {
    /** Ownership anchor — every hotel query is scoped by this field. */
    hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, default: "", maxlength: 4000 },
    type: { type: String, enum: ROOM_TYPES, default: "Standard" },

    /* ------------------------------ inventory ------------------------------ */
    /** Physical number of rooms of this type — the ceiling for availability. */
    totalRooms: { type: Number, required: true, min: 1, max: 500 },

    /* ------------------------------ capacity ------------------------------ */
    maxGuests: { type: Number, required: true, min: 1, max: 50 },
    maxAdults: { type: Number, min: 0, max: 50, default: null },
    maxChildren: { type: Number, min: 0, max: 50, default: 0 },
    bedrooms: { type: Number, min: 0, max: 20, default: 1 },
    bathrooms: { type: Number, min: 0, max: 20, default: 1 },
    attachedBathrooms: { type: Number, min: 0, max: 20, default: 0 },
    beds: { type: [bedSchema], default: [] },
    sizeSqm: { type: Number, min: 0, max: 10000, default: null },

    /* ------------------------------- pricing ------------------------------- */
    pricing: { type: pricingSchema, required: true },

    /* ------------------------------ amenities ------------------------------ */
    amenities: { type: [String], default: [] },
    images: { type: [roomImageSchema], default: [] },

    isActive: { type: Boolean, default: true },
    /** Soft-delete: archived rooms keep their history for future bookings. */
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date },

    /* --------------------- reserved for bookings / reviews --------------------- */
    ratingSummary: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    totalEarnings: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* --------------------------- document validation --------------------------- */
roomTypeSchema.pre("validate", function (next) {
  if (this.maxAdults != null && this.maxAdults > this.maxGuests) {
    this.invalidate("maxAdults", "Maximum adults cannot exceed maximum guests");
  }
  if (this.maxChildren != null && this.maxChildren > this.maxGuests) {
    this.invalidate("maxChildren", "Maximum children cannot exceed maximum guests");
  }
  if (this.attachedBathrooms > this.bathrooms) {
    this.invalidate("attachedBathrooms", "Attached bathrooms cannot exceed total bathrooms");
  }

  (this.pricing?.seasonalRates || []).forEach((rate, index) => {
    if (rate.startDate && rate.endDate && rate.endDate < rate.startDate) {
      this.invalidate(`pricing.seasonalRates.${index}.endDate`, {
        message: "Seasonal rate end date cannot be earlier than its start date",
      });
    }
  });

  const beds = this.beds || [];
  if (beds.length > 0) {
    const bedGuestCapacity = beds.reduce(
      (sum, bed) => sum + bed.count * (bed.type === "single" || bed.type === "bunk" ? 1 : 2),
      0
    );
    if (bedGuestCapacity < this.maxGuests) {
      this.invalidate(
        "beds",
        `The configured beds sleep ${bedGuestCapacity} guest(s) but maxGuests is ${this.maxGuests}`
      );
    }
  }

  next();
});

/* --------------------------------- indexes --------------------------------- */
/* One room of a given name per hotel. The partial filter frees the name again
   once the room is soft-archived. */
roomTypeSchema.index({ hotelId: 1, name: 1 }, {
  unique: true,
  partialFilterExpression: { isArchived: false },
});
roomTypeSchema.index({ hotelId: 1, isArchived: 1, isActive: 1 });
roomTypeSchema.index({ hotelId: 1, "pricing.basePrice": 1 });

const RoomType = mongoose.model("RoomType", roomTypeSchema);

module.exports = RoomType;
module.exports.ROOM_TYPES = ROOM_TYPES;
module.exports.BED_TYPES = BED_TYPES;
