const mongoose = require("mongoose");
const Vehicle = require("../models/Vehicle");
const Reservation = require("../models/Reservation");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { sendEmail } = require("../utils/sendEmail");
const { safeUpload, safeDelete } = require("../utils/safeUpload");

//Validate Required Fields
const validateRequiredFields = (fields, res) => {
  const missingFields = Object.keys(fields).filter((key) => !fields[key]);
  if (missingFields.length > 0) {
    res.status(400).json({
      success: false,
      message: `Missing required fields: ${missingFields.join(", ")}`,
    });
    return false;
  }
  return true;
};

// Create Vehicle
exports.createVehicle = async (req, res) => {
  try {
    const { vendorId, name, price, capacity } = req.body;

    if (!validateRequiredFields({ vendorId, name, price, capacity }, res)) return;

    let objectIdVendorId;
    try {
      objectIdVendorId = new mongoose.Types.ObjectId(vendorId);
    } catch {
      return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
    }

    if (!req.files || !req.files.image) {
      return res.status(400).json({ success: false, message: "Image is required." });
    }

    let imageUrl;
    try {
      const result = await safeUpload(req.files.image);
      imageUrl = result.relativePath;
    } catch (uploadError) {
      return res.status(400).json({ success: false, message: uploadError.message });
    }

    // Create the new vehicle object
    const newVehicle = new Vehicle({
      vendorId: objectIdVendorId,
      name,
      price: Number(price),
      capacity: Number(capacity),
      image: imageUrl,
      isAvailable: true,
      reservations: [], // only for internal checking, no takeOffDate needed
    });

    // Save the new vehicle to the database
    await newVehicle.save();

    // Now send notifications to all verified users that a new vehicle is available
    const users = await User.find({ isVerified: true });  // Fetch all verified users
    console.log("Users fetched:", users.length);

    for (let user of users) {
      try {
        // Create a notification for each user
        await Notification.create({
          userId: user._id,
          role: "user",
          message: `A new vehicle "${newVehicle.name}" is now available for booking. Check it out!`,
        });
        console.log(`Notification sent to user ${user._id}`);
      } catch (err) {
        console.error(`Error creating notification for user ${user._id}:`, err.message);
      }
    }

    console.log("Notifications sent to users for new vehicle creation.");

    // Return success response
    res.status(201).json({
      success: true,
      message: "Vehicle added successfully and notifications sent.",
      vehicle: newVehicle,
    });
  } catch (error) {
    console.error("Error creating vehicle:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create vehicle.",
      error: error.message,
    });
  }
};




//Get All Vehicles
exports.getAllVehicles = async (req, res) => {
  try {
    const { vendorId, admin } = req.query;
    const query = admin === "true" ? {} : vendorId ? { vendorId } : {};
    const vehicles = await Vehicle.find(query).populate("vendorId", "name email");

    if (!vehicles.length) {
      return res.status(200).json({ success: true, vehicles: [], message: "No vehicles found." });
    }

    res.status(200).json({
      success: true,
      vehicles: vehicles.map(vehicle => ({
        ...vehicle.toObject(),
        image: vehicle.image || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch vehicles.", error: error.message });
  }
};

//Get Vehicle by ID
exports.getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate("vendorId", "name email");
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }
    res.status(200).json({
      success: true,
      vehicle: {
        ...vehicle.toObject(),
        image: vehicle.image || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch vehicle.", error: error.message });
  }
};

//Update Vehicle
exports.updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorId, name, price, capacity, isAvailable } = req.body; // ❌ Removed takeOffDate

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    let objectIdVendorId;
    if (vendorId) {
      try {
        objectIdVendorId = new mongoose.Types.ObjectId(vendorId);
      } catch {
        return res.status(400).json({ success: false, message: "Invalid vendor ID format." });
      }
    }

    if (req.files?.image) {
      const file = req.files.image;

      if (vehicle.image) {
        await safeDelete(vehicle.image);
      }

      let imageUrl;
      try {
        const result = await safeUpload(file);
        imageUrl = result.relativePath;
      } catch (uploadError) {
        return res.status(400).json({ success: false, message: uploadError.message });
      }

      vehicle.image = imageUrl;
    }

    if (vendorId) vehicle.vendorId = objectIdVendorId;
    if (name) vehicle.name = name;
    if (price) vehicle.price = Number(price);
    if (capacity) vehicle.capacity = Number(capacity);
    if (isAvailable !== undefined) vehicle.isAvailable = isAvailable;

    await vehicle.save();
    res.status(200).json({ success: true, message: "Vehicle updated successfully.", vehicle });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update vehicle.", error: error.message });
  }
};


//Delete Vehicle
exports.deleteVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found." });

    if (vehicle.image) {
      await safeDelete(vehicle.image);
    }

    await vehicle.deleteOne();
    res.status(200).json({ success: true, message: "Vehicle deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete vehicle.", error: error.message });
  }
};

// Reserve Vehicle
exports.reserveVehicle = async (req, res) => {
  try {
    const { id } = req.params; // Vehicle ID
    const { userId, reservedFrom, reservedUntil, pickupPoint, dropPoint } = req.body;

    if (!validateRequiredFields({ userId, reservedFrom, reservedUntil, pickupPoint, dropPoint }, res)) return;

    const vehicle = await Vehicle.findById(id);
    if (!vehicle) return res.status(404).json({ success: false, message: "Vehicle not found." });

    // Check if vehicle is available for these dates
    const existingReservations = await Reservation.find({ vehicleId: id });

    const isAvailable = existingReservations.every(reservation =>
      new Date(reservedUntil) < new Date(reservation.reservedFrom) ||
      new Date(reservedFrom) > new Date(reservation.reservedUntil)
    );

    if (!isAvailable) {
      return res.status(400).json({ success: false, message: "Vehicle is not available for the requested dates." });
    }

    // Create a new reservation
    const newReservation = new Reservation({
      vehicleId: id,
      userId,
      pickupPoint,
      dropPoint,
      reservedFrom,
      reservedUntil,
      paymentStatus: "pending", // default status
    });

    await newReservation.save();

    res.status(201).json({ success: true, message: "Reservation successful.", reservation: newReservation });
  } catch (error) {
    console.error("Error reserving vehicle:", error);
    res.status(500).json({ success: false, message: "Failed to reserve vehicle.", error: error.message });
  }
};

// Update Vehicle Location Controller
exports.getVehicleLocation = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle || !vehicle.currentLocation) {
      return res.status(404).json({ message: "Location not available" });
    }
    res.json(vehicle.currentLocation);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
