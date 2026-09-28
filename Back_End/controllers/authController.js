const bcrypt = require("bcryptjs");
const mongoose = require('mongoose');
const AdminModel = require('../models/Admin');
const VendorModel = require('../models/Vendor');
const UserModel = require('../models/User');
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");
const { sendEmail, sendSignupOTP } = require("../utils/sendEmail");
const generateOTP = require("../utils/generateOTP");
const Notification = require("../models/Notification");

exports.register = async (req, res) => {
  console.log("Registration data received:", req.body);

  const {
    name,
    location,
    email,
    phoneNumber,
    password,
    confirmPassword,
    role,
    vendorName,
    vendorLocation,
  } = req.body;

  try {
    // Validate all required fields
    if (
      !name ||
      !location ||
      !email ||
      !phoneNumber ||
      !password ||
      !confirmPassword ||
      !role ||
      (role === "vendor" && (!vendorName || !vendorLocation))
    ) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // Check password match
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists." });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    const otp = generateOTP();

    let newUser;
    if (role === "user") {
      newUser = await UserModel.create({
        name,
        location,
        email,
        phoneNumber,
        password: hashedPassword,
        role,
        otp,
        otpExpires: Date.now() + 10 * 60 * 1000,
        isVerified: false,
      });
    } else if (role === "vendor") {
      // Create vendor
      newUser = await VendorModel.create({
        name,
        location,
        vendorName,
        vendorLocation,
        email,
        phoneNumber,
        password: hashedPassword,
        role,
        otp,
        otpExpires: Date.now() + 10 * 60 * 1000,
        isVerified: false,
      });

      // Send notification to admin about new vendor registration
      const admins = await AdminModel.find({});
      for (let adminUser of admins) {
        await Notification.create({
          userId: adminUser._id,
          role: "admin",
          message: `A new vendor, ${vendorName}, has registered. Please review and activate their account.`,
        });
      }
    }

    // Send OTP email
    await sendSignupOTP(email, otp);

    // Send welcome email for Gmail users
    if (email.endsWith("@gmail.com")) {
      const displayName = name || "there";
      await sendEmail(
        email,
        "Welcome to TickXplore",
        `
        <h2>Hello ${displayName},</h2>
        <p>We're excited to have you onboard TickXplore!</p>
        <p>Start exploring and booking your next adventure today!</p>
      `
      );
    }

    res.status(201).json({
      message: "Registration successful. Please verify the OTP sent to your email.",
      user: { email, role, _id: newUser._id },
    });
  } catch (error) {
    console.error("Registration error:", error.message);
    res.status(500).json({ message: "Error during registration", error: error.message });
  }
};

exports.signIn = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user =
      (await UserModel.findOne({ email })) ||
      (await VendorModel.findOne({ email })) ||
      (await AdminModel.findOne({ email }));

    if (!user) return res.status(400).json({ message: "User not found." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Incorrect password." });

    if (!user.isVerified) {
      return res.status(403).json({ message: "Account is not verified. Please verify your OTP." });
    }

    // Vendors must be activated/approved by an admin before they can log in
    if (user.role === "vendor" && !user.isActive) {
      return res
        .status(403)
        .json({ message: "Your vendor account is not active yet. Please wait for admin approval." });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set refresh token as httpOnly cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 15 * 60 * 1000
    });

    res.status(200).json({
      message: "Login successful",
      token: accessToken,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        name: user.name || user.vendorName || "",
        vendorName: user.vendorName || "",
        profilePhoto: user.profilePhoto || "",
        isActive: user.isActive ?? true,
      },
    });
  } catch (error) {
    console.error("Sign-in error:", error.message);
    res.status(500).json({ message: "Error during sign-in", error: error.message });
  }
};

exports.verifyOTP = async (req, res) => {
  const { userId, otp } = req.body;
  console.log("Verifying OTP for userId:", userId, "with OTP:", otp);

  try {
    // Ensure userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    let user = await UserModel.findById(userId) || 
               await VendorModel.findById(userId) || 
               await AdminModel.findById(userId);

    if (!user) return res.status(400).json({ message: "User not found." });

    if (user.otp !== otp || Date.now() > user.otpExpires) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpires = null;
    await user.save();

    res.status(200).json({ message: "OTP verified successfully." });
  } catch (error) {
    console.error("OTP verification error:", error.message);
    res.status(500).json({ message: "Error verifying OTP", error: error.message });
  }
};


exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  const { role } = req.params; 
  let userModel;

  // Determine which model to use based on the role
  if (role === "admin") {
    userModel = AdminModel;
  } else if (role === "vendor") {
    userModel = VendorModel;
  } else if (role === "user") {
    userModel = UserModel;
  } else {
    return res.status(400).json({ message: "Invalid role" });
  }

  try {
    const user = await userModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate a reset code and expiration time
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetCode = resetCode;
    user.resetCodeExpires = Date.now() + 10 * 60 * 1000; 
    await user.save();

    // Send the reset code to the user's email
    await sendEmail(user.email, "Reset Password OTP", `<p>Your reset code is: ${resetCode}</p>`);

    res.status(200).json({ message: "Reset code sent to email" });
  } catch (err) {
    console.error("Error sending reset code:", err);
    res.status(500).json({ message: "Error sending reset code", error: err.message });
  }
};

exports.verifyResetOtp = async (req, res) => {
  const { email, otp, role } = req.body;
  let userModel;

  if (role === "admin") userModel = AdminModel;
  else if (role === "vendor") userModel = VendorModel;
  else if (role === "user") userModel = UserModel;
  else return res.status(400).json({ message: "Invalid role" });

  try {
    const user = await userModel.findOne({ email });

    if (!user || user.resetCode !== otp || Date.now() > user.resetCodeExpires) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // OTP verified successfully - don't clear resetCode yet, let resetPassword do that
    // But we can return success
    return res.status(200).json({ success: true, message: "OTP verified" });
  } catch (err) {
    res.status(500).json({ message: "OTP verification failed", error: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword, role } = req.body;
  let userModel;

  if (role === "admin") {
    userModel = require("../models/Admin");
  } else if (role === "vendor") {
    userModel = require("../models/Vendor");
  } else if (role === "user") {
    userModel = require("../models/User");
  } else {
    return res.status(400).json({ message: "Invalid role" });
  }

  if (!otp) {
    return res.status(400).json({ message: "OTP is required" });
  }

  try {
    const user = await userModel.findOne({ email });
    if (!user || !user.resetCode || user.resetCode !== otp || Date.now() > user.resetCodeExpires) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;
    await user.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ message: "Error resetting password", error: err.message });
  }
};

exports.changePassword = async (req, res) => {
  const { role } = req.params; // admin, vendor, user
  const { currentPassword, newPassword, confirmPassword } = req.body;

  console.log(" Decoded user from token:", req.user); // Should contain { id, role }

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  let Model;
  if (role === "admin") Model = AdminModel;
  else if (role === "vendor") Model = VendorModel;
  else if (role === "user") Model = UserModel;
  else return res.status(400).json({ message: "Invalid role" });

  try {
    // Support both `id` or `_id` in case token was created before fix
    const userId = req.user.id || req.user._id;
    const user = await Model.findById(userId);

    if (!user) {
      console.log(" User not found for ID:", userId);
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error(" Change password error:", error);
    res.status(500).json({ message: "Error changing password", error: error.message });
  }
}; 