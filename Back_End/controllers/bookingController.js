const Booking = require("../models/Booking");
const Reservation = require("../models/Reservation");
const Bus = require("../models/Bus");
const Vehicle = require("../models/Vehicle");
const User = require("../models/User");
const Notification = require("../models/Notification"); 
const ticketService = require("../utils/ticketService"); 


// ✅ Get all bookings for a user
exports.getUserBookings = async (req, res) => {
  const { userId } = req.params;
  try {
    const bookings = await Booking.find({ userId }).populate("busId vehicleId");
    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Failed to fetch user bookings" });
  }
};

// ✅ Get only Booked bookings
exports.getMyBookings = async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: "Missing userId" });

  try {
    const bookings = await Booking.find({ userId, status: "Booked" })
      .populate("busId vehicleId")
      .sort({ createdAt: -1 });

    res.status(200).json(bookings);
  } catch (err) {
    console.error("My Bookings Error:", err);
    res.status(500).json({ message: "Failed to fetch bookings" });
  }
};

// ✅ Hard delete booking
exports.deleteBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    await Booking.findByIdAndDelete(bookingId);
    res.status(200).json({ message: "Booking deleted successfully" });
  } catch (error) {
    console.error("Error deleting booking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ✅ Soft cancel booking (status update)
exports.cancelBookingStatus = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    booking.status = "Cancelled";
    await booking.save();

    res.json({ message: "Booking cancelled successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ✅ Create reservation
exports.createReservation = async (req, res) => {
  const { vehicleId, userId, reservedFrom, reservedUntil } = req.body;

  try {
    const existingReservation = await Reservation.findOne({
      vehicleId,
      $or: [
        { reservedFrom: { $lte: reservedUntil }, reservedUntil: { $gte: reservedFrom } },
      ],
    });

    if (existingReservation) {
      return res.status(409).json({ message: "Vehicle already reserved for selected date range." });
    }

    const reservation = new Reservation({
      vehicleId,
      userId,
      reservedFrom,
      reservedUntil,
      paymentStatus: "completed",
    });

    await reservation.save();
    res.status(201).json({ message: "Reservation successful", reservation });
  } catch (error) {
    console.error("Error creating reservation:", error);
    res.status(500).json({ message: "Server error while creating reservation" });
  }
};

// ✅ Get reservations by vehicle
exports.getReservationsByVehicle = async (req, res) => {
  const { vehicleId } = req.params;
  try {
    const reservations = await Reservation.find({ vehicleId });
    res.json(reservations);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch reservations" });
  }
};

exports.getBookingsByVendor = async (req, res) => {
    try {
      const { vendorId } = req.query;
      if (!vendorId) return res.status(400).json({ message: "Vendor ID is required" });
  
      // Fetch bus and vehicle IDs owned by vendor
      const buses = await Bus.find({ vendorId }).select("_id");
      const vehicles = await Vehicle.find({ vendorId }).select("_id");
  
      const busIds = buses.map(b => b._id);
      const vehicleIds = vehicles.map(v => v._id);
  
      const bookings = await Booking.find({
        $or: [
          { busId: { $in: busIds } },
          { vehicleId: { $in: vehicleIds } }
        ]
      }).populate("userId busId vehicleId");
  
      res.status(200).json({ bookings });
    } catch (error) {
      console.error("Error fetching bookings for vendor:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  };

// ✅ Confirm a Cash on Visit booking (vendor/admin collect the cash)
exports.confirmCoDBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.paymentStatus !== "CashOnVisit") {
      return res.status(400).json({ message: "This booking is not a Cash on Visit booking." });
    }

    if (booking.status === "Booked") {
      return res.status(200).json({ message: "Booking already confirmed", booking });
    }

    booking.status = "Booked";
    booking.paymentStatus = "Paid";
    await booking.save();

    // Deliver the finalized PDF ticket (never blocks the confirmation response).
    try {
      const result = await ticketService.sendTicketEmail(booking);
      if (result.status !== "Sent") {
        console.error("Confirm CoD ticket email issue:", result.error);
      }
    } catch (err) {
      console.error("Confirm CoD ticket email error:", err.message);
    }

    // Notify the user
    const user = await User.findById(booking.userId);
    if (user) {
      await Notification.create({
        userId: user._id,
        role: "user",
        message: `Your Cash on Visit booking has been confirmed.`,
      });
    }

    // Notify the concerned vendor (only if a different vendor confirms)
    let vendorId = null;
    if (booking.busId) {
      const bus = await Bus.findById(booking.busId);
      vendorId = bus?.vendorId;
    } else if (booking.vehicleId) {
      const vehicle = await Vehicle.findById(booking.vehicleId);
      vendorId = vehicle?.vendorId;
    }
    if (vendorId && String(vendorId) !== String(req.user._id)) {
      await Notification.create({
        userId: vendorId,
        role: "vendor",
        message: `Cash on Visit payment confirmed for booking ${booking.bookingNumber || booking._id}.`,
      });
    }

    res.json({ message: "Booking confirmed successfully", booking });
  } catch (err) {
    console.error("Confirm CoD booking error:", err);
    res.status(500).json({ error: err.message });
  }
};