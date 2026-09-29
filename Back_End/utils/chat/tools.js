/**
 * Controlled TickXplore tools for the chatbot.
 * ------------------------------------------------------------------
 * This is the bridge between the language model and your data. The model decides
 * WHICH tool to use, but it never runs a database query and never chooses a user.
 *
 * How authority is kept:
 *
 *   1. The tool list is a hard-coded allowlist below. A tool name the model invents
 *      simply does not exist, so it cannot be called.
 *   2. Every argument is validated and sanitised here. There is no path from a tool
 *      argument to a raw Mongo query.
 *   3. Anything about a specific person uses `ctx.user._id`, which comes from the
 *      verified JWT on the request. The model can never pass a user id, so it can
 *      never reach another person's data.
 *   4. Tools that change data are marked `requiresConfirmation` and only execute
 *      after the user confirms in a follow-up message.
 *
 * All reads reuse your existing models and helper functions, so there is no second
 * copy of booking, payment or hotel logic.
 */

const Booking = require("../../models/Booking");
const Bus = require("../../models/Bus");
const Vehicle = require("../../models/Vehicle");
const Reservation = require("../../models/Reservation");
const RefundRequest = require("../../models/RefundRequest");
const Hotel = require("../../models/Hotel");
const TouristArea = require("../../models/TouristArea");

const { ACCOMMODATION_TYPES } = require("../../models/Hotel");
const { buildTicketView } = require("../../utils/ticketView");
const {
  formatTakeoffDate,
  formatTakeoffTime,
  formatTakeoffDateTime,
  currentYear,
} = require("../../utils/datetime");

/** Raised when a tool is called incorrectly. The message is safe to show the user. */
class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

/* ------------------------------------------------------------------ */
/* Argument helpers                                                    */
/* ------------------------------------------------------------------ */

/** Trim and cap any string argument, dropping it entirely when empty. */
const str = (value, max = 120) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return text.slice(0, max);
};

const num = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const bool = (value) => value === true || value === "true" || value === 1;

/** Case-insensitive "does this text contain any of these words" test. */
const containsAny = (text, words) => {
  const haystack = String(text || "").toLowerCase();
  return words.some((word) => haystack.includes(word));
};

/** Only strings that look like a Mongo ObjectId are accepted. */
const isObjectId = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

/**
 * Resolve a free-text date ("tomorrow", "2026-09-30", "30 September 2026") to a
 * Date in Nepal's timezone. Returns `null` when it cannot be understood, so the
 * caller can ask the user instead of guessing a date.
 */
