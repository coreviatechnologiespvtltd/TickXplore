const express = require("express");
const router = express.Router();
const { protect, authorize } = require("../middleware/authMiddleware");

const userController = require("../controllers/userController");
const vendorController = require("../controllers/vendorController");
const adminController = require("../controllers/adminController");

// Protect all admin dashboard routes
router.use(protect, authorize("admin"));

// Routes for dashboard data
router.get("/get-users", userController.getAllUsers);
router.get("/get-vendors", vendorController.getAllVendors);
router.get("/get-admins", adminController.getAllAdmins);

module.exports = router;
