const mongoose = require("mongoose");
const uniqueValidator = require("mongoose-unique-validator");

/** Property kinds supported by the accommodation platform. */
const ACCOMMODATION_TYPES = [
  "Hotel",
  "Villa",
  "Apartment",
  "Guest House",
  "Private Room",
  "Resort",
  "Lodge",
  "Homestay",
];

/** Lifecycle of the hotel *listing* (separate from the `isActive` account gate). */
const LISTING_STATUSES = [
  "draft",
  "pending_approval",
  "published",
  "rejected",
  "suspended",
  "archived",
];

/** `HH:mm` in 24-hour form. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const hotelImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true, default: "", maxlength: 200 },
    order: { type: Number, default: 0 },
    isCover: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/**
 * One tier of the structured cancellation policy.
 * `daysBeforeCheckIn` is a *threshold*: refund `refundPercent` when the guest
 * cancels at least this many days before arrival.
 */
const cancellationTierSchema = new mongoose.Schema(
  {
    daysBeforeCheckIn: { type: Number, required: true, min: 0, max: 365 },
    refundPercent: { type: Number, required: true, min: 0, max: 100 },
    label: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const cancellationPolicySchema = new mongoose.Schema(
  {
    /** Free cancellation up to N days before check-in. */
    freeCancellationDays: { type: Number, default: 3, min: 0, max: 365 },
    /** Non-refundable once the stay is within N days of check-in. */
    nonRefundableAfterDays: { type: Number, default: 0, min: 0, max: 365 },
    /** Ordered, most-generous first. */
    tiers: { type: [cancellationTierSchema], default: [] },
    notes: { type: String, trim: true, default: "", maxlength: 2000 },
  },
  { _id: false }
);

const policiesSchema = new mongoose.Schema(
  {
    checkInTime: { type: String, default: "14:00", trim: true, match: TIME_PATTERN },
    checkOutTime: { type: String, default: "11:00", trim: true, match: TIME_PATTERN },
    minStayNights: { type: Number, default: 1, min: 1, max: 365 },
    maxStayNights: { type: Number, default: 30, min: 1, max: 365 },
    cancellationPolicy: { type: cancellationPolicySchema, default: () => ({}) },
    houseRules: { type: [String], default: [] },
    childrenPolicy: { type: String, trim: true, default: "", maxlength: 1000 },
    petPolicy: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    phone: { type: String, trim: true, default: "", maxlength: 20 },
    alternatePhone: { type: String, trim: true, default: "", maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, default: "" },
    website: { type: String, trim: true, default: "", maxlength: 300 },
    whatsapp: { type: String, trim: true, default: "", maxlength: 20 },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: [...LISTING_STATUSES, null], default: null },
    to: { type: String, enum: LISTING_STATUSES, required: true },
    reason: { type: String, trim: true, default: "", maxlength: 1000 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel" },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/**
 * The last admin-approved version of the listing.
 * ------------------------------------------------------------------
 * Public APIs never read live listing content — they read this frozen snapshot.
 * A hotel editing a published listing therefore does NOT instantly change what
 * customers see; the change becomes public only after re-approval.
 */
const publishedSnapshotSchema = new mongoose.Schema(
  {
    version: { type: Number, default: 0 },
    approvedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    /** Hash of the snapshotted content, used to flag unpublished edits. */
    contentHash: { type: String, default: "" },
    profile: { type: mongoose.Schema.Types.Mixed },
    rooms: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

const statusMetaSchema = new mongoose.Schema(
  {
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    rejectionReason: { type: String, trim: true, default: "" },
    publishedAt: { type: Date },
    suspendedAt: { type: Date },
    suspendedReason: { type: String, trim: true, default: "" },
    archivedAt: { type: Date },
  },
  { _id: false }
);

const hotelSchema = new mongoose.Schema(
  {
    /* ----------------------------- account ----------------------------- */
    hotelId: {
      type: String,
      required: true,
      unique: true,
      default: () => `H${Math.floor(Math.random() * 1000000)}`,
    },
    hotelName: { type: String, required: false, default: "", trim: true, maxlength: 150 },
    hotelLocation: { type: String, required: false, default: "Pending", trim: true, maxlength: 200 },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/,
    },
    phoneNumber: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      match: /^[0-9]{7,15}$/,
    },
    password: { type: String, required: false, minlength: 6 },
    googleId: { type: String, sparse: true },
    role: {
      type: String,
      required: true,
      enum: ["hotel"],
      default: "hotel",
    },
    /** Admin activation gate — separate from the listing approval workflow. */
    isActive: { type: Boolean, default: false },
    applicationStatus: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
    },
    applicationReason: { type: String, default: "", trim: true },
    resetCode: String,
    resetCodeExpires: Date,
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false },
    profilePhoto: { type: String, default: "" },

    /* --------------------------- listing content --------------------------- */
    description: { type: String, trim: true, default: "", maxlength: 6000 },
    type: { type: String, enum: ACCOMMODATION_TYPES, default: "Hotel" },
    starRating: { type: Number, min: 1, max: 5, default: 3 },
    /** `checkIn` from the booking search form; used for "available now" style messaging. */
    contact: { type: contactSchema, default: () => ({}) },
    address: { type: String, trim: true, default: "", maxlength: 400 },
    area: { type: String, trim: true, default: "", maxlength: 150 },
    city: { type: String, trim: true, default: "", maxlength: 100 },
    district: { type: String, trim: true, default: "", maxlength: 100 },
    country: { type: String, trim: true, default: "Nepal", maxlength: 80 },
    /** GeoJSON point — [longitude, latitude] — for proximity search. */
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: undefined,
        validate: {
          validator: (coords) =>
            !coords ||
            coords.length === 0 ||
            (coords.length === 2 &&
              coords[0] >= -180 &&
              coords[0] <= 180 &&
              coords[1] >= -90 &&
              coords[1] <= 90),
          message:
            "location.coordinates must be [longitude (-180..180), latitude (-90..90)]",
        },
      },
    },
    amenities: { type: [String], default: [] },
    images: { type: [hotelImageSchema], default: [] },
    /** Denormalised URL of the image flagged `isCover` (or the first image). */
    coverImage: { type: String, default: "" },
    policies: { type: policiesSchema, default: () => ({}) },

    /* ------------------------------ lifecycle ------------------------------ */
    listingStatus: {
      type: String,
      enum: LISTING_STATUSES,
      default: "draft",
      index: true,
    },
    statusMeta: { type: statusMetaSchema, default: () => ({}) },
    statusHistory: { type: [statusHistorySchema], default: [] },
    publishedSnapshot: { type: publishedSnapshotSchema, default: undefined },

    /* --------------------- reserved for bookings / reviews --------------------- */
    ratingSummary: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
    },
    totalEarnings: { type: Number, default: 0 },
    totalCommission: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* --------------------------- document validation --------------------------- */
hotelSchema.pre("validate", function (next) {
  const policies = this.policies;
  if (policies && policies.maxStayNights < policies.minStayNights) {
    this.invalidate("policies.maxStayNights", {
      message: "Maximum stay must be greater than or equal to the minimum stay",
    });
  }

  const cancellation = policies && policies.cancellationPolicy;
  // "Free cancellation up to N days out" and "non-refundable within M days" are
  // only contradictory when the non-refundable window opens *earlier* than the
  // free window closes, i.e. when M > N. The comparison used to be inverted,
  // which rejected the schema's own defaults (free 3 / non-refundable 0) and
  // made every `Hotel.create()` — including registration — fail validation.
  if (cancellation && cancellation.nonRefundableAfterDays > cancellation.freeCancellationDays) {
    this.invalidate("policies.cancellationPolicy.nonRefundableAfterDays", {
      message: "Cannot be greater than the free-cancellation window",
    });
  }

  next();
});

/* -------------------------------- virtuals -------------------------------- */
hotelSchema.virtual("latitude").get(function () {
  return this.location?.coordinates?.[1] ?? null;
});

hotelSchema.virtual("longitude").get(function () {
  return this.location?.coordinates?.[0] ?? null;
});

hotelSchema.virtual("isPublished").get(function () {
  return this.listingStatus === "published" && Boolean(this.publishedSnapshot);
});

/* --------------------------------- indexes --------------------------------- */
hotelSchema.index({ "publishedSnapshot.profile.city": 1 });
hotelSchema.index({ "publishedSnapshot.profile.type": 1 });
hotelSchema.index({ "publishedSnapshot.profile.amenities": 1 });
hotelSchema.index({ "publishedSnapshot.profile.priceRange.min": 1 });
hotelSchema.index({ city: 1, listingStatus: 1 });
hotelSchema.index(
  { location: "2dsphere" },
  { sparse: true, partialFilterExpression: { "location.coordinates": { $exists: true } } }
);

/* A hotel may have at most one live listing per registered email (identity is
   already unique); the plugin keeps parity with the other role models. */
hotelSchema.plugin(uniqueValidator, { message: "{PATH} must be unique." });

const Hotel = mongoose.model("Hotel", hotelSchema);

module.exports = Hotel;
module.exports.ACCOMMODATION_TYPES = ACCOMMODATION_TYPES;
module.exports.LISTING_STATUSES = LISTING_STATUSES;
