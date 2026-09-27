const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const Admin = require("../models/Admin");
const Hotel = require("../models/Hotel");

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: Token missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user =
      (await User.findById(decoded._id)) ||
      (await Vendor.findById(decoded._id)) ||
      (await Admin.findById(decoded._id)) ||
      (await Hotel.findById(decoded._id));


    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("JWT Error:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ message: "Forbidden: Access denied" });
    }
    next();
  };
};

module.exports = {
  protect,
  authorize,
};
