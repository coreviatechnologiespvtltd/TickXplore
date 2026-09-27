const mongoose = require("mongoose");

/**
 * Per-year counters behind the user-facing Booking Number.
 *
 * One document per year, e.g. `{ _id: "2026", seq: 42 }`. Because the year *is*
 * the `_id`, a `findOneAndUpdate` + `$inc` is a single atomic document
 * operation — that is what makes concurrent booking creation safe.
 *
 * Deliberately kept in its own `booking_sequences` collection rather than a
 * generic `counters` one, so it can never inherit a conflicting index from
 * another sequence library.
 */
const BookingSequenceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, _id: false, versionKey: false }
);

const BookingSequence = mongoose.model(
  "BookingSequence",
  BookingSequenceSchema,
  "booking_sequences"
);

module.exports = BookingSequence;
