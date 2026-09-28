const bcrypt = require("bcryptjs");
const UserModel = require("../models/User");
const VendorModel = require("../models/Vendor");
const AdminModel = require("../models/Admin");
const Notification = require("../models/Notification");
const { sendEmail } = require("../utils/sendEmail");
const { safeUpload, safeDelete } = require("../utils/safeUpload");

// Get User Profile
exports.getProfile = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch profile" });
  }
};

// Forgot Password (Initiates password reset process)
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await UserModel.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    user.resetCodeExpires = Date.now() + 10 * 60 * 1000; // Reset code expires in 10 minutes
    await user.save();

    await sendEmail(email, "TickXplore - Reset Password", `<p>Your OTP is <b>${resetCode}</b>. It will expire in 10 minutes.</p>`);

    res.json({ success: true, message: "Reset OTP sent to email" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to send reset code" });
  }
};

// Reset Password (Updates password after OTP verification)
exports.resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    const user = await UserModel.findOne({ email });

    if (!user || user.resetCode !== code || user.resetCodeExpires < Date.now()) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetCode = null;
    user.resetCodeExpires = null;
    await user.save();

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to reset password" });
  }
};

// Get All Users (Admin)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await UserModel.find().select("-password");
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch users", error: error.message });
  }
};

// Get User by ID (Admin)
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await UserModel.findById(id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let vendorStatus = "none";
    const vendor = await VendorModel.findOne({ email: user.email });
    if (vendor) {
      if (vendor.applicationStatus === "declined") {
        vendorStatus = "declined";
      } else if (vendor.isActive && vendor.applicationStatus === "approved") {
        vendorStatus = "active";
      } else {
        vendorStatus = "pending";
      }
    }

    res.status(200).json({ success: true, user: { ...user.toObject(), vendorStatus } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch user", error: error.message });
  }
};

// Notify all admins of a new vendor application (in-app + email)
const notifyAdmins = async (message, details) => {
  const admins = await AdminModel.find({});
  for (const adminUser of admins) {
    await Notification.create({
      userId: adminUser._id,
      role: "admin",
      message,
    });

    try {
      await sendEmail(
        adminUser.email,
        "New Vendor Application - TickXplore",
        `
        <h2>New Vendor Application</h2>
        <p><strong>${details.vendorName}</strong> has applied to become a vendor on TickXplore.</p>
        <ul>
          <li><strong>Email:</strong> ${details.email}</li>
          <li><strong>Location:</strong> ${details.vendorLocation}</li>
          <li><strong>Reason:</strong> ${details.applicationReason}</li>
        </ul>
        <p>Their application is pending your review. Please accept or decline it:</p>
        <p><a href="http://localhost:5173/Admin_Dashboard/vendor-applications">Review Vendor Applications</a></p>
        <br/>
        <p>— Team TickXplore</p>
        `
      );
    } catch (emailError) {
      console.error("Error notifying admin by email:", emailError);
    }
  }
};

// Apply to become a Vendor (User -> Vendor application)
exports.applyForVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorName, vendorLocation, phoneNumber, applicationReason } = req.body;

    const user = await UserModel.findById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!vendorName || !vendorLocation) {
      return res
        .status(400)
        .json({ success: false, message: "Vendor name and location are required" });
    }

    const reason = (applicationReason || "").trim();
    if (!reason) {
      return res
        .status(400)
        .json({ success: false, message: "Please provide a reason for becoming a vendor" });
    }
    if (reason.length > 100) {
      return res
        .status(400)
        .json({ success: false, message: "Reason must be 100 characters or fewer" });
    }

    const displayName = user.name || vendorName || "Vendor";

    let vendor = await VendorModel.findOne({ email: user.email });

    if (vendor) {
      if (vendor.applicationStatus === "pending" || vendor.isActive) {
        return res.status(200).json({
          success: true,
          vendorStatus: vendor.isActive ? "active" : "pending",
          message: "You have already applied to become a vendor.",
        });
      }

      // A declined application can be re-submitted.
      vendor.vendorName = vendorName;
      vendor.vendorLocation = vendorLocation;
      vendor.applicationReason = reason;
      if (phoneNumber) vendor.phoneNumber = phoneNumber;
      vendor.applicationStatus = "pending";
      vendor.isActive = false;
      await vendor.save();

      await notifyAdmins(
        `${vendorName} has re-applied to become a vendor. Please review their application.`,
        { vendorName, email: user.email, vendorLocation, applicationReason: reason }
      );

      return res.status(200).json({
        success: true,
        vendorStatus: "pending",
        message: "Application re-submitted. Pending admin approval.",
      });
    }

    vendor = await VendorModel.create({
      name: displayName,
      vendorName,
      vendorLocation,
      applicationReason: reason,
      email: user.email,
      phoneNumber: phoneNumber || undefined,
      googleId: user.googleId || undefined,
      profilePhoto: user.profilePhoto || "",
      role: "vendor",
      isVerified: true,
      isActive: false,
      applicationStatus: "pending",
    });

    await notifyAdmins(
      `${vendor.vendorName} has applied to become a vendor. Please review their application.`,
      {
        vendorName: vendor.vendorName,
        email: vendor.email,
        vendorLocation: vendor.vendorLocation,
        applicationReason: vendor.applicationReason,
      }
    );

    res.status(201).json({
      success: true,
      vendorStatus: "pending",
      message: "Vendor application submitted. Pending admin approval.",
      vendor,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to submit vendor application",
      error: error.message,
    });
  }
};

// Update User 
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // 🔍 Step 1: Get the existing user
    const existingUser = await UserModel.findById(id);
    if (!existingUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Step 2: Handle profile photo update
    if (req.files && req.files.profilePhoto) {
      const photo = req.files.profilePhoto;

      if (existingUser.profilePhoto) {
        await safeDelete(existingUser.profilePhoto);
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

    // Step 3: Update user in database
    const updatedUser = await UserModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: updatedUser,
    });

    console.log("Updated user:", updatedUser);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: error.message,
    });
  }
};

exports.updateUserLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    console.log("Incoming location update for user ID:", id);

    const user = await UserModel.findById(id);
    if (!user) {
      console.log("User not found for ID:", id);
      return res.status(404).json({ message: "User not found" });
    }

    user.currentLocation = {
      latitude,
      longitude,
      updatedAt: Date.now(),
    };

    await user.save();
    res.status(200).json({ message: "User location updated" });
  } catch (err) {
    console.error("Error updating user location:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};


// Delete User (Admin)
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await UserModel.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: "User deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete user", error: error.message });
  }
};
