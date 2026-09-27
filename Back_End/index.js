const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// Initialize Express App
const app = express();

// Middleware Configuration
app.use(cors({
  origin: "http://localhost:5173", 
  credentials: true               
}));
app.use(morgan("dev"));
app.use(helmet({ 
  crossOriginResourcePolicy: { policy: "cross-origin" }, 
  crossOriginEmbedderPolicy: false 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Enable File Upload Handling
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  abortOnLimit: true,
  responseOnLimit: "File size limit exceeded (Max: 5MB)",
}));

// Static File Serving for Uploaded Images
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use("/uploads", express.static(uploadsDir));

// MongoDB Connection
const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/tickxplore";
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log(" MongoDB Connected Successfully"))
  .catch((err) => {
    console.error(" MongoDB Connection Error:", err.message);
    process.exit(1);
  });

// Import Routes
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const vendorRoutes = require("./routes/vendorRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const busRoutes = require("./routes/busRoutes");
const userRoutes = require('./routes/userRoutes');
const homepageRoutes = require("./routes/homepageRoutes");
const touristAreaRoutes = require("./routes/touristAreaRoutes");
const paymentRoutes = require("./routes/payment");
const adminDashboardRoutes = require("./routes/adminDashboardRoutes");
const refundRoutes = require("./routes/refundRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const chatbotRoutes = require('./routes/chatbotRoutes');
const reservationRoutes = require("./routes/reservationRoutes");
const notificationRoutes = require('./routes/notificationRoutes');
const hotelRoutes = require("./routes/hotelRoutes");
const publicHotelRoutes = require("./routes/publicHotelRoutes");
const adminHotelRoutes = require("./routes/adminHotelRoutes");
const { seedAmenityCatalog } = require("./utils/hotelAmenities");

// Mirror the static amenity catalog into MongoDB once the connection is open.
// Idempotent: existing entries are updated in place and the boot is never blocked.
mongoose.connection.once("open", async () => {
  const seedResult = await seedAmenityCatalog();
  if (seedResult.ok) {
    console.log(` Amenity catalog ready (${seedResult.count} entries)`);
  }
});

// Hotel dashboard + public accommodation APIs
//
// `/admin/hotels` is mounted BEFORE the generic `/admin` router on purpose:
// `adminRoutes` declares `router.get("/:id")`, so registering it first would
// swallow `GET /admin/hotels` as an admin lookup by the id "hotels".
app.use("/api/hotel", hotelRoutes);
app.use("/hotel", hotelRoutes);
app.use("/api/hotels", publicHotelRoutes);
app.use("/admin/hotels", adminHotelRoutes);

// API Routes
app.use("/auth", authRoutes);
app.use("/admin", authRoutes);
app.use("/vendor", authRoutes);
app.use("/hotel", authRoutes);
app.use("/api/users", userRoutes);
app.use("/admin", adminRoutes);
app.use("/vendor", vendorRoutes);
app.use("/users", userRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/buses", busRoutes);
app.use("/api", homepageRoutes);
app.use("/api/tourist-areas", touristAreaRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/refunds", refundRoutes);
app.use("/admin/dashboard", adminDashboardRoutes);
app.use("/api", authRoutes);
app.use("/api/bookings", bookingRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use("/api/reservations", reservationRoutes);
app.use('/api/notifications', notificationRoutes);

// Health Check Route
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Server is running!", timestamp: new Date() });
});

// Test Image Route
app.get("/test-image", (req, res) => {
  res.send(`<img src="http://localhost:3001/uploads/sample.jpg" alt="Test Image"/>`);
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(" Server Error:", err.stack);
  res.status(500).json({ error: "An unexpected error occurred.", details: err.message });
});

// Graceful Shutdown
const shutdown = async () => {
  console.log("\n Closing MongoDB Connection...");
  await mongoose.connection.close();
  console.log(" MongoDB Connection Closed. Server Shutting Down.");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
