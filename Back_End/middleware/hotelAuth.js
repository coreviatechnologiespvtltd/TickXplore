const { protect, authorize } = require("./authMiddleware");
const Hotel = require("../models/Hotel");
const RoomType = require("../models/RoomType");
const AvailabilityBlock = require("../models/AvailabilityBlock");
const { ApiError } = require("../utils/http");
const { isValidObjectId } = require("../utils/hotelAvailability");

/**
 * Hotel-dashboard authentication and ownership helpers.
 * ------------------------------------------------------------------
 * Every hotel route is scoped by `req.user._id`. Resources belonging to another
 * hotel are answered with **404, not 403**, so a hotel cannot probe for the
 * existence of other hotels' rooms, blocks or IDs.
 */

/** Account must be active (admin activation gate) as well as role-checked. */
const requireActiveAccount = async (req, res, next) => {
  if (!req.user?.isActive) {
    return next(
      new ApiError(403, "Your hotel account is not active yet. Please wait for admin approval.")
    );
  }
  next();
};

/** Route guard: valid JWT, role `hotel`, account activated. */
const hotelOnly = [protect, authorize("hotel"), requireActiveAccount];

/** Attach the authenticated hotel document as `req.hotel`. */
const loadOwnHotel = async (req, res, next) => {
  try {
    const hotel = await Hotel.findById(req.user._id);
    if (!hotel) return next(new ApiError(404, "Hotel not found"));
    req.hotel = hotel;
    return next();
  } catch (error) {
    return next(error);
  }
};

/** Attach a room owned by the authenticated hotel as `req.room`. */
const loadOwnRoom = async (req, res, next) => {
  try {
    const { roomId } = req.params;
    if (!isValidObjectId(roomId)) return next(new ApiError(404, "Room not found"));

    const room = await RoomType.findOne({ _id: roomId, hotelId: req.user._id });
    if (!room) return next(new ApiError(404, "Room not found"));
    req.room = room;
    return next();
  } catch (error) {
    return next(error);
  }
};

/** Attach an availability block owned by the authenticated hotel as `req.block`. */
const loadOwnBlock = async (req, res, next) => {
  try {
    const { blockId } = req.params;
    if (!isValidObjectId(blockId)) return next(new ApiError(404, "Block not found"));

    const block = await AvailabilityBlock.findOne({ _id: blockId, hotelId: req.user._id });
    if (!block) return next(new ApiError(404, "Block not found"));
    req.block = block;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  hotelOnly,
  requireActiveAccount,
  loadOwnHotel,
  loadOwnRoom,
  loadOwnBlock,
};
