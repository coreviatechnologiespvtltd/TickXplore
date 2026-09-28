const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");
const cookieParser = require("cookie-parser");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// Initialize Express App
const app = express();

// CORS Configuration - use CLIENT_URL from env
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
const allowedOrigins = clientUrl.split(",").map(origin => origin.trim());

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));
app.use(morgan("dev"));

// Helmet with CSP Configuration
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://accounts.google.com",
        "https://apis.google.com",
        "https://www.gstatic.com",
        "https://www.google.com",
        "https://js.stripe.com",
        "https://checkout.stripe.com",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://accounts.google.com",
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:",
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://tickxplore.firebasestorage.app",
        "https://lh3.googleusercontent.com",
        "https://firebasestorage.googleapis.com",
        "https://*.googleusercontent.com",
      ],
      connectSrc: [
        "'self'",
        "https://tickxplore.firebaseapp.com",
        "https://tickxplore-default-rtdb.firebaseio.com",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://www.googleapis.com",
        "https://khalti.com",
        "https://api.khalti.com",
      ],
      frameSrc: [
        "'self'",
        "https://accounts.google.com",
        "https://khalti.com",
        "https://checkout.stripe.com",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate Limiting - General API limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs for auth endpoints
  message: { error: "Too many authentication attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP rate limiter - stricter
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 OTP requests per windowMs
  message: { error: "Too many OTP requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", generalLimiter);
app.use("/auth/sign-in", authLimiter);
app.use("/auth/register", authLimiter);
app.use("/auth/forgot-password", otpLimiter);
app.use("/auth/verify-reset-otp", otpLimiter);
app.use("/auth/reset-password", authLimiter);
app.use("/auth/verify-otp", otpLimiter);
app.use("/auth/google-signin", authLimiter);
app.use("/api/verify-otp", otpLimiter);
app.use("/api/resend-otp", otpLimiter);

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

// API Routes
app.use("/auth", authRoutes);
app.use("/admin", authRoutes);
app.use("/vendor", authRoutes);
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