const parseUserDate = (value) => {
  const text = str(value, 60);
  if (!text) return null;

  const lower = text.toLowerCase();
  const today = new Date();
  const shiftDays = (days) => {
    const next = new Date(today);
    next.setDate(next.getDate() + days);
    return next;
  };

  if (lower === "today" || lower === "tonight") return today;
  if (lower === "tomorrow") return shiftDays(1);
  if (lower === "day after tomorrow") return shiftDays(2);

  // "in 3 days"
  const inDays = lower.match(/^in\s+(\d{1,2})\s+days?$/);
  if (inDays) return shiftDays(Number(inDays[1]));

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    const parsed = new Date(`${lower}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // Anything Date can read, e.g. "30 September 2026".
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Today as a calendar day, in Nepal's timezone, for comparing bus dates. */
const todayKey = () => formatTakeoffDate(new Date());

/** Reduce a bus document to the fields that are safe and useful to show. */
const describeBus = (bus) => ({
  busName: bus.name,
  route: `${bus.pickupPoint} to ${bus.dropPoint}`,
  pickupPoint: bus.pickupPoint,
  dropPoint: bus.dropPoint,
  departure: formatTakeoffDateTime(bus.takeOffDate),
  pricePerSeat: bus.pricePerSeat,
  totalSeats: bus.totalSeats,
  remainingSeats: bus.remainingSeats ?? Math.max(0, bus.totalSeats - (bus.bookedSeats?.length || 0)),
  reference: bus._id.toString(),
});

/** Reduce a vehicle document for the model. */
const describeVehicle = (vehicle, extra = {}) => ({
  vehicleName: vehicle.name,
  capacity: vehicle.capacity,
  price: vehicle.price,
  isAvailable: vehicle.isAvailable,
  reference: vehicle._id.toString(),
  ...extra,
});

/** Reduce a hotel's published snapshot to displayable fields. */
const describeHotel = (hotel) => {
  const profile = hotel.publishedSnapshot?.profile;
  if (!profile) return null;
  return {
    name: profile.hotelName,
    type: profile.type,
    city: profile.city,
    area: profile.area,
    starRating: profile.starRating,
    rating: profile.ratingSummary?.average,
    reviewCount: profile.ratingSummary?.count,
    startingPrice: profile.priceRange?.min,
    currency: profile.currency || "NPR",
    amenities: (profile.amenities || []).slice(0, 8),
    reference: String(hotel._id),
  };
};

/* ------------------------------------------------------------------ */
/* Public tools — inventory, no personal data                          */
/* ------------------------------------------------------------------ */

const searchBuses = async (ctx, { from, to, date } = {}) => {
  const filter = {};

  const pickup = str(from);
  const drop = str(to);
  if (pickup) filter.pickupPoint = new RegExp(pickup.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (drop) filter.dropPoint = new RegExp(drop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const when = parseUserDate(date);
  // `takeOffDate` is a single Date holding the departure instant. When the user gave
  // a day, match that whole local day in Nepal's timezone.
  if (when) {
    const start = new Date(when);
    start.setHours(0, 0, 0, 0);
    const end = new Date(when);
    end.setHours(23, 59, 59, 999);
    filter.takeOffDate = { $gte: start, $lte: end };
  }

  // Only buses with space left — never offer a full bus.
  filter.$expr = { $gt: ["$totalSeats", { $size: { $ifNull: ["$bookedSeats", []] } }] };

  const buses = await Bus.find(filter).sort({ takeOffDate: 1 }).limit(10).lean();

  return {
    searchedFor: {
      from: pickup || "any",
      to: drop || "any",
      date: when ? formatTakeoffDate(when) : "any",
    },
    buses: buses.map(describeBus).filter((bus) => bus.remainingSeats > 0),
    found: buses.filter((bus) => bus.remainingSeats > 0).length,
  };
};

const getBusSeats = async (ctx, { busId } = {}) => {
  const id = str(busId, 24);
  if (!id || !isObjectId(id)) throw new ToolError("I need a valid bus reference to check seats.");

  const bus = await Bus.findById(id).lean();
  if (!bus) throw new ToolError("I could not find that bus.");

  const booked = bus.bookedSeats || [];
  return {
    busName: bus.name,
    route: `${bus.pickupPoint} to ${bus.dropPoint}`,
    departure: formatTakeoffDateTime(bus.takeOffDate),
    totalSeats: bus.totalSeats,
    bookedCount: booked.length,
    availableSeats: Math.max(0, bus.totalSeats - booked.length),
    takenSeatNumbers: booked.sort((a, b) => a - b),
  };
};

const searchVehicles = async (ctx, { type, maxPrice, minCapacity } = {}) => {
  const filter = {};

  const price = num(maxPrice);
  if (price !== undefined) filter.price = { $lte: price };

  const capacity = num(minCapacity);
  if (capacity !== undefined) filter.capacity = { $gte: capacity };

  const wanted = str(type, 60);
  if (wanted) {
    filter.name = new RegExp(wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const vehicles = await Vehicle.find(filter).limit(10).lean();
  return {
    found: vehicles.length,
    vehicles: vehicles.map((vehicle) =>
      describeVehicle(vehicle, vehicle.reservations?.length
        ? { note: "The vendor has existing reservations; check dates for this vehicle." }
        : {})
    ),
  };
};

/**
 * Availability for a vehicle over a date range.
 * Reuses the same interval-overlap rule as `controllers/vehicleController.js`.
 */
const checkVehicleAvailability = async (ctx, { vehicleId, from, until } = {}) => {
  const id = str(vehicleId, 24);
  if (!id || !isObjectId(id)) throw new ToolError("I need a valid vehicle reference.");

  const vehicle = await Vehicle.findById(id).lean();
  if (!vehicle) throw new ToolError("I could not find that vehicle.");

  const start = parseUserDate(from);
  const end = parseUserDate(until);
  if (!start || !end) {
    return {
      vehicle: describeVehicle(vehicle),
      availabilityKnown: false,
      note: "Tell me the start and end date and I will check whether this vehicle is free.",
    };
  }
  if (end < start) throw new ToolError("The end date is before the start date.");

  const reservations = await Reservation.find({ vehicleId: id }).lean();
  const clashes = reservations.filter(
    (reservation) =>
      !(
        end < new Date(reservation.reservedFrom) ||
        start > new Date(reservation.reservedUntil)
      )
  );

  return {
    vehicle: describeVehicle(vehicle),
    from: formatTakeoffDate(start),
    until: formatTakeoffDate(end),
    isAvailable: clashes.length === 0,
    conflictingReservations: clashes.length,
    note: clashes.length
      ? "This vehicle is already reserved during part of that period."
      : "This vehicle is free for the whole period you asked about.",
  };
};

/** Hotels and villas from the existing public accommodation API. */
const searchHotels = async (ctx, { city, type, guests, maxPrice, minPrice, checkIn, checkOut } = {}) => {
  // Only admin-approved listings are ever visible, matching GET /api/hotels.
  const filter = {
    listingStatus: "published",
    "publishedSnapshot.approvedAt": { $ne: null },
  };

  const where = str(city);
  if (where) {
    filter["publishedSnapshot.profile.city"] = new RegExp(
      `^${where.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "i"
    );
  }

  const kind = str(type, 40);
  if (kind) {
    // Only accept a type TickXplore actually supports.
    const match = ACCOMMODATION_TYPES.find(
      (option) => option.toLowerCase() === kind.toLowerCase()
    );
    if (!match) {
      throw new ToolError(
        `TickXplore supports these types: ${ACCOMMODATION_TYPES.join(", ")}.`
      );
    }
    filter["publishedSnapshot.profile.type"] = match;
  }

  const partySize = num(guests);
  const roomsMatch = {};
  if (partySize !== undefined) roomsMatch.maxGuests = { $gte: partySize };

  const min = num(minPrice);
  const max = num(maxPrice);
  if (min !== undefined || max !== undefined) {
    roomsMatch["pricing.basePrice"] = {};
    if (min !== undefined) roomsMatch["pricing.basePrice"].$gte = min;
    if (max !== undefined) roomsMatch["pricing.basePrice"].$lte = max;
  }
  if (Object.keys(roomsMatch).length > 0) {
    filter["publishedSnapshot.rooms"] = { $elemMatch: roomsMatch };
  }

  const hotels = await Hotel.find(filter)
    .select("publishedSnapshot listingStatus")
    .limit(8)
    .lean();

  const stayFrom = parseUserDate(checkIn);
  const stayUntil = parseUserDate(checkOut);

  return {
    found: hotels.length,
    checkIn: stayFrom ? formatTakeoffDate(stayFrom) : undefined,
    checkOut: stayUntil ? formatTakeoffDate(stayUntil) : undefined,
    hotels: hotels.map(describeHotel).filter(Boolean),
    note: "Prices shown are the published nightly starting prices. Room booking is not available on TickXplore yet.",
  };
};

const searchTouristAreas = async (ctx) => {
  const areas = await TouristArea.find().limit(12).lean();
  return {
    found: areas.length,
    areas: areas.map((area) => ({
      name: area.title,
      description: area.description,
      rating: area.rating,
    })),
  };
};

/* ------------------------------------------------------------------ */
/* Private tools — always scoped to the signed-in user                 */
/* ------------------------------------------------------------------ */

/** Assert the request is authenticated. `ctx.user` comes from the verified JWT. */
const requireUser = (ctx) => {
  if (!ctx?.user?._id) {
    throw new ToolError("You need to be signed in for that. Please sign in and try again.");
  }
  return ctx.user;
};

/**
 * Load one booking that belongs to the current user.
 * The user id is taken from the JWT and never from the model's arguments, so a user
 * cannot ask for somebody else's booking by passing an id.
 */
const findOwnBooking = async (ctx, { bookingId, bookingNumber } = {}) => {
  const user = requireUser(ctx);

  const byId = str(bookingId, 24);
  const byNumber = str(bookingNumber, 20);

  const filter = { userId: user._id };
  if (byId && isObjectId(byId)) filter._id = byId;
  else if (byNumber) filter.bookingNumber = byNumber;
  else throw new ToolError("I need a booking number to look that up.");

  const booking = await Booking.findOne(filter);
  if (!booking) {
    throw new ToolError(
      "I could not find that booking on your account. You can see all your bookings if you ask me to show them."
    );
  }
  return booking;
};

const getMyBookings = async (ctx) => {
  const user = requireUser(ctx);
  const bookings = await Booking.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(15)
    .populate("busId vehicleId");

  return {
    found: bookings.length,
    bookings: bookings.map((booking) => {
      const view = {
        bookingNumber: booking.bookingNumber,
        type: booking.busId ? "bus" : "vehicle",
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod,
        totalPrice: booking.totalPrice,
        bookedOn: formatTakeoffDate(booking.createdAt),
      };
      if (booking.busId) {
        view.trip = `${booking.busId.pickupPoint} to ${booking.busId.dropPoint}`;
        view.departure = formatTakeoffDateTime(booking.takeOffDate);
        view.seats = booking.selectedSeats;
      }
      if (booking.vehicleId) {
        view.trip = booking.vehicleId.name;
        view.pickupPoint = booking.pickupPoint;
        view.dropPoint = booking.dropPoint;
        view.reservationDate = formatTakeoffDate(booking.reservationDate);
      }
      return view;
    }),
  };
};

const getMyBooking = async (ctx, args = {}) => {
  const booking = await findOwnBooking(ctx, args);
  // `buildTicketView` is the same helper the emailed ticket uses, so the assistant
  // describes a booking exactly as the customer's ticket does.
  const view = await buildTicketView(booking);
  return {
    bookingNumber: view.bookingNumber,
    type: view.isBus ? "bus" : "vehicle",
    status: view.status,
    paymentLabel: view.paymentLabel,
    totalPrice: view.totalPrice,
    seats: view.seatLabel,
    passengers: view.passengers,
    route: view.routeLabel,
    departure: view.hasTakeoff ? view.takeoffDateTimeLabel : undefined,
    pickupPoint: view.pickupPoint,
    dropPoint: view.dropPoint,
    reference: String(booking._id),
  };
};

const getPaymentStatus = async (ctx, args = {}) => {
  const booking = await findOwnBooking(ctx, args);
  return {
    bookingNumber: booking.bookingNumber,
    bookingStatus: booking.status,
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod,
    amount: booking.totalPrice,
    isRefunded: booking.isRefunded,
    // The transaction id is only ever shown partially — it is a payment reference.
    transactionReference: booking.transactionId
      ? `${String(booking.transactionId).slice(0, 6)}…`
      : undefined,
  };
};

const getRefundStatus = async (ctx, args = {}) => {
  const booking = await findOwnBooking(ctx, args);

  const request = await RefundRequest.findOne({ bookingId: booking._id })
    .sort({ requestedAt: -1 })
    .lean();

  return {
    bookingNumber: booking.bookingNumber,
    bookingStatus: booking.status,
    refundRequest: request
      ? {
          status: request.status,
          reason: request.reason,
          refundAmount: request.refundAmount,
          requestedAt: formatTakeoffDate(request.requestedAt),
          processedAt: request.processedAt ? formatTakeoffDate(request.processedAt) : undefined,
        }
      : "No refund has been requested for this booking.",
    refunded: booking.isRefunded,
    refundAmount: booking.refundAmount || 0,
    refundDate: booking.refundDate ? formatTakeoffDate(booking.refundDate) : undefined,
  };
};

const getUpcomingBookings = async (ctx) => {
  const user = requireUser(ctx);
  const now = new Date();
  const bookings = await Booking.find({
    userId: user._id,
    status: { $ne: "Cancelled" },
    $or: [{ takeOffDate: { $gte: now } }, { reservationDate: { $gte: now } }],
  })
    .sort({ takeOffDate: 1 })
    .limit(10)
    .populate("busId vehicleId");

  return {
    found: bookings.length,
    bookings: bookings.map((booking) => ({
      bookingNumber: booking.bookingNumber,
      type: booking.busId ? "bus" : "vehicle",
      status: booking.status,
      trip: booking.busId
        ? `${booking.busId.pickupPoint} to ${booking.busId.dropPoint}`
        : booking.vehicleId?.name,
      departure: formatTakeoffDateTime(booking.takeOffDate || booking.reservationDate),
      totalPrice: booking.totalPrice,
    })),
  };
};

/* ------------------------------------------------------------------ */
/* Actions that change data                                            */
/* ------------------------------------------------------------------ */

const TOOL_ERRORS = {
  FAILED: "That did not work. Please try from the My Bookings page.",
  NOT_FOUND: "I could not find that booking on your account.",
  FORBIDDEN: "You can only change your own bookings.",
  UNAUTHENTICATED: "You need to be signed in to do that.",
  ABORTED: "That could not be completed. Please try again.",
};

/**
 * Cancel a bus booking.
 *
 * This performs the same work as the existing `PUT /api/refunds/cancel/:bookingId`
 * (mark cancelled, notify the user, release the bus seats) rather than inventing a
 * second cancellation path.
 *
 * Vehicle bookings are deliberately NOT cancelled here: the existing cancel logic
 * clears every reservation belonging to a vehicle, which would affect other
 * travellers. Those are directed to the My Bookings page instead.
 */
const cancelBooking = async (ctx, args = {}) => {
  const booking = await findOwnBooking(ctx, args);

  if (booking.vehicleId) {
    throw new ToolError(
      "Please cancel vehicle bookings from the My Bookings page, so the vehicle and its " +
        "availability are released correctly for other travellers."
    );
  }
  if (booking.status === "Cancelled") {
    throw new ToolError(`Booking ${booking.bookingNumber} is already cancelled.`);
  }

  booking.status = "Cancelled";
  await booking.save();

  if (booking.busId && booking.selectedSeats?.length) {
    const bus = await Bus.findById(booking.busId);
    if (bus) {
      bus.bookedSeats = (bus.bookedSeats || []).filter(
        (seat) => !booking.selectedSeats.includes(seat)
      );
      await bus.save();
    }
  }

  return {
    cancelled: true,
    bookingNumber: booking.bookingNumber,
    freedSeats: booking.selectedSeats || [],
    note: "The booking is cancelled and the seats are free for other travellers. If you want your money back, ask me to request a refund.",
  };
};

/**
 * Request a refund, mirroring the existing `POST /api/refunds/request/:bookingId`
 * validation (a reason is required and only one pending request is allowed).
 */
const requestRefund = async (ctx, args = {}) => {
  const user = requireUser(ctx);
  const booking = await findOwnBooking(ctx, args);

  const reason = str(args.reason, 500);
  if (!reason) throw new ToolError("I need a reason for the refund request.");

  const existing = await RefundRequest.findOne({
    bookingId: booking._id,
    userId: user._id,
    status: "Pending",
  });
  if (existing) {
    throw new ToolError("A refund request for this booking is already being reviewed.");
  }

  const refund = await RefundRequest.create({
    bookingId: booking._id,
    userId: user._id,
    refundAmount: booking.totalPrice,
    reason,
    status: "Pending",
  });

  return {
    requested: true,
    bookingNumber: booking.bookingNumber,
    refundAmount: refund.refundAmount,
    status: refund.status,
    note: "Your refund request has been submitted. The TickXplore admin team reviews it and you will be emailed once there is a decision.",
  };
};

/**
 * Read-only lookup of the booking a pending action refers to.
 * Used to build the confirmation prompt. Scoped to the signed-in user, and it
 * performs no writes of any kind.
 *
 * @param {{tool: string, args: object}} action
 * @param {{user: object}} ctx
 * @returns {Promise<object>}
 */
const lookupActionTarget = async (action, ctx) => {
  const booking = await findOwnBooking(ctx, action?.args || {});
  return {
    tool: action.tool,
    bookingId: String(booking._id),
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    type: booking.busId ? "bus" : "vehicle",
    trip: booking.busId
      ? `${booking.busId.pickupPoint} to ${booking.busId.dropPoint}`
      : "vehicle reservation",
    seats: booking.selectedSeats,
    totalPrice: booking.totalPrice,
    pickupPoint: booking.pickupPoint,
    dropPoint: booking.dropPoint,
  };
};

/* ------------------------------------------------------------------ */
/* The allowlist                                                       */
/* ------------------------------------------------------------------ */
/**
 * Each entry describes one tool the model may call.
 *
 * - `description` is sent to the model, so it describes what the tool is *for*.
 * - `auth` marks a tool that needs a signed-in user.
 * - `requiresConfirmation` marks a tool that changes data.
 * - `run` is the only code that ever touches the database. Every tool has the
 *   signature `(ctx, args)`, where `ctx` carries the authenticated user.
 */
