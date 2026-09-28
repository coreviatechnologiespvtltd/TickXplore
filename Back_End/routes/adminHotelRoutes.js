const express = require("express");
const router = express.Router();

const adminHotelController = require("../controllers/adminHotelController");
const { protect, authorize } = require("../middleware/authMiddleware");
const { validate } = require("../middleware/validation");
const { notFound, errorHandler } = require("../utils/http");
const {
  objectId,
  adminListRules,
  reviewRules,
  rejectRules,
  listingActionRules,
} = require("../validators/hotelValidators");

/**
 * Admin hotel moderation — mounted at `/admin/hotels`.
 * Mirrors the existing `/admin/vendor/:vendorId/approve` flow for vendors.
 */

router.use(protect, authorize("admin"));

router.get("/summary", adminHotelController.getStatusSummary);
router.get("/pending", adminHotelController.getPendingListings);
router.get("/", validate(adminListRules), adminHotelController.getAllHotels);

/* Listing review — static suffixes stay above `/:id`. */
router.put("/:id/review/approve", validate([objectId("id"), ...reviewRules]), adminHotelController.approveListing);
router.put("/:id/review/reject", validate([objectId("id"), ...rejectRules]), adminHotelController.rejectListing);
router.put("/:id/status/suspend", validate([objectId("id"), ...listingActionRules]), adminHotelController.suspendListing);
router.put("/:id/status/reinstate", validate([objectId("id"), ...listingActionRules]), adminHotelController.reinstateListing);
router.put("/:id/status/archive", validate([objectId("id"), ...listingActionRules]), adminHotelController.archiveListing);
router.put("/:id/activate", validate([objectId("id")]), adminHotelController.activateAccount);

router.get("/:id", validate([objectId("id")]), adminHotelController.getHotel);
router.put("/:id", validate([objectId("id")]), adminHotelController.updateHotel);
router.delete("/:id", validate([objectId("id")]), adminHotelController.deleteHotel);

router.use(notFound);
router.use(errorHandler);

module.exports = router;
