const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
const { sendEmail } = require("../utils/sendEmail");
const Booking = require("../models/Booking");
const { safeUpload, safeDelete } = require("../utils/safeUpload");



// Get Vendor Profile
exports.getProfile = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.user.id).select("-password").lean();
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.json({ success: true, vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const vendor = await Vendor.findOne({ email });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    vendor.resetCode = resetCode;
    vendor.resetCodeExpires = Date.now() + 10 * 60 * 1000; // Expiration time (10 minutes)
    await vendor.save();

    await sendEmail(email, "TickXplore - Reset Password OTP", `<p>Your OTP is <b>${resetCode}</b>. It will expire in 10 minutes.</p>`);

    res.json({ success: true, message: "Reset code sent to email" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to send reset code" });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const vendor = await Vendor.findOne({ email });

    if (!vendor || vendor.resetCode !== code || vendor.resetCodeExpires < Date.now()) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    vendor.password = await bcrypt.hash(newPassword, 10);
    vendor.resetCode = null;
    vendor.resetCodeExpires = null;
    await vendor.save();

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to reset password" });
  }
};

// Admin: Get All Vendors
exports.getAllVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find().select("-password").lean();
    res.status(200).json({ success: true, vendors });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Admin: Get Vendor by ID
exports.getVendorById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Vendor ID format" });
    }

    const vendor = await Vendor.findById(id).select("-password");
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    res.status(200).json({ success: true, vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Admin: Update Vendor (can activate from here)
exports.updateVendor = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Vendor ID format" });
    }

    const updateData = { ...req.body };

    // 🔽 Handle profile photo upload
    if (req.files && req.files.profilePhoto) {
      const photo = req.files.profilePhoto;

      const vendor = await Vendor.findById(id);
      if (vendor && vendor.profilePhoto) {
        await safeDelete(vendor.profilePhoto);
      }

      let profilePhotoUrl;
      try {
        const result = await safeUpload(photo);
        profilePhotoUrl = result.relativePath;
      } catch (uploadError) {
        return res.status(400).json({ success: false, message: uploadError.message });
      }

      updateData.profilePhoto = profilePhotoUrl;
    }

    const updatedVendor = await Vendor.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedVendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    // ✅ Notify vendor if activated
    if (req.body.isActive === true) {
      await sendEmail(
        updatedVendor.email,
        "TickXplore - Account Activated",
        `<p>Your vendor account has been approved. You may now log in.</p>`
      );
    }

    res.status(200).json({ 
      success: true, 
      message: "Vendor updated successfully", 
      vendor: updatedVendor
    });
  } catch (error) {
    console.error("Update Vendor Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
  }
};


// Delete Vendor (Admin)
exports.deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Vendor.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    res.status(200).json({ success: true, message: "Vendor deleted successfully" });
  } catch (err) {
    console.error("Delete vendor error:", err);
    res.status(500).json({ success: false, message: "Failed to delete vendor", error: err.message });
  }
};

