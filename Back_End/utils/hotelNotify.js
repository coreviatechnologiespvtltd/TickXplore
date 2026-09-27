const Admin = require("../models/Admin");
const Notification = require("../models/Notification");
const { sendEmail } = require("./sendEmail");

/**
 * Notification helpers shared by the hotel dashboard and the admin moderation
 * API. Both directions are best-effort: a failure here must never roll back the
 * database write that triggered it.
 */

/** Notify every admin (used when a hotel submits a listing). */
const notifyAdmins = async (message) => {
  try {
    const admins = await Admin.find({});
    if (admins.length === 0) return;
    await Notification.insertMany(
      admins.map((admin) => ({ userId: admin._id, role: "admin", message }))
    );
  } catch (error) {
    console.warn(" Could not notify admins:", error.message);
  }
};

/** In-app notification for a single hotel. */
const notifyHotel = async (hotel, message) => {
  try {
    await Notification.create({ userId: hotel._id, role: "hotel", message });
  } catch (error) {
    console.warn(" Could not notify hotel:", error.message);
  }
};

/** Send an email to a hotel, swallowing transport errors. */
const emailHotel = async (hotel, subject, html) => {
  try {
    await sendEmail(hotel.email, subject, html);
  } catch (error) {
    console.warn(" Hotel email failed:", error.message);
  }
};

module.exports = { notifyAdmins, notifyHotel, emailHotel };
