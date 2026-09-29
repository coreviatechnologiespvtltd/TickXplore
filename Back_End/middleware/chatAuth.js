/**
 * Optional authentication for the chatbot.
 * ------------------------------------------------------------------
 * The chatbot is open to everyone: visitors can ask general questions about how
 * TickXplore works without an account. Personal tools are the ones that require a
 * user, and those are gated inside the tool layer, not here.
 *
 * This middleware is deliberately forgiving — an absent or invalid token means
 * "signed out", not "rejected". It reads the same JWT as `middleware/verifyToken.js`
 * and only extracts the identity; no database work is done, because every personal
 * tool already scopes its query to the id in the token.
 */

const jwt = require("jsonwebtoken");

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    // No token supplied: continue as a signed-out visitor.
    return next();
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Only these fields are carried forward. Nothing model-supplied is trusted.
    req.user = { _id: decoded._id, role: decoded.role, email: decoded.email };
    return next();
  } catch {
    // An expired or invalid token is treated as signed out rather than an error,
    // so the visitor can still ask general questions.
    return next();
  }
};

module.exports = { optionalAuth };
