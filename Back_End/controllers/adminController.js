const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const generateToken = require("../utils/generateToken");
const { sendEmail } = require("../utils/sendEmail"); 
const Booking = require("../models/Booking");
const { safeUpload, safeDelete } = require("../utils/safeUpload");

// Forgot Password for Admin
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const admin = await Admin.findOne({ email });

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    admin.resetCode = resetCode;
    admin.resetCodeExpires = Date.now() + 10 * 60 * 1000;
    await admin.save();

    await sendEmail(
      email,
      "Password Reset OTP",
      `<p>Your reset code is <b>${resetCode}</b>. It expires in 10 minutes.</p>`
    );

    return res.status(200).json({
      message: "Password reset code sent to your email",
    });
  } catch (err) {
    console.error("Error sending reset code:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
};

// Reset Password for Admin
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const admin = await Admin.findOne({ email });

    if (!admin || admin.resetCode !== code || Date.now() > admin.resetCodeExpires) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    admin.password = await bcrypt.hash(newPassword, 10);
    admin.resetCode = undefined;
    admin.resetCodeExpires = undefined;
    await admin.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ message: "Error resetting password", error: err.message });
  }
};

// Get Admin Profile
exports.getProfile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.user.id).select("-password");
    if (!admin) return res.status(404).json({ message: "Admin not found" });
    res.json({ admin });
  } catch (err) {
    res.status(500).json({ message: "Error getting profile", error: err.message });
  }
};

// Get All Admins
exports.getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select("-password");
    res.json({ admins });
  } catch (err) {
    res.status(500).json({ message: "Error fetching admins", error: err.message });
  }
};

// Get Admin by ID
exports.getAdminById = async (req, res) => {
  try {
    const { id } = req.params;
    const admin = await Admin.findById(id).select("-password");

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.status(200).json({ success: true, admin });
  } catch (err) {
    res.status(500).json({ message: "Error fetching admin by ID", error: err.message });
  }
};

// Update Admin
exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = { ...req.body };

    // Hash password if included
    if (updateFields.password) {
      updateFields.password = await bcrypt.hash(updateFields.password, 10);
    }

    // 🔍 Find the existing admin to get old profilePhoto URL
    const existingAdmin = await Admin.findById(id);
    if (!existingAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // 📷 Handle new profile photo
    if (req.files && req.files.profilePhoto) {
      const photo = req.files.profilePhoto;

      if (existingAdmin.profilePhoto) {
        await safeDelete(existingAdmin.profilePhoto);
      }

      let profilePhotoUrl;
      try {
        const result = await safeUpload(photo);
        profilePhotoUrl = result.relativePath;
      } catch (uploadError) {
        return res.status(400).json({ message: uploadError.message });
      }

      updateFields.profilePhoto = profilePhotoUrl;
    }

    // 🔄 Update admin
    const updated = await Admin.findByIdAndUpdate(id, updateFields, {
      new: true,
      runValidators: true,
    }).select("-password");

    res.json({ message: "Admin updated", admin: updated });
  } catch (err) {
    console.error("Update admin error:", err);
    res.status(500).json({ message: "Error updating admin", error: err.message });
  }
};


// Toggle Vendor Status (Activate/Deactivate)
exports.toggleVendorStatus = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    vendor.isActive = !vendor.isActive;
    await vendor.save();

    if (vendor.isActive) {
      console.log("Sending activation email to:", vendor.email);
      await sendEmail(
        vendor.email,
        "Your Vendor Account is Now Active",
        `
          <h2>Hello ${vendor.vendorName},</h2>
          <p> Great news! Your vendor account on <strong>TickXplore</strong> has been activated by the admin.</p>
          <p>You can now log in and start managing your listings!</p>
          <p><a href="http://localhost:5173/sign-in">Click here to log in</a></p>
          <br/>
          <p>Welcome aboard!<br/>— Team TickXplore</p>
        `
      );
    }

    res.status(200).json({
      message: `Vendor ${vendor.isActive ? "activated" : "deactivated"} successfully`,
      vendor,
    });
  } catch (error) {
    console.error("Error toggling vendor status:", error);
    res.status(500).json({ message: "Failed to toggle vendor status" });
  }
};

// Approve Vendor Application
exports.approveVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    vendor.isActive = true;
    vendor.applicationStatus = "approved";
    await vendor.save();

    await sendEmail(
      vendor.email,
      "Your Vendor Account is Now Active",
      `
        <h2>Hello ${vendor.vendorName},</h2>
        <p> Great news! Your vendor account on <strong>TickXplore</strong> has been approved by the admin.</p>
        <p>You can now log in and start managing your listings!</p>
        <p><a href="http://localhost:5173/sign-in">Click here to log in</a></p>
        <br/>
        <p>Welcome aboard!<br/>— Team TickXplore</p>
      `
    );

    res.status(200).json({
      message: `Vendor ${vendor.vendorName} approved successfully`,
      vendor,
    });
  } catch (error) {
    console.error("Error approving vendor:", error);
    res.status(500).json({ message: "Failed to approve vendor" });
  }
};

// Decline Vendor Application
exports.declineVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    vendor.isActive = false;
    vendor.applicationStatus = "declined";
    await vendor.save();

    try {
      await sendEmail(
        vendor.email,
        "Vendor Application Update - TickXplore",
        `
        <h2>Hello ${vendor.vendorName},</h2>
        <p>Thank you for applying to become a vendor on <strong>TickXplore</strong>.</p>
        <p>Unfortunately, your application has been declined by our admin team at this time.</p>
        <p>You are welcome to re-apply whenever you are ready.</p>
        <br/>
        <p>Warm regards,<br/>— Team TickXplore</p>
      `
      );
    } catch (emailError) {
      console.error("Error sending decline email:", emailError);
    }

    res.status(200).json({
      message: `Vendor ${vendor.vendorName} declined successfully`,
      vendor,
    });
  } catch (error) {
    console.error("Error declining vendor:", error);
    res.status(500).json({ message: "Failed to decline vendor" });
  }
};

// Delete Admin
exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    await Admin.findByIdAndDelete(id);
    res.json({ message: "Admin deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting admin", error: err.message });
  }
};

// Edit User By Admin
exports.editUserByAdmin = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { name } = req.body;

    const updatedUser = await User.findByIdAndUpdate(userId, { name }, { new: true });

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User updated successfully", user: updatedUser });
  } catch (error) {
    res.status(500).json({ message: "Failed to update user", error });
  }
};

// Delete User by Admin
exports.deleteUserByAdmin = async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.userId);
    if (!deletedUser) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete user", error });
  }
};

// Edit Vendor by Admin
exports.editVendorByAdmin = async (req, res) => {
  try {
    const vendorId = req.params.vendorId;
    const { vendorName } = req.body;

    const updatedVendor = await Vendor.findByIdAndUpdate(vendorId, { vendorName }, { new: true });

    if (!updatedVendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    res.json({ message: "Vendor updated successfully", vendor: updatedVendor });
  } catch (error) {
    res.status(500).json({ message: "Failed to update vendor", error });
  }
};

// Delete Vendor by Admin
exports.deleteVendorByAdmin = async (req, res) => {
  try {
    const deletedVendor = await Vendor.findByIdAndDelete(req.params.vendorId);
    if (!deletedVendor) return res.status(404).json({ message: "Vendor not found" });
    res.json({ message: "Vendor deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete vendor", error });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate("userId", "name email phoneNumber")
      /* takeOffDate is the trip's departure instant; without it the admin
         ticket view falls back to "N/A" on legacy rows. */
      .populate("busId", "name pickupPoint dropPoint takeOffDate")
      .populate("vehicleId", "name price pickupPoint dropPoint")
      .sort({ createdAt: -1 });

    const formattedBookings = bookings.map(b => ({
      ...b._doc,
      user: b.userId,   
      bus: b.busId,
      vehicle: b.vehicleId
    }));

    res.status(200).json({ bookings: formattedBookings });
  } catch (err) {
    console.error("Admin Bookings Error:", err.message);
    res.status(500).json({ message: "Failed to fetch bookings", error: err.message });
  }
};