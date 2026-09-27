const express = require("express");
const router = express.Router();

const publicHotelController = require("../controllers/publicHotelController");
const { validate } = require("../middleware/validation");
const { notFound, errorHandler } = require("../utils/http");
const { publicListRules, publicAvailabilityRules } = require("../validators/hotelValidators");

/**
 * Public accommodation API — mounted at `/api/hotels`.
 *
 * No authentication, and no way to reach anything that has not been approved:
 * every handler filters on `listingStatus: "published"` with a
 * `publishedSnapshot`, so drafts, pending, rejected, suspended and archived
 * listings are invisible here. Availability is the one exception: it is read
 * live from inventory/blocks so a closed date is never advertised as bookable.
 */

/* Static segments first — these would otherwise be captured by `/:id`. */
router.get("/amenities", publicHotelController.getAmenities);
router.get("/meta/filters", publicHotelController.getFilterMeta);

router.get("/", validate(publicListRules), publicHotelController.listHotels);

router.get(
  "/:id/availability",
  validate(publicAvailabilityRules),
  publicHotelController.getHotelAvailability
);
router.get("/:id/rooms", publicHotelController.getHotelRooms);
router.get("/:id", publicHotelController.getHotel);

router.use(notFound);
router.use(errorHandler);

module.exports = router;
