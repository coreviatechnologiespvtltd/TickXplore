import type { Booking, BookingRef, UserRef } from "../api/types";
import {
  formatTakeoffDate,
  formatTakeoffDateTime,
  formatTakeoffTime,
  toDate,
} from "./datetime";

/**
 * The canonical set of values a ticket shows.
 *
 * This mirrors `Back_End/utils/ticketView.js` field for field, so the in-app
 * ticket and the PDF that lands in the customer's inbox are built from the same
 * database values and cannot drift apart.
 *
 * Precedence, highest first:
 *   1. the value snapshotted on the booking at creation time
 *   2. the referenced Bus / Vehicle document
 * Nothing is invented: no fallback to "now", nor to the booking's creation time.
 */

export const PLACEHOLDER = "N/A";

export interface TicketPassenger {
  name: string;
  phone: string;
  seat: string | null;
}

export interface TicketView {
  /** Internal Mongo id — never present this to customers as "Booking ID". */
  bookingId: string;
  /** Immutable customer-facing reference, e.g. 20260001. */
  bookingNumber: string;
  isBus: boolean;
  transportLabel: string;
  busName: string;
  passengerName: string;
  passengerPhone: string;
  seatLabel: string;
  seatCount: number;
  pickupPoint: string;
  dropPoint: string;
  routeLabel: string;
  takeoffDateLabel: string;
  takeoffTimeLabel: string;
  takeoffDateTimeLabel: string;
  hasTakeoff: boolean;
  passengers: TicketPassenger[];
  totalPrice: number;
  paymentLabel: string;
  status: string;
  emailStatus: string;
}

/** 4-per-row seat layout (A1…D1, E1…) — matches the seat map and the PDF. */
export function formatSeatLabel(seat: number | string): string {
  const n = Number(seat);
  if (!Number.isFinite(n) || n <= 0) return String(seat);
  const row = Math.floor((n - 1) / 4);
  const col = ((n - 1) % 4) + 1;
  return `${String.fromCharCode(65 + row)}${col}`;
}

/**
 * True only for a reference that is already a populated document.
 *
 * A BSON ObjectId is also `typeof "object"`, so a bare reference must be
 * rejected here too, exactly as the backend does.
 */
const isPopulated = <T>(ref: unknown): ref is T => {
  if (!ref || typeof ref !== "object") return false;
  const candidate = ref as { _bsontype?: unknown; toHexString?: unknown; equals?: unknown };
  if (candidate._bsontype === "ObjectId" || candidate._bsontype === "ObjectID") return false;
  if (
    typeof candidate.toHexString === "function" &&
    typeof candidate.equals === "function"
  ) {
    return false;
  }
  return true;
};

export { isPopulated };

/** Return `ref` only when it is a populated object, not a bare id string. */
function populated<T>(ref: unknown): T | undefined {
  return isPopulated<T>(ref) ? (ref as T) : undefined;
}

/** Normalise a stored string, collapsing blanks and "N/A" to "". */
const text = (value: unknown): string => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed !== PLACEHOLDER ? trimmed : "";
};

/** Best available display name for a booking, or PLACEHOLDER. */
export function bookingNumberOf(booking: Partial<Booking> | null | undefined): string {
  if (!booking) return PLACEHOLDER;
  // Shown exactly as stored at creation time; never regenerated for display.
  return text(booking.bookingNumber) || text(booking._id) || PLACEHOLDER;
}

/** `pickup → drop` for a booking and its populated bus/vehicle. */
export function routeLabelOf(booking: Partial<Booking> | null | undefined): string {
  const isBus = Boolean(booking?.busId);
  const item = populated<BookingRef>(booking?.busId ?? booking?.vehicleId);
  const pickup = text(booking?.pickupPoint) || (isBus ? text(item?.pickupPoint) : "") || PLACEHOLDER;
  const drop = text(booking?.dropPoint) || (isBus ? text(item?.dropPoint) : "") || PLACEHOLDER;
  return `${pickup} → ${drop}`;
}

/** Build the ticket view model from a booking already returned by the API. */
export function buildTicketView(booking: Partial<Booking> | null | undefined): TicketView {
  const passengers = (booking?.passengers ?? []).filter((p) => p && text(p.name));

  /* --- passenger -------------------------------------------------- */
  const user = populated<UserRef>(booking?.userId) ?? booking?.user;
  const passengerName =
    text(booking?.customerName) ||
    text(user?.name) ||
    text(passengers[0]?.name) ||
    PLACEHOLDER;

  const passengerPhone =
    text(booking?.customerPhone) ||
    text(user?.phoneNumber) ||
    text(passengers[0]?.phone) ||
    PLACEHOLDER;

  /* --- transport + seat -------------------------------------------- */
  const isBus = Boolean(booking?.busId);
  const ref = (booking?.busId ?? booking?.vehicleId) as BookingRef | undefined;
  const item = populated<BookingRef>(ref);

  const busName = isBus ? text(item?.name) || PLACEHOLDER : PLACEHOLDER;

  const selectedSeats = (booking?.selectedSeats ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const seatLabel = isBus
    ? selectedSeats.map(formatSeatLabel).join(", ") || PLACEHOLDER
    : "Whole vehicle";

  /* --- route ------------------------------------------------------- */
  const pickupPoint =
    text(booking?.pickupPoint) || (isBus ? text(item?.pickupPoint) : "") || PLACEHOLDER;
  const dropPoint =
    text(booking?.dropPoint) || (isBus ? text(item?.dropPoint) : "") || PLACEHOLDER;

  /* --- take-off, straight from the database -------------------------- */
  const departure =
    toDate(booking?.takeOffDate) ||
    toDate(booking?.reservationDate) ||
    (isBus ? toDate(item?.takeOffDate) : null);

  /* --- money + status ----------------------------------------------- */
  const cashOnVisit =
    booking?.paymentMethod === "CashOnVisit" || booking?.paymentStatus === "CashOnVisit";
  const paymentLabel = cashOnVisit
    ? "Cash on Visit"
    : booking?.paymentStatus === "Pending"
    ? "Online (Khalti) — Pending"
    : "Online (Khalti)";

  return {
    bookingId: String(booking?._id ?? ""),
    bookingNumber: bookingNumberOf(booking),
    isBus,
    transportLabel: isBus ? "Bus" : "Vehicle",
    busName,
    passengerName,
    passengerPhone,
    seatLabel,
    seatCount: selectedSeats.length,
    pickupPoint,
    dropPoint,
    routeLabel: `${pickupPoint} → ${dropPoint}`,
    takeoffDateLabel: departure ? formatTakeoffDate(departure) : PLACEHOLDER,
    takeoffTimeLabel: departure ? formatTakeoffTime(departure) : PLACEHOLDER,
    takeoffDateTimeLabel: departure ? formatTakeoffDateTime(departure) : PLACEHOLDER,
    hasTakeoff: Boolean(departure),
    passengers: passengers.map((p) => ({
      name: text(p.name),
      phone: text(p.phone),
      seat: Number.isFinite(Number(p.seat)) ? formatSeatLabel(Number(p.seat)) : null,
    })),
    totalPrice: Number(booking?.totalPrice) || 0,
    paymentLabel,
    status: text(booking?.status) || "Pending",
    emailStatus: text(booking?.emailStatus) || "None",
  };
}
