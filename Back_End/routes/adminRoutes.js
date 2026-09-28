const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Admin Authentication (public routes)
router.post("/forgot-password", adminController.forgotPassword);
router.post("/reset-password", adminController.resetPassword);

// Protected admin routes - require authentication and admin role
router.use(protect, authorize("admin"));

// Admin Profile & Listings
router.get("/profile", adminController.getProfile);
router.get("/all", adminController.getAllAdmins);

//  MUST come before `/:id`
router.get("/bookings", adminController.getAllBookings);

// Always put dynamic routes last
router.get("/:id", adminController.getAdminById);
router.put("/:id", adminController.updateAdmin);
router.delete("/:id", adminController.deleteAdmin);

// Support old toggle route
router.put("/toggle-vendor/:vendorId", adminController.toggleVendorStatus);

// Vendor Management
router.put("/vendor/:vendorId/status", adminController.toggleVendorStatus);
router.put("/vendor/:vendorId/approve", adminController.approveVendor);
router.put("/vendor/:vendorId/decline", adminController.declineVendor);
router.put("/vendor/:vendorId", adminController.editVendorByAdmin);
router.delete("/vendor/:vendorId", adminController.deleteVendorByAdmin);

// User Management
router.put("/user/:userId", adminController.editUserByAdmin);
router.delete("/user/:userId", adminController.deleteUserByAdmin);

module.exports = router;