const TOOLS = {
  search_buses: {
    description: "Find available buses. Use for any question about which buses exist, routes, schedules or fares.",
    args: ["from", "to", "date"],
    auth: false,
    run: searchBuses,
  },
  get_bus_seats: {
    description: "Check how many seats are left on one specific bus. Needs a bus reference from a previous search.",
    args: ["busId"],
    auth: false,
    run: getBusSeats,
  },
  search_vehicles: {
    description: "Find vehicles available to reserve, such as 4x4, jeep or Scorpio.",
    args: ["type", "maxPrice", "minCapacity"],
    auth: false,
    run: searchVehicles,
  },
  check_vehicle_availability: {
    description: "Check whether a specific vehicle is free between two dates.",
    args: ["vehicleId", "from", "until"],
    auth: false,
    run: checkVehicleAvailability,
  },
  search_hotels: {
    description: "Search hotels, villas and other places to stay. Room booking is not available.",
    args: ["city", "type", "guests", "minPrice", "maxPrice", "checkIn", "checkOut"],
    auth: false,
    run: searchHotels,
  },
  search_tourist_areas: {
    description: "List the tourist destinations TickXplore covers.",
    args: [],
    auth: false,
    run: searchTouristAreas,
  },
  get_my_bookings: {
    description: "List the current user's own bookings, recent first.",
    args: [],
    auth: true,
    run: getMyBookings,
  },
  get_upcoming_bookings: {
    description: "List the current user's own upcoming trips.",
    args: [],
    auth: true,
    run: getUpcomingBookings,
  },
  get_my_booking: {
    description: "Get full details of one booking belonging to the current user.",
    args: ["bookingId", "bookingNumber"],
    auth: true,
    run: getMyBooking,
  },
  get_payment_status: {
    description: "Get the payment status of one of the current user's bookings.",
    args: ["bookingId", "bookingNumber"],
    auth: true,
    run: getPaymentStatus,
  },
  get_refund_status: {
    description: "Get the refund status of one of the current user's bookings.",
    args: ["bookingId", "bookingNumber"],
    auth: true,
    run: getRefundStatus,
  },
  cancel_booking: {
    description: "Cancel one of the current user's bus bookings and free its seats. Requires the user's explicit confirmation.",
    args: ["bookingId", "bookingNumber"],
    auth: true,
    requiresConfirmation: true,
    run: cancelBooking,
  },
  request_refund: {
    description: "Submit a refund request for one of the current user's bookings. Requires the user's explicit confirmation.",
    args: ["bookingId", "bookingNumber", "reason"],
    auth: true,
    requiresConfirmation: true,
    run: requestRefund,
  },
};

/** Compact tool list for the tool-selection prompt. */
const describeTools = ({ isAuthenticated }) =>
  Object.entries(TOOLS)
    .filter(([, tool]) => isAuthenticated || !tool.auth)
    .map(([name, tool]) => `- ${name}(${tool.args.join(", ")}): ${tool.description}`)
    .join("\n");

/**
 * Run one tool by name.
 *
 * @param {string} name Must be an exact key of TOOLS.
 * @param {object} args Model-supplied arguments.
 * @param {object} ctx `{ user }` from the verified request.
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
const runTool = async (name, args, ctx) => {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) {
    // An unknown tool name is simply ignored: the model cannot invent capability.
    return { ok: false, error: "No such capability." };
  }

  if (tool.auth && !ctx?.user?._id) {
    return { ok: false, error: TOOL_ERRORS.UNAUTHENTICATED };
  }

  const safeArgs = {};
  for (const key of tool.args) {
    if (args && Object.prototype.hasOwnProperty.call(args, key)) safeArgs[key] = args[key];
  }

  try {
    const data = await tool.run(ctx, safeArgs);
    return { ok: true, data };
  } catch (error) {
    const message =
      error instanceof ToolError ? error.message : TOOL_ERRORS.FAILED;
    if (!(error instanceof ToolError)) {
      console.error(`[chat] tool "${name}" failed:`, error.message);
    }
    return { ok: false, error: message };
  }
};

/** Suggestion chips shown before the first message. */
const STARTER_QUESTIONS = [
  "How do I book a ticket?",
  "What payment methods are available?",
  "How does Cash on Visit work?",
  "How can I cancel my booking?",
  "How do I reserve a vehicle?",
  "How can I check my bookings?",
  "How do I register as a vendor?",
  "How do I search for a hotel?",
];

module.exports = {
  TOOLS,
  runTool,
  describeTools,
  lookupActionTarget,
  STARTER_QUESTIONS,
  ToolError,
  parseUserDate,
  isObjectId,
  todayKey,
  currentYear,
  containsAny,
  bool,
};
