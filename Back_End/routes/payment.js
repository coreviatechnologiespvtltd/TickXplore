const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const axios = require("axios");
const Booking = require("../models/Booking");
const Bus = require("../models/Bus");
const Vehicle = require("../models/Vehicle");
const Reservation = require("../models/Reservation");
const Vendor = require("../models/Vendor");
const { sendEmail } = require("../utils/sendEmail");
const ticketService = require("../utils/ticketService");
const { allocateBookingNumber } = require("../utils/bookingNumber");
const { parseTakeoffInput, endOfTakeoffDay } = require("../utils/datetime");
const Notification = require("../models/Notification");
const User = require("../models/User");
const Admin = require("../models/Admin");
const KHALTI_BASE_URL = "https://dev.khalti.com/api/v2/epayment/initiate/";
const KHALTI_LOOKUP_URL = "https://dev.khalti.com/api/v2/epayment/lookup/";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

// Resolve the customer identity for a booking. Prefers a registered user
// account when one is supplied; otherwise falls back to the walk-in contact
// provided by the booking agent (vendor-assisted bookings).
async function resolveCustomer(body) {
  const {
    userId,
    customerName,
    customerPhone,
    customerEmail,
  } = body;

  if (userId) {
    const user = await User.findById(userId).catch(() => null);
    if (user) {
      return {
        userId: user._id,
        customerName: user.name,
        customerPhone: user.phoneNumber,
        customerEmail: user.email,
      };
    }
  }

  return {
    userId: null,
    customerName: customerName || "",
    customerPhone: customerPhone || "",
    customerEmail: customerEmail || "",
  };
}

