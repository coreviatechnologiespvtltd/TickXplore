/**
 * Canonical amenity catalog for hotels and room types.
 * ------------------------------------------------------------------
 * This static list is the single source of truth used for:
 *   - backend validation (`utils/hotelAmenities.js`)
 *   - the catalog seeded into MongoDB (`models/Amenity.js`)
 *   - the public filter checklist consumed by the customer Stay page
 *
 * Amenities are stored on hotels/rooms as `key` slugs (never free text) so the
 * customer accommodation page can filter with a single indexed
 * `{ amenities: { $in: keys } }` query.
 *
 * `label` values intentionally match the wording already used by the frontend
 * filter checklist in `Front_End/src/data/accommodations.ts`.
 */

/** @type {Array<{key:string,label:string,category:string,icon:string,scope:string[]}>} */
const HOTEL_AMENITIES = [
  /* ----------------------------- connectivity ---------------------------- */
  {
    key: "wifi",
    label: "Free Wi-Fi",
    category: "connectivity",
    icon: "FaWifi",
    scope: ["hotel", "room"],
  },
  {
    key: "workspace",
    label: "Workspace / Desk",
    category: "connectivity",
    icon: "FaLaptopCode",
    scope: ["hotel", "room"],
  },

  /* ------------------------------- parking ------------------------------- */
  {
    key: "parking",
    label: "Parking",
    category: "parking",
    icon: "FaParking",
    scope: ["hotel"],
  },
  {
    key: "free_parking",
    label: "Free Parking",
    category: "parking",
    icon: "FaParking",
    scope: ["hotel"],
  },
  {
    key: "valet_parking",
    label: "Valet Parking",
    category: "parking",
    icon: "FaCar",
    scope: ["hotel"],
  },
  {
    key: "ev_charging",
    label: "EV Charging",
    category: "parking",
    icon: "FaCarBattery",
    scope: ["hotel"],
  },

  /* ------------------------------- climate ------------------------------- */
  {
    key: "air_conditioning",
    label: "Air Conditioning",
    category: "climate",
    icon: "FaSnowflake",
    scope: ["room"],
  },
  {
    key: "heating",
    label: "Heating",
    category: "climate",
    icon: "FaTemperatureHigh",
    scope: ["room"],
  },
  {
    key: "air_purification",
    label: "Air Purification",
    category: "climate",
    icon: "FaWind",
    scope: ["room"],
  },

  /* -------------------------------- food -------------------------------- */
  {
    key: "breakfast_included",
    label: "Breakfast Included",
    category: "food",
    icon: "FaMugHot",
    scope: ["hotel"],
  },
  {
    key: "breakfast_optional",
    label: "Breakfast Available",
    category: "food",
    icon: "FaMugHot",
    scope: ["hotel"],
  },
  {
    key: "restaurant",
    label: "Restaurant",
    category: "food",
    icon: "FaUtensils",
    scope: ["hotel"],
  },
  {
    key: "room_service",
    label: "Room Service",
    category: "food",
    icon: "FaConciergeBell",
    scope: ["hotel", "room"],
  },
  {
    key: "bar",
    label: "Bar / Lounge",
    category: "food",
    icon: "FaCocktail",
    scope: ["hotel"],
  },
  {
    key: "minibar",
    label: "Mini Bar",
    category: "food",
    icon: "FaWineGlass",
    scope: ["room"],
  },
  {
    key: "coffee_maker",
    label: "Coffee Maker",
    category: "food",
    icon: "FaCoffee",
    scope: ["room"],
  },
  {
    key: "kitchen",
    label: "Kitchen",
    category: "food",
    icon: "FaUtensils",
    scope: ["hotel", "room"],
  },
  {
    key: "kitchenette",
    label: "Kitchenette",
    category: "food",
    icon: "FaMugSaucer",
    scope: ["room"],
  },
  {
    key: "bbq",
    label: "BBQ Facility",
    category: "food",
    icon: "FaFire",
    scope: ["hotel"],
  },

  /* ------------------------------ bathroom ------------------------------ */
  {
    key: "hot_water",
    label: "Hot Water",
    category: "bathroom",
    icon: "FaShower",
    scope: ["hotel", "room"],
  },
  {
    key: "bathtub",
    label: "Bathtub",
    category: "bathroom",
    icon: "FaBath",
    scope: ["room"],
  },
  {
    key: "shower",
    label: "Shower",
    category: "bathroom",
    icon: "FaShower",
    scope: ["room"],
  },
  {
    key: "hair_dryer",
    label: "Hair Dryer",
    category: "bathroom",
    icon: "FaWind",
    scope: ["room"],
  },
  {
    key: "toiletries",
    label: "Free Toiletries",
    category: "bathroom",
    icon: "FaSoap",
    scope: ["room"],
  },

  /* ------------------------------- bedroom ------------------------------ */
  {
    key: "tv",
    label: "TV",
    category: "bedroom",
    icon: "FaTv",
    scope: ["room"],
  },
  {
    key: "balcony",
    label: "Balcony",
    category: "bedroom",
    icon: "FaDoorOpen",
    scope: ["room"],
  },
  {
    key: "safe",
    label: "In-room Safe",
    category: "bedroom",
    icon: "FaLock",
    scope: ["room"],
  },
  {
    key: "wardrobe",
    label: "Wardrobe",
    category: "bedroom",
    icon: "FaHanger",
    scope: ["room"],
  },
  {
    key: "sofa_bed",
    label: "Sofa Bed",
    category: "bedroom",
    icon: "FaCouch",
    scope: ["room"],
  },
  {
    key: "telephone",
    label: "Telephone",
    category: "bedroom",
    icon: "FaPhoneAlt",
    scope: ["room"],
  },

  /* ----------------------------- facilities ----------------------------- */
  {
    key: "laundry",
    label: "Laundry Service",
    category: "facilities",
    icon: "FaTshirt",
    scope: ["hotel"],
  },
  {
    key: "elevator",
    label: "Elevator / Lift",
    category: "facilities",
    icon: "FaArrowsAlt",
    scope: ["hotel"],
  },
  {
    key: "power_backup",
    label: "Power Backup",
    category: "facilities",
    icon: "FaBolt",
    scope: ["hotel", "room"],
  },
  {
    key: "airport_shuttle",
    label: "Airport Shuttle",
    category: "facilities",
    icon: "FaShuttleVan",
    scope: ["hotel"],
  },
  {
    key: "pickup_drop",
    label: "Pickup & Drop",
    category: "facilities",
    icon: "FaCarSide",
    scope: ["hotel"],
  },
  {
    key: "gym",
    label: "Fitness Centre / Gym",
    category: "facilities",
    icon: "FaDumbbell",
    scope: ["hotel"],
  },
  {
    key: "sauna",
    label: "Sauna",
    category: "facilities",
    icon: "FaHotTub",
    scope: ["hotel"],
  },
  {
    key: "spa",
    label: "Spa",
    category: "facilities",
    icon: "FaSpa",
    scope: ["hotel"],
  },
  {
    key: "front_desk_24x7",
    label: "24/7 Front Desk",
    category: "facilities",
    icon: "FaConciergeBell",
    scope: ["hotel"],
  },
  {
    key: "luggage_storage",
    label: "Luggage Storage",
    category: "facilities",
    icon: "FaSuitcase",
    scope: ["hotel"],
  },
  {
    key: "meeting_room",
    label: "Meeting Room",
    category: "facilities",
    icon: "FaUsers",
    scope: ["hotel"],
  },

  /* ------------------------------- family ------------------------------- */
  {
    key: "kids_club",
    label: "Kids Club",
    category: "family",
    icon: "FaChild",
    scope: ["hotel"],
  },
  {
    key: "family_rooms",
    label: "Family Rooms",
    category: "family",
    icon: "FaUsers",
    scope: ["hotel", "room"],
  },
  {
    key: "baby_cot",
    label: "Baby Cot (on request)",
    category: "family",
    icon: "FaBaby",
    scope: ["room"],
  },
  {
    key: "kids_menu",
    label: "Kids Menu",
    category: "family",
    icon: "FaIceCream",
    scope: ["hotel"],
  },

  /* ------------------------------- outdoor ------------------------------ */
  {
    key: "swimming_pool",
    label: "Swimming Pool",
    category: "outdoor",
    icon: "FaSwimmingPool",
    scope: ["hotel"],
  },
  {
    key: "garden",
    label: "Garden",
    category: "outdoor",
    icon: "FaTree",
    scope: ["hotel"],
  },
  {
    key: "mountain_view",
    label: "Mountain View",
    category: "outdoor",
    icon: "FaMountain",
    scope: ["hotel", "room"],
  },
  {
    key: "sea_view",
    label: "Sea View",
    category: "outdoor",
    icon: "FaWater",
    scope: ["hotel", "room"],
  },
  {
    key: "city_view",
    label: "City View",
    category: "outdoor",
    icon: "FaCity",
    scope: ["hotel", "room"],
  },
  {
    key: "garden_view",
    label: "Garden View",
    category: "outdoor",
    icon: "FaSeedling",
    scope: ["hotel", "room"],
  },

  /* ------------------------------- policy ------------------------------- */
  {
    key: "pet_friendly",
    label: "Pet Friendly",
    category: "policy",
    icon: "FaPaw",
    scope: ["hotel"],
  },
  {
    key: "wheelchair_accessible",
    label: "Wheelchair Accessible",
    category: "policy",
    icon: "FaWheelchair",
    scope: ["hotel"],
  },
];

module.exports = { HOTEL_AMENITIES };
