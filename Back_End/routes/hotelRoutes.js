const express = require("express");
const router = express.Router();

const hotelController = require("../controllers/hotelController");
const hotelRoomController = require("../controllers/hotelRoomController");
const hotelAvailabilityController = require("../controllers/hotelAvailabilityController");

const { hotelOnly, loadOwnHotel, loadOwnRoom, loadOwnBlock } = require("../middleware/hotelAuth");
const { validate } = require("../middleware/validation");
const { notFound, errorHandler } = require("../utils/http");
const {
  objectId,
  updateProfileRules,
  updatePoliciesRules,
  createRoomRules,
  updateRoomRules,
  pricingRules,
  setAvailabilityRules,
  createBlockRules,
  listingActionRules,
} = require("../validators/hotelValidators");

/**
 * Hotel dashboard API — mounted at `/api/hotel` (and `/hotel` for parity with
 * the existing vendor dashboard mounts).
 *
 * Every route below `hotelOnly` requires a valid JWT for a `role: "hotel"`
 * account that an admin has activated, and every resource lookup is scoped by
 * `req.user._id`.
 */

/* ------------------------- account (unauthenticated) ------------------------- */
router.post("/forgot-password", hotelController.forgotPassword);
router.post("/reset-password", hotelController.resetPassword);

/* ------------------------------ profile + stats ------------------------------ */
router.get("/profile", ...hotelOnly, loadOwnHotel, hotelController.getProfile);
router.put("/profile", ...hotelOnly, loadOwnHotel, validate(updateProfileRules), hotelController.updateProfile);

router.get("/stats", ...hotelOnly, loadOwnHotel, hotelController.getStats);

/* ---------------------------------- images ---------------------------------- */
router.post("/profile/images", ...hotelOnly, loadOwnHotel, hotelController.uploadImages);
router.put("/profile/cover", ...hotelOnly, loadOwnHotel, hotelController.setCoverImage);
router.put("/profile/images/reorder", ...hotelOnly, loadOwnHotel, hotelController.reorderImages);
router.delete(
  "/profile/images/:imageId",
  ...hotelOnly,
  loadOwnHotel,
  validate([objectId("imageId")]),
  hotelController.deleteImage
);

/* --------------------------------- amenities --------------------------------- */
router.put("/profile/amenities", ...hotelOnly, loadOwnHotel, hotelController.setAmenities);

/* --------------------------------- policies --------------------------------- */
router.put("/policies", ...hotelOnly, loadOwnHotel, validate(updatePoliciesRules), hotelController.updatePolicies);

/* ----------------------------- listing lifecycle ----------------------------- */
router.get("/listing/status", ...hotelOnly, loadOwnHotel, hotelController.getListingStatus);
router.get("/listing/readiness", ...hotelOnly, loadOwnHotel, hotelController.getReadiness);
router.post("/listing/submit", ...hotelOnly, loadOwnHotel, validate(listingActionRules), hotelController.submitListing);
router.post("/listing/withdraw", ...hotelOnly, loadOwnHotel, validate(listingActionRules), hotelController.withdrawListing);
router.post("/listing/archive", ...hotelOnly, loadOwnHotel, validate(listingActionRules), hotelController.archiveListing);
router.post("/listing/restore", ...hotelOnly, loadOwnHotel, hotelController.restoreListing);

/* ---------------------------------- rooms ---------------------------------- */
router.get("/rooms", ...hotelOnly, hotelRoomController.getRooms);
router.post("/rooms", ...hotelOnly, validate(createRoomRules), hotelRoomController.createRoom);

// Static segments must be declared before the `:roomId` routes below.
router.get(
  "/rooms/:roomId/availability",
  ...hotelOnly,
  loadOwnHotel,
  loadOwnRoom,
  hotelRoomController.getRoomAvailability
);
router.delete("/rooms/:roomId/availability", ...hotelOnly, loadOwnRoom, hotelRoomController.clearRoomAvailability);
router.put(
  "/rooms/:roomId/availability",
  ...hotelOnly,
  loadOwnRoom,
  validate(setAvailabilityRules),
  hotelAvailabilityController.setAvailability
);
router.put(
  "/rooms/:roomId/pricing",
  ...hotelOnly,
  loadOwnRoom,
  validate(pricingRules),
  hotelRoomController.updatePricing
);
router.put("/rooms/:roomId/amenities", ...hotelOnly, loadOwnRoom, hotelRoomController.setRoomAmenities);
router.post("/rooms/:roomId/images", ...hotelOnly, loadOwnRoom, hotelRoomController.uploadRoomImages);
router.delete(
  "/rooms/:roomId/images/:imageId",
  ...hotelOnly,
  loadOwnRoom,
  validate([objectId("imageId")]),
  hotelRoomController.deleteRoomImage
);
router.put(
  "/rooms/:roomId/images/:imageId/cover",
  ...hotelOnly,
  loadOwnRoom,
  validate([objectId("imageId")]),
  hotelRoomController.setRoomCover
);
router.post("/rooms/:roomId/restore", ...hotelOnly, loadOwnRoom, hotelRoomController.restoreRoom);

router.get("/rooms/:roomId", ...hotelOnly, loadOwnRoom, hotelRoomController.getRoom);
router.put("/rooms/:roomId", ...hotelOnly, loadOwnRoom, validate(updateRoomRules), hotelRoomController.updateRoom);
router.delete("/rooms/:roomId", ...hotelOnly, loadOwnRoom, hotelRoomController.deleteRoom);

/* ------------------------------- availability ------------------------------- */
router.get("/availability/calendar", ...hotelOnly, loadOwnHotel, hotelAvailabilityController.getCalendar);

router.get("/availability/blocks", ...hotelOnly, hotelAvailabilityController.getBlocks);
router.post("/availability/blocks", ...hotelOnly, validate(createBlockRules), hotelAvailabilityController.createBlock);
router.put(
  "/availability/blocks/:blockId",
  ...hotelOnly,
  loadOwnBlock,
  validate(createBlockRules),
  hotelAvailabilityController.updateBlock
);
router.put("/availability/blocks/:blockId/unblock", ...hotelOnly, loadOwnBlock, hotelAvailabilityController.unblock);
router.delete("/availability/blocks/:blockId", ...hotelOnly, loadOwnBlock, hotelAvailabilityController.deleteBlock);

/* ------------------------------ notifications ------------------------------ */
router.get("/notifications", ...hotelOnly, hotelController.getNotifications);
router.put("/notifications/:notificationId/read", ...hotelOnly, hotelController.markNotificationRead);

/* --------------------------- router-local error trap --------------------------- */
router.use(notFound);
router.use(errorHandler);

module.exports = router;
