const firebaseAuth = require("../config/firebase");
const UserModel = require("../models/User");
const VendorModel = require("../models/Vendor");
const AdminModel = require("../models/Admin");
const HotelModel = require("../models/Hotel");
const { generateAccessToken, generateRefreshToken } = require("../utils/generateToken");

exports.googleSignIn = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ message: "Firebase idToken is required." });
  }

  if (!firebaseAuth) {
    return res
      .status(503)
      .json({ message: "Google sign-in via Firebase is not configured yet." });
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);

    const googleId = decoded.uid;
    const email = decoded.email;
    const name = decoded.name || decoded.displayName || "";
    const picture = decoded.picture || "";

    if (!email) {
      return res.status(401).json({ message: "Google sign-in failed: no email in token." });
    }

    let user =
      (await UserModel.findOne({ googleId })) ||
      (await VendorModel.findOne({ googleId })) ||
      (await AdminModel.findOne({ googleId })) ||
      (await HotelModel.findOne({ googleId })) ||
      (await UserModel.findOne({ email })) ||
      (await VendorModel.findOne({ email })) ||
      (await AdminModel.findOne({ email })) ||
      (await HotelModel.findOne({ email }));

    if (!user) {
      user = await UserModel.create({
        googleId,
        name,
        location: "Not provided",
        email,
        isVerified: true,
        role: "user",
        profilePhoto: picture,
      });
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
      }
      // Sync the Google profile picture for existing accounts, but never
      // overwrite a profile photo the user has uploaded or set themselves.
      if (picture && !user.profilePhoto) {
        user.profilePhoto = picture;
      }
      await user.save();
    }

    if (user.role === "vendor" && !user.isActive) {
      return res
        .status(403)
        .json({ message: "Your vendor account is not active yet. Please wait for admin approval." });
    }

    if (user.role === "hotel" && !user.isActive) {
      return res
        .status(403)
        .json({ message: "Your hotel account is not active yet. Please wait for admin approval." });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 15 * 60 * 1000,
    });

    res.status(200).json({
      message: "Login successful",
      token: accessToken,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        name: user.name || user.vendorName || user.hotelName || "",
        vendorName: user.vendorName || "",
        hotelName: user.hotelName || "",
        profilePhoto: user.profilePhoto || (picture || ""),
        isActive: user.isActive ?? true,
        listingStatus: user.listingStatus || null,
      },
    });
  } catch (error) {
    console.error("Google sign-in error:", error);
    res.status(401).json({ message: "Google sign-in failed", error: error.message });
  }
};