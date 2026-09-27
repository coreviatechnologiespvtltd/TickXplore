const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    /* Walk-in customer contact (used when there is no registered user account) */
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    customerEmail: { type: String, trim: true },
    /* Ticket reference shown to the customer, "<YEAR><4-digit sequence>",
       e.g. "20260001". Generated once by utils/bookingNumber.js and never
       changed afterwards; numbers issued before the width changed keep their
       5-digit form. `sparse` keeps pre-migration rows without a number
       from colliding on the unique index. */
    bookingNumber: { type: String, trim: true },
    /* Email + PDF ticket delivery tracking */
    emailStatus: {
      type: String,
      enum: ["Sent", "Pending", "Failed", "None"],
      default: "Pending",
    },
    emailSentAt: { type: Date },
    emailError: { type: String, trim: true },
    /* Per-seat passenger details for vendor-assisted bookings */
    passengers: [
      {
        name: { type: String, trim: true, default: "" },
        phone: { type: String, trim: true, default: "" },
        _id: false,
      },
    ],
    busId: { type: mongoose.Schema.Types.ObjectId, ref: "Bus" },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },

    selectedSeats: [{ type: Number }],
    totalPrice: { type: Number, required: true },
    transactionId: { type: String, unique: true },
    purchaseOrderId: { type: String },
    status: {
      type: String,
      enum: ["Pending", "Booked", "Cancelled"],
      default: "Pending",
    },

    takeOffDate: { type: Date },
    reservationDate: { type: Date },
    pickupPoint: { type: String, default: "N/A" },
    dropPoint: { type: String, default: "N/A" },

    paymentMethod: {
      type: String,
      enum: ["Online", "CashOnVisit"],
      default: "Online"
    },
    paymentStatus: {
      type: String,
      enum: ["Paid", "Pending", "CashOnVisit"],
      default: "Pending"
    },

    isRefunded: { type: Boolean, default: false },
    refundAmount: { type: Number, default: 0 },
    refundDate: { type: Date },

    // ✅ Commission fields
    commissionAmount: { type: Number, default: 0 },
    vendorEarnings: { type: Number, default: 0 },

    // ✅ Settlement guard: true once vendor/admin/user side-effects have run
    settlementDone: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/* The database-level guarantee that two bookings can never share a ticket
   number, even if the application layer is bypassed. */
BookingSchema.index({ bookingNumber: 1 }, { unique: true, sparse: true });
BookingSchema.index({ takeOffDate: 1 });
BookingSchema.index({ reservationDate: 1 });

module.exports = mongoose.model("Booking", BookingSchema);
