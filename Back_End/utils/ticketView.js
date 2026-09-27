const {
  formatTakeoffDate,
  formatTakeoffTime,
  formatTakeoffDateTime,
  toDate,
} = require("./datetime");

/**
 * The canonical set of values a ticket shows.
 *
 * Both the emailed PDF/HTML (server side) and the in-app ticket card /
 * downloadable PDF (client side) build this exact shape from the same database
 * fields, so a customer never sees one take-off time in the app and a
 * different one in their inbox.
 *
 * Field precedence, highest first:
 *   1. the value snapshotted on the booking at creation time
 *   2. the referenced Bus / Vehicle document
 * Nothing is invented: no fallbacks to "now" or to the booking creation time.
 */

const PLACEHOLDER = "N/A";

/** 4-per-row seat layout (A1…D1, E1…) shared with the seat map. */
function formatSeatLabel(seat) {
  const n = Number(seat);
  if (!Number.isFinite(n) || n <= 0) return String(seat);
  const row = Math.floor((n - 1) / 4);
  const col = ((n - 1) % 4) + 1;
  return `${String.fromCharCode(65 + row)}${col}`;
}

/**
 * True only for a document that is already populated.
 *
 * A BSON ObjectId is also `typeof "object"`, so a bare reference would otherwise
 * look populated and the Bus/Vehicle lookup would be skipped entirely.
 */
const isPopulated = (ref) => {
  if (!ref || typeof ref !== "object") return false;
  if (ref._bsontype === "ObjectId" || ref._bsontype === "ObjectID") return false;
  if (typeof ref.toHexString === "function" && typeof ref.equals === "function") return false;
  return true;
};
const text = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed !== PLACEHOLDER ? trimmed : "";
};

/** Resolve the Bus or Vehicle a booking refers to, populating on demand. */
async function resolveItem(booking) {
  const Bus = require("../models/Bus");
  const Vehicle = require("../models/Vehicle");

  if (booking.busId) {
    const bus = isPopulated(booking.busId)
      ? booking.busId
      : await Bus.findById(booking.busId).catch(() => null);
    return { type: "bus", item: bus || null };
  }
  if (booking.vehicleId) {
    const vehicle = isPopulated(booking.vehicleId)
      ? booking.vehicleId
      : await Vehicle.findById(booking.vehicleId).catch(() => null);
    return { type: "vehicle", item: vehicle || null };
  }
  return { type: null, item: null };
}

/**
 * @param {object} booking  a Booking document (populated or plain)
 * @returns {Promise<object>} ticket view model
 */
async function buildTicketView(booking) {
  const { type, item } = await resolveItem(booking);
  const passengers = (booking.passengers || []).filter((p) => p && p.name);

  /* --- passenger -------------------------------------------------- */
  const passengerName =
    text(booking.customerName) ||
    (isPopulated(booking.userId) ? text(booking.userId.name) : "") ||
    passengers[0]?.name?.trim() ||
    PLACEHOLDER;

  const passengerPhone =
    text(booking.customerPhone) ||
    (isPopulated(booking.userId) ? text(booking.userId.phoneNumber) : "") ||
    passengers[0]?.phone?.trim() ||
    PLACEHOLDER;

  /* --- transport --------------------------------------------------- */
  const isBus = type === "bus";
  const busName = isBus ? text(item?.name) || PLACEHOLDER : PLACEHOLDER;

  /* --- seat (from the vehicle's own seat configuration) ------------ */
  const selectedSeats = (booking.selectedSeats || []).map(Number).filter(Number.isFinite);
  const seatLabels = selectedSeats.map(formatSeatLabel);
  const seatLabel = isBus
    ? seatLabels.join(", ") || PLACEHOLDER
    : "Whole vehicle";

  /* --- route: pickup + dropping point ------------------------------ */
  const pickupPoint =
    text(booking.pickupPoint) || (isBus ? text(item?.pickupPoint) : "") || PLACEHOLDER;
  const dropPoint =
    text(booking.dropPoint) || (isBus ? text(item?.dropPoint) : "") || PLACEHOLDER;
  const routeLabel = `${pickupPoint} → ${dropPoint}`;

  /* --- take-off date + time, from the database --------------------- */
  const departure = toDate(booking.takeOffDate)
    || toDate(booking.reservationDate)
    || (isBus ? toDate(item?.takeOffDate) : null);

  const takeoffDateLabel = departure ? formatTakeoffDate(departure) : PLACEHOLDER;
  const takeoffTimeLabel = departure ? formatTakeoffTime(departure) : PLACEHOLDER;
  const takeoffDateTimeLabel = departure ? formatTakeoffDateTime(departure) : PLACEHOLDER;

  /* --- money + status ---------------------------------------------- */
  const cashOnVisit =
    booking.paymentMethod === "CashOnVisit" || booking.paymentStatus === "CashOnVisit";
  const paymentLabel = cashOnVisit
    ? "Cash on Visit"
    : booking.paymentStatus === "Pending"
    ? "Online (Khalti) — Pending"
    : "Online (Khalti)";

  const totalPrice = Number(booking.totalPrice) || 0;

  return {
    bookingId: String(booking._id || ""),
    /* Never regenerated: whatever was stored at creation time is what is shown. */
    bookingNumber: text(booking.bookingNumber) || text(booking._id) || PLACEHOLDER,
    isBus,
    transportLabel: isBus ? "Bus" : "Vehicle",
    busName,
    passengerName,
    passengerPhone,
    seatLabel,
    seatCount: selectedSeats.length,
    pickupPoint,
    dropPoint,
    routeLabel,
    takeoffDateLabel,
    takeoffTimeLabel,
    takeoffDateTimeLabel,
    hasTakeoff: Boolean(departure),
    passengers: passengers.map((p) => ({
      name: p.name.trim(),
      phone: text(p.phone),
      seat: Number.isFinite(Number(p.seat)) ? formatSeatLabel(p.seat) : null,
    })),
    totalPrice,
    paymentLabel,
    status: text(booking.status) || "Pending",
    emailStatus: text(booking.emailStatus) || "None",
  };
}

module.exports = {
  PLACEHOLDER,
  formatSeatLabel,
  isPopulated,
  resolveItem,
  buildTicketView,
};