// Run a side-effect without letting a failure break the payment flow.
async function safeRun(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[payment] ${label} failed (non-blocking):`, err.message || err);
  }
}

/**
 * Build the trip-related part of a booking document.
 *
 * Every booking path (online initiate, Cash on Visit, legacy recovery) funnels
 * through here so the stored pickup point, dropping point and take-off
 * date/time always originate from the database:
 *
 *  - Bus: the Bus document *is* the trip/schedule, so `bus.pickupPoint`,
 *    `bus.dropPoint` and `bus.takeOffDate` are authoritative. Anything the
 *    client sends is ignored — a stale or tampered value can never reach a
 *    ticket.
 *  - Vehicle: there is no fixed schedule, so the reservation date and route
 *    come from the request, falling back to the vehicle's own route.
 *
 * No field is ever defaulted to the current time.
 */
function buildTripFields({ type, bus, vehicle, itemId, seats, takeOffDate, pickupPoint, dropPoint }) {
  if (type === "bus") {
    if (!bus) throw new Error("Bus not found");
    return {
      busId: bus._id,
      selectedSeats: (seats || []).map(Number),
      pickupPoint: bus.pickupPoint,
      dropPoint: bus.dropPoint,
      takeOffDate: bus.takeOffDate,
    };
  }

  if (!vehicle) throw new Error("Vehicle not found");
  const reservationDate = parseTakeoffInput(takeOffDate);
  return {
    vehicleId: vehicle._id,
    reservationDate: reservationDate || undefined,
    pickupPoint: String(pickupPoint || "").trim() || vehicle.pickupPoint || "N/A",
    dropPoint: String(dropPoint || "").trim() || vehicle.dropPoint || "N/A",
  };
}

function endOfReservationDay(date) {
  return endOfTakeoffDay(date);
}

// Returns the subset of `seats` that are already taken on `busId`. A seat is
// taken if it appears in the bus bookedSeats (completed online + CoV pending),
// in a pending Cash on Visit booking, or in an in-flight online booking that is
// still waiting on Khalti.
//
// Stranded online payments (initiated but never completed) are only counted for
// PENDING_TTL_MINUTES so an abandoned Khalti tab stops blocking seats.
const PENDING_TTL_MINUTES = 60;
async function findSeatConflicts(busId, seats, excludeBookingId) {
  if (!seats || seats.length === 0) return [];

  const bus = await Bus.findById(busId).select("bookedSeats");
  const taken = new Set((bus?.bookedSeats || []).map(Number));

  const activeSince = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000);
  const pendingBookings = await Booking.find({
    busId,
    status: "Pending",
    createdAt: { $gte: activeSince },
    ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
  }).select("selectedSeats");
  pendingBookings.forEach((b) => {
    (b.selectedSeats || []).forEach((s) => taken.add(Number(s)));
  });

  return seats
    .map(Number)
    .filter((s) => taken.has(s));
}

// Ensures the requested date is actually free for a vehicle. When a date is
// supplied the check is date-scoped (a Reservation overlapping that date), so a
// vehicle can be re-booked for a later/different date after a prior booking.
// The legacy hard `isAvailable` flag only still matters when no date is given.
async function findVehicleConflict(vehicleId, requestedDate) {
  const vehicle = await Vehicle.findById(vehicleId).select("isAvailable");
  if (!vehicle) return true;

  if (requestedDate) {
    const from = new Date(requestedDate);
    const until = endOfReservationDay(from);
    const existing = await Reservation.findOne({
      vehicleId,
      reservedFrom: { $lte: until },
      reservedUntil: { $gte: from },
    });
    if (existing) return true;
    return false;
  }

  if (vehicle.isAvailable === false) return true;
  return false;
}

// Clocks the requested seats into a bus atomically. Returns false (and locks
// nothing) when any of the seats is already taken so callers can reject the
// booking instead of overbooking.
async function tryLockBusSeats(busId, seats) {
  const result = await Bus.findOneAndUpdate(
    { _id: busId, bookedSeats: { $not: { $elemMatch: { $in: seats.map(Number) } } } },
    { $addToSet: { bookedSeats: { $each: seats.map(Number) } } },
    { new: false }
  );
  return Boolean(result);
}

// Email + PDF ticket delivery is handled in utils/ticketService.js.

// Emails the PDF ticket to the booking's customer. Used to re-deliver a
// ticket for a walk-in / vendor-assisted booking at any time.
router.post("/resend-ticket", async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ message: "Missing bookingId" });

    const booking = await Booking.findById(bookingId).populate("busId vehicleId userId");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const userObj =
      typeof booking.userId === "object" && booking.userId ? booking.userId : null;
    const to = booking.customerEmail || userObj?.email;
    if (!to) {
      return res.status(400).json({ message: "Booking has no customer email on file" });
    }

    const result = await ticketService.sendTicketEmail(booking);
    if (result.status === "Sent") {
      return res.status(200).json({ message: "Ticket emailed successfully", emailStatus: "Sent" });
    }
    return res.status(500).json({
      message: "Failed to email ticket",
      emailStatus: result.status,
      error: result.error,
    });
  } catch (err) {
    console.error("Resend ticket error:", err.message || err);
    return res.status(500).json({ message: "Failed to email ticket" });
  }
});

// Marks a booking as booked and performs all downstream effects (seat lock,
// reservation, vendor/admin commission, notifications, emails) exactly once.
async function completeBooking(booking, pidx) {
  const totalPrice = booking.totalPrice || 0;
  const commissionRate = 10;
  const commissionAmount = Math.round((commissionRate / 100) * totalPrice * 100) / 100;
  const vendorEarnings = Math.round((totalPrice - commissionAmount) * 100) / 100;
  const type = booking.busId ? "bus" : booking.vehicleId ? "vehicle" : null;
  if (!type) throw new Error("Unknown booking type");

  if (type === "bus") {
    const seats = booking.selectedSeats || [];
    const bus = await Bus.findById(booking.busId);

    // Defense-in-depth for the rare initiate -> verify race: if the seats were
    // taken after the customer was charged, do not lock them. The booking stays
    // stranded so the frontend can surface the conflict.
    const conflicts = await findSeatConflicts(booking.busId, seats, booking._id);
    if (conflicts.length > 0) {
      const err = new Error("Seat conflict: seats became unavailable after payment.");
      err.code = "SEAT_CONFLICT";
      err.conflictSeats = conflicts;
      throw err;
    }

    await safeRun("bus seat lock", async () => {
      await Bus.findByIdAndUpdate(booking.busId, {
        $addToSet: { bookedSeats: { $each: seats } },
      });
    });

    const vendor = bus ? await Vendor.findById(bus.vendorId) : null;
    if (vendor) {
      await safeRun("bus vendor update", async () => {
        vendor.totalEarnings += vendorEarnings;
        vendor.totalCommission += commissionAmount;
        await vendor.save();

        await Notification.create({
          userId: vendor._id,
          role: "vendor",
          message: `New bus booking for "${bus.name}" (Rs. ${totalPrice})`,
        });

        if (vendor.email) {
          await sendEmail(
            vendor.email,
            "New Bus Booking - TickXplore",
            `<p>Booking Number: ${booking.bookingNumber}</p><p>Total: Rs. ${totalPrice}</p>`
          );
        }
      });
    }
  } else if (type === "vehicle") {
    const vehicle = await Vehicle.findById(booking.vehicleId);
    const reservedFrom = booking.reservationDate ? new Date(booking.reservationDate) : new Date();
    const reservedUntil = endOfReservationDay(reservedFrom);

    const existingReservation = await Reservation.findOne({ paymentId: pidx }).catch(() => null);
    if (!existingReservation) {
      // Guard against the rare initiate -> verify race where the vehicle got
      // reserved by someone else after the customer was charged.
      const conflicted = await findVehicleConflict(booking.vehicleId, reservedFrom);
      if (conflicted) {
        const err = new Error("Vehicle conflict: the vehicle became unavailable after payment.");
        err.code = "VEHICLE_CONFLICT";
        throw err;
      }
      await safeRun("vehicle reservation", async () => {
        const reservation = await Reservation.create({
          vehicleId: booking.vehicleId,
          userId: booking.userId || undefined,
          customerName: booking.customerName || undefined,
          customerPhone: booking.customerPhone || undefined,
          customerEmail: booking.customerEmail || undefined,
          pickupPoint: booking.pickupPoint || "N/A",
          dropPoint: booking.dropPoint || "N/A",
          reservedFrom,
          reservedUntil,
          paymentStatus: "completed",
          paymentId: pidx,
        });

        await Vehicle.findByIdAndUpdate(booking.vehicleId, {
          isAvailable: false,
          reservedFrom,
          reservedUntil,
          $push: {
            reservations: {
              userId: booking.userId,
              reservedFrom,
              reservedUntil,
              pickupPoint: booking.pickupPoint || "N/A",
              dropPoint: booking.dropPoint || "N/A",
            },
          },
          $inc: {
            totalEarnings: vendorEarnings,
            totalCommission: commissionAmount,
          },
        });
      });
    }

    const vendor = vehicle ? await Vendor.findById(vehicle.vendorId) : null;
    if (vendor) {
      await safeRun("vehicle vendor update", async () => {
        vendor.totalEarnings += vendorEarnings;
        vendor.totalCommission += commissionAmount;
        await vendor.save();

        await Notification.create({
          userId: vendor._id,
          role: "vendor",
          message: `New vehicle booking for "${vehicle.name}" (Rs. ${totalPrice})`,
        });

        if (vendor.email) {
          await sendEmail(
            vendor.email,
            "New Vehicle Booking - TickXplore",
            `<p>Booking Number: ${booking.bookingNumber}</p><p>Total: Rs. ${totalPrice}</p>`
          );
        }
      });
    }
  }

  // Admin commission update
  await safeRun("admin commission update", async () => {
    const admin = await Admin.findOne();
    if (admin) {
      admin.totalCommission += commissionAmount;
      await admin.save();

      await Notification.create({
        userId: admin._id,
        role: "admin",
        message: `New ${type} booking of Rs. ${totalPrice}. Commission Rs. ${commissionAmount}`,
      });

      if (admin.email) {
        await sendEmail(
          admin.email,
          "New Booking Confirmed - TickXplore",
          `<p>Booking Number: ${booking.bookingNumber}</p><p>Commission: Rs. ${commissionAmount}</p>`
        );
      }
    }
  });

  // Customer notification
  await safeRun("customer notification", async () => {
    const user = booking.userId ? await User.findById(booking.userId) : null;
    if (user) {
      await Notification.create({
        userId: user._id,
        role: "user",
        message: `Your ${type} booking (Rs. ${totalPrice}) is confirmed.`,
      });
    }
  });

  booking.commissionAmount = commissionAmount;
  booking.vendorEarnings = vendorEarnings;
  booking.status = "Booked";
  booking.paymentStatus = "Paid";
  booking.paymentMethod = booking.paymentMethod || "Online";
  booking.transactionId = pidx;
  booking.settlementDone = true;
  await booking.save();

  // Email the PDF ticket (non-blocking; the booking is already successful).
  await safeRun("customer ticket email", async () => {
    await ticketService.sendTicketEmail(booking);
  });
}

// Best-effort recovery for payments initiated before the pending-booking
// change (metadata lived only in the in-memory store / redirect data).
async function createBookingFromLegacyMeta(paymentData, query, pidx) {
  let rawExtra = paymentData.merchant_extra || query.data;
  let metadata = null;
  if (rawExtra) {
    try {
      metadata = typeof rawExtra === "string" ? JSON.parse(rawExtra) : rawExtra;
    } catch {
      metadata = null;
    }
  }
  if (!metadata && global.khaltiTempStore?.has(query.purchase_order_id)) {
    metadata = global.khaltiTempStore.get(query.purchase_order_id);
  }
  if (!metadata) return null;

  const { type, itemId, userId, seats, takeOffDate, pickupPoint, dropPoint } = metadata;
  if (!itemId || !userId) return null;

  const commissionRate = 10;
  let booking;

  if (type === "bus") {
    if (!seats || seats.length === 0) return null;
    const bus = await Bus.findById(itemId);
    if (!bus) return null;

    const totalPrice = bus.pricePerSeat * seats.length;
    const commissionAmount = Math.round((commissionRate / 100) * totalPrice * 100) / 100;
    const vendorEarnings = totalPrice - commissionAmount;

    booking = await Booking.create({
      userId,
      totalPrice,
      status: "Pending",
      paymentStatus: "Paid",
      transactionId: pidx,
      purchaseOrderId: query.purchase_order_id,
      commissionAmount,
      vendorEarnings,
      settlementDone: false,
      bookingNumber: await allocateBookingNumber(new Date()),
      ...buildTripFields({ type, bus, itemId, seats, takeOffDate, pickupPoint, dropPoint }),
    });
  } else if (type === "vehicle") {
    const vehicle = await Vehicle.findById(itemId);
    if (!vehicle) return null;

    const totalPrice = vehicle.price;
    const commissionAmount = Math.round((commissionRate / 100) * totalPrice * 100) / 100;
    const vendorEarnings = totalPrice - commissionAmount;

    booking = await Booking.create({
      userId,
      totalPrice,
      status: "Pending",
      paymentStatus: "Paid",
      transactionId: pidx,
      purchaseOrderId: query.purchase_order_id,
      commissionAmount,
      vendorEarnings,
      settlementDone: false,
      bookingNumber: await allocateBookingNumber(new Date()),
      ...buildTripFields({
        type,
        vehicle,
        itemId,
        seats,
        // Legacy metadata is untrusted; parse it as an app-timezone date and
        // never fall back to "now" — that would invent a departure time.
        takeOffDate,
        pickupPoint,
        dropPoint,
      }),
    });
  } else {
    return null;
  }

  return booking;
}

//INITIATE PAYMENT
router.post("/initiate", async (req, res) => {
  console.log("Received Payment Request:", req.body);
  let booking = null;
  try {
    const {
      type,
      itemId,
      seats,
      userId,
      takeOffDate,
      pickupPoint,
      dropPoint,
      customerName,
      customerPhone,
      customerEmail,
      passengers,
    } = req.body;

    if (
      !itemId ||
      (!userId && !(customerName && customerEmail))
    ) {
      return res.status(400).json({
        message: "Missing required fields. Provide itemId and either userId or customer name + email.",
      });
    }

    let totalPrice = 0;
    let productName = "";
    let productDetails = [];
    let bus = null;
    let vehicle = null;

    if (type === "bus") {
      if (!seats || seats.length === 0) {
        return res.status(400).json({ message: "Seats are required for bus booking." });
      }

      bus = await Bus.findById(itemId);
      if (!bus) return res.status(404).json({ message: "Bus not found." });

      totalPrice = bus.pricePerSeat * seats.length;
      productName = `${bus.name} (${bus.pickupPoint} → ${bus.dropPoint})`;

      productDetails = [{
        identity: bus._id.toString(),
        name: bus.name,
        total_price: totalPrice * 100,
        quantity: 1,
        unit_price: totalPrice * 100,
      }];
    }

    else if (type === "vehicle") {
      vehicle = await Vehicle.findById(itemId);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });

      totalPrice = vehicle.price;
      productName = vehicle.name;

      productDetails = [{
        identity: vehicle._id.toString(),
        name: vehicle.name,
        total_price: totalPrice * 100,
        quantity: 1,
        unit_price: totalPrice * 100,
      }];
    }

    else {
      return res.status(400).json({ message: "Invalid booking type." });
    }

    const customer = await resolveCustomer(req.body);
    if (!customer.userId && !customer.customerName) {
      return res.status(400).json({ message: "Customer name is required for walk-in bookings." });
    }

    // Reject before any money moves if the item was just taken by someone else.
    if (type === "bus") {
      const conflictSeats = await findSeatConflicts(itemId, seats);
      if (conflictSeats.length > 0) {
        return res.status(409).json({
          message: "Some selected seats were just booked by another customer.",
          code: "SEAT_CONFLICT",
          conflictSeats,
        });
      }
    } else if (type === "vehicle") {
      const conflicted = await findVehicleConflict(itemId, takeOffDate);
      if (conflicted) {
        return res.status(409).json({
          message: "This vehicle was just reserved by another customer.",
          code: "VEHICLE_CONFLICT",
        });
      }
    }

    const orderId = `order-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const commissionRate = 10;
    const commissionAmount = Math.round((commissionRate / 100) * totalPrice * 100) / 100;
    const vendorEarnings = Math.round((totalPrice - commissionAmount) * 100) / 100;

    // Ticket reference, e.g. "202600001". Allocated from the atomic per-year
    // counter and assigned once, here, for the life of the booking.
    const bookingNumber = await allocateBookingNumber(new Date());

    // Persist a PENDING booking BEFORE calling Khalti so the charge can never be
    // lost if the callback restarts or fails. `/callback` and `/verify` complete it.
    const bookingFields = {
      userId: customer.userId || undefined,
      customerName: customer.customerName || undefined,
      customerPhone: customer.customerPhone || undefined,
      customerEmail: customer.customerEmail || undefined,
      passengers: Array.isArray(passengers) ? passengers : [],
      totalPrice,
      status: "Pending",
      paymentStatus: "Pending",
      transactionId: `pending-${orderId}`,
      purchaseOrderId: orderId,
      commissionAmount,
      vendorEarnings,
      bookingNumber,
      ...buildTripFields({ type, bus, vehicle, itemId, seats, takeOffDate, pickupPoint, dropPoint }),
    };

    try {
      booking = await Booking.create(bookingFields);
    } catch (createErr) {
      console.error("CREATE BOOKING ERROR:", createErr.message);
      return res.status(500).json({ message: "Failed to create booking", error: createErr.message });
    }

    // Keep a small in-memory fallback for legacy in-flight payments only.
    const metadata = { type, itemId, userId: customer.userId, customerName: customer.customerName, seats, takeOffDate, pickupPoint, dropPoint };
    global.khaltiTempStore = global.khaltiTempStore || new Map();
    global.khaltiTempStore.set(orderId, metadata);

    const payload = {
      return_url: process.env.KHALTI_RETURN_URL,
      website_url: process.env.KHALTI_WEBSITE_URL,
      amount: totalPrice * 100,
      purchase_order_id: orderId,
      purchase_order_name: productName,
      customer_info: {
        name: customer.customerName,
        email: customer.customerEmail,
        phone: customer.customerPhone,
      },
      product_details: productDetails,
      merchant_username: "tickxplore",
    };

    console.log("Sending to Khalti:", payload);
    const khaltiRes = await axios.post(KHALTI_BASE_URL, payload, {
      headers: {
        Authorization: `Key ${process.env.KHALTI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    console.log("Khalti INITIATE RESPONSE:", khaltiRes.data);

    // Attach the real Khalti pidx to the persisted booking.
    booking.transactionId = khaltiRes.data.pidx;
    await booking.save();

    return res.status(200).json({
      payment_url: khaltiRes.data.payment_url,
      pidx: khaltiRes.data.pidx,
      bookingId: booking._id,
      bookingNumber: booking.bookingNumber,
    });

  } catch (err) {
    console.error("INITIATE ERROR:", err.message || err);
    if (err.response?.data) console.error("Khalti error detail:", JSON.stringify(err.response.data));
    // Clean up the pending booking if Khalti rejected the initiate request.
    if (booking) {
      await Booking.deleteOne({ _id: booking._id }).catch(() => {});
    }
    return res.status(500).json({ message: "Failed to initiate payment", error: err.message });
  }
});



router.post("/verify", async (req, res) => {
  const { pidx } = req.body;

  if (!pidx) return res.status(400).json({ message: "Missing pidx" });

  try {
    const lookupRes = await axios.post(KHALTI_LOOKUP_URL, { pidx }, {
      headers: {
        Authorization: `Key ${process.env.KHALTI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const payment = lookupRes.data;

    if (payment.status !== "Completed") {
      return res.status(400).json({ message: "Payment not completed" });
    }

    let booking = await Booking.findOne({ transactionId: pidx });

    if (!booking) {
      return res.status(404).json({
        message: "No booking found for this payment. Please contact support.",
      });
    }

    // Integrity check: the paid amount must match what was charged.
    const expectedPaisa = Math.round(booking.totalPrice * 100);
    if (payment.total_amount && Number(payment.total_amount) !== expectedPaisa) {
      return res.status(400).json({ message: "Payment amount mismatch" });
    }

    // Already fully processed.
    if (booking.status === "Booked" && booking.settlementDone) {
      return res.status(200).json({ message: "Already verified", status: "Booked", bookingId: booking._id });
    }

    // Complete the booking idempotently (locks seats / creates reservation).
    await completeBooking(booking, pidx);

    return res.status(200).json({
      message: "Payment verified successfully",
      status: "Booked",
      bookingId: booking._id,
    });

  } catch (err) {
    console.error("VERIFY ERROR:", err.message || err);
    if (err.code === "SEAT_CONFLICT" || err.code === "VEHICLE_CONFLICT") {
      return res.status(409).json({
        message: err.message,
        code: err.code,
        conflictSeats: err.conflictSeats,
      });
    }
    return res.status(500).json({
      message: "Failed to verify payment",
      error: err.message,
    });
  }
});

router.get("/callback", async (req, res) => {
  const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
  const frontendUrl = (p, s) =>
    `${CLIENT_URL}/payment/callback?pidx=${encodeURIComponent(p || "")}&status=${encodeURIComponent(s || "unknown")}`;

  try {
    const { pidx, status, purchase_order_id } = req.query;

    if (!pidx || status !== "Completed") {
      return res.redirect(frontendUrl(pidx, status));
    }

    const lookupRes = await axios.post(KHALTI_LOOKUP_URL, { pidx }, {
      headers: {
        Authorization: `Key ${process.env.KHALTI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const paymentData = lookupRes.data;
    if (paymentData.status !== "Completed") {
      return res.redirect(frontendUrl(pidx, paymentData.status));
    }

    const orClauses = [{ transactionId: pidx }];
    if (purchase_order_id) orClauses.push({ purchaseOrderId: purchase_order_id });
    let booking = await Booking.findOne({ $or: orClauses });

    // Legacy fallback: recover an in-flight payment that predates the pending-booking change.
    if (!booking) {
      booking = await createBookingFromLegacyMeta(paymentData, req.query, pidx);
    }

    if (!booking) {
      return res.redirect(frontendUrl(pidx, "unverified"));
    }

    if (booking.status === "Booked" && booking.settlementDone) {
      return res.redirect(frontendUrl(pidx, "Completed"));
    }

    // Integrity check: the paid amount must match what was charged.
    const expectedPaisa = Math.round(booking.totalPrice * 100);
    if (paymentData.total_amount && Number(paymentData.total_amount) !== expectedPaisa) {
      return res.redirect(frontendUrl(pidx, "amount_mismatch"));
    }

    // Complete the booking idempotently. Side-effects are guarded so a failure
    // here can never strand a user who already paid.
    await completeBooking(booking, pidx);

    return res.redirect(frontendUrl(pidx, "Completed"));
  } catch (err) {
    console.error("❌ Callback error:", err.message || err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

router.post("/cash-on-visit", async (req, res) => {
  const {
    type,
    itemId,
    userId,
    seats,
    takeOffDate,
    pickupPoint,
    dropPoint,
    customerName,
    customerPhone,
    customerEmail,
    passengers,
  } = req.body;

  if (
    !itemId ||
    (!userId && !(customerName && customerEmail))
  ) {
    return res.status(400).json({
      message: "Missing required fields. Provide itemId and either userId or customer name + email.",
    });
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!userId && !EMAIL_RE.test((customerEmail || "").trim())) {
    return res.status(400).json({ message: "A valid customer email is required so the ticket can be emailed." });
  }

  try {
    const customer = await resolveCustomer(req.body);
    if (!customer.userId && !customer.customerName) {
      return res.status(400).json({ message: "Customer name is required for walk-in bookings." });
    }

    let totalPrice = 0, booking;
    const commissionRate = 10;
    let vendorEmail = "", productName = "", vendorId;

    if (type === "bus") {
      const bus = await Bus.findById(itemId).populate("vendorId");
      if (!bus) return res.status(404).json({ message: "Bus not found" });

      const conflictSeats = await findSeatConflicts(itemId, seats);
      if (conflictSeats.length > 0) {
        return res.status(409).json({
          message: "Some selected seats were just booked by another customer.",
          code: "SEAT_CONFLICT",
          conflictSeats,
        });
      }

      totalPrice = bus.pricePerSeat * seats.length;
      const commissionAmount = (commissionRate / 100) * totalPrice;
      const vendorEarnings = totalPrice - commissionAmount;

      booking = await Booking.create({
        userId: customer.userId || undefined,
        customerName: customer.customerName || undefined,
        customerPhone: customer.customerPhone || undefined,
        customerEmail: customer.customerEmail || undefined,
        passengers: Array.isArray(passengers) ? passengers : [],
        totalPrice,
        status: "Pending",
        paymentMethod: "CashOnVisit",
        paymentStatus: "CashOnVisit",
        transactionId: `cash-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        commissionAmount,
        vendorEarnings,
        bookingNumber: await allocateBookingNumber(new Date()),
        ...buildTripFields({ type, bus, itemId, seats, takeOffDate, pickupPoint, dropPoint }),
      });

      const locked = await tryLockBusSeats(itemId, seats);
      if (!locked) {
        await Booking.deleteOne({ _id: booking._id }).catch(() => {});
        return res.status(409).json({
          message: "Some selected seats were just booked by another customer.",
          code: "SEAT_CONFLICT",
          conflictSeats: seats.map(Number),
        });
      }

      if (bus.vendorId) {
        await Vendor.findByIdAndUpdate(bus.vendorId._id, {
          $inc: { totalEarnings: vendorEarnings, totalCommission: commissionAmount },
        });
        vendorEmail = bus.vendorId.email;
        vendorId = bus.vendorId._id;
        productName = bus.name;
      }

    } else if (type === "vehicle") {
      const vehicle = await Vehicle.findById(itemId).populate("vendorId");
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      const conflicted = await findVehicleConflict(itemId, takeOffDate);
      if (conflicted) {
        return res.status(409).json({
          message: "This vehicle was just reserved by another customer.",
          code: "VEHICLE_CONFLICT",
        });
      }

      totalPrice = vehicle.price;
      const commissionAmount = (commissionRate / 100) * totalPrice;
      const vendorEarnings = totalPrice - commissionAmount;

      const tripFields = buildTripFields({
        type,
        vehicle,
        itemId,
        takeOffDate,
        pickupPoint,
        dropPoint,
      });
      if (!tripFields.reservationDate) {
        return res.status(400).json({ message: "A reservation date is required for vehicle bookings." });
      }

      booking = await Booking.create({
        userId: customer.userId || undefined,
        customerName: customer.customerName || undefined,
        customerPhone: customer.customerPhone || undefined,
        customerEmail: customer.customerEmail || undefined,
        passengers: Array.isArray(passengers) ? passengers : [],
        totalPrice,
        status: "Pending",
        paymentMethod: "CashOnVisit",
        paymentStatus: "CashOnVisit",
        transactionId: `cash-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        commissionAmount,
        vendorEarnings,
        bookingNumber: await allocateBookingNumber(new Date()),
        ...tripFields,
      });

      // Date-scoped reservation (mirrors the online flow) so the vehicle can be
      // re-booked for other dates and conflicts are checked per-date.
      const reservedFrom = tripFields.reservationDate;
      const reservedUntil = endOfReservationDay(reservedFrom);
      await Reservation.create({
        vehicleId: itemId,
        userId: customer.userId || undefined,
        customerName: customer.customerName || undefined,
        customerPhone: customer.customerPhone || undefined,
        customerEmail: customer.customerEmail || undefined,
        pickupPoint: tripFields.pickupPoint,
        dropPoint: tripFields.dropPoint,
        reservedFrom,
        reservedUntil,
        paymentStatus: "CashOnVisit",
      });

      await Vehicle.findByIdAndUpdate(itemId, {
        isAvailable: false,
        reservedFrom,
        reservedUntil,
        $push: {
          reservations: {
            userId: customer.userId || undefined,
            reservedFrom,
            reservedUntil,
            pickupPoint: tripFields.pickupPoint,
            dropPoint: tripFields.dropPoint,
          },
        },
        $inc: { totalEarnings: vendorEarnings, totalCommission: commissionAmount },
      });

      if (vehicle.vendorId) {
        await Vendor.findByIdAndUpdate(vehicle.vendorId._id, {
          $inc: { totalEarnings: vendorEarnings, totalCommission: commissionAmount },
        });
        vendorEmail = vehicle.vendorId.email;
        vendorId = vehicle.vendorId._id;
        productName = vehicle.name;
      }
    } else {
      return res.status(400).json({ message: "Invalid booking type" });
    }

    // ✅ Admin commission update
    const admin = await Admin.findOne();
    if (admin) {
      const commissionAmount = (commissionRate / 100) * totalPrice;
      admin.totalCommission += commissionAmount;
      await admin.save();
    }

    // ✅ Customer PDF ticket email (non-blocking; booking stays successful even if it fails)
    let emailStatus = "Pending";
    await safeRun("customer ticket email", async () => {
      emailStatus = (await ticketService.sendTicketEmail(booking)).status;
    });

    if (customer.userId) {
      await Notification.create({
        userId: new mongoose.Types.ObjectId(customer.userId),
        role: "user",
        message: `Your booking for ${productName} is confirmed with Cash on Visit.`,
      });
    }

    // ✅ Vendor notification
    if (vendorId) {
      await Notification.create({
        userId: new mongoose.Types.ObjectId(vendorId),
        role: "vendor",
        message: `A new booking for ${productName} has been made with Cash on Visit.`,
      });
    }

    // ✅ Admin email
    await sendEmail(
      "tickxplore@gmail.com",
      "New Pending Cash on Visit Booking - TickXplore",
      `
      <p><strong>New Cash on Visit booking received:</strong></p>
      <ul>
        <li><strong>Booking Number:</strong> ${booking.bookingNumber}</li>
        <li><strong>User ID:</strong> ${userId}</li>
        <li><strong>Payment Method:</strong> Cash on Visit</li>
        <li><strong>Status:</strong> Pending</li>
        <li><strong>Total:</strong> Rs. ${totalPrice}</li>
      </ul>
      <p>Please verify and mark as paid when confirmed.</p>
      `
    );

    return res.status(201).json({
      message: "Booking created with Cash on Visit. Notifications and emails sent.",
      bookingId: booking._id,
      bookingNumber: booking.bookingNumber,
      emailStatus,
    });

  } catch (err) {
    console.error("❌ Error in booking process:", err.message || err);
    return res.status(500).json({ message: "Failed to process booking" });
  }
});


router.get("/cov-seats/:busId", async (req, res) => {
  try {
    const { busId } = req.params;
    const covBookings = await Booking.find({
      busId,
      paymentMethod: "CashOnVisit",
      status: "Pending"
    });

    const covSeats = covBookings.flatMap(b => b.selectedSeats);
    res.status(200).json({ covSeats });
  } catch (err) {
    console.error("Fetch CoV Seats Error:", err.message);
    res.status(500).json({ message: "Failed to fetch CoV seats" });
  }
});

// GET MY BOOKINGS
router.get("/my-bookings", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "Missing userId" });

  try {
    const bookings = await Booking.find({ userId })
      .populate("busId")
      .populate("vehicleId")
      .sort({ createdAt: -1 });

    return res.status(200).json({ bookings });

  } catch (err) {
    console.error("My Bookings Error:", err);
    return res.status(500).json({ message: "Failed to fetch bookings" });
  }
});

module.exports = router;