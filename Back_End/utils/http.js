/**
 * Small HTTP helpers shared by the hotel APIs.
 * ------------------------------------------------------------------
 * The rest of the codebase answers inline with `{ success: ... }` objects; these
 * helpers keep the new hotel modules terse without changing that convention.
 */

class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Client-safe message
   * @param {*} [details] Optional field errors / extra context
   */
  constructor(status, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

/** Wraps an async controller so rejected promises reach the router error handler. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, payload = {}, status = 200) =>
  res.status(status).json({ success: true, ...payload });

const fail = (res, status, message, details) =>
  res.status(status).json({
    success: false,
    message,
    ...(details !== undefined ? { details } : {}),
  });

/** Catch-all for unmatched routes inside a router. */
const notFound = (req, res) =>
  fail(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);

/**
 * Router-level error handler.
 * ------------------------------------------------------------------
 * Mounted inside the hotel routers so typed errors are translated to safe
 * responses and never fall through to the app-wide 500 handler (which would log
 * and mask them). Mongoose errors are mapped to the right 4xx status.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    return fail(res, err.status, err.message, err.details);
  }

  if (err.name === "ValidationError" && err.errors) {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return fail(res, 400, "Validation failed", errors);
  }

  if (err.name === "CastError") {
    return fail(res, 400, `Invalid value for "${err.path}"`);
  }

  if (err.name === "StrictModeError") {
    return fail(res, 400, `Unknown field(s): ${(err.message.match(/path: (.*)$/) || [])[1] || ""}`);
  }

  // Duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "value";
    const friendly = err.keyValue?.[field];
    return fail(
      res,
      409,
      friendly && typeof friendly === "string" && friendly.length > 3
        ? friendly
        : `Duplicate value for "${field}".`
    );
  }

  console.error("Hotel API Error:", err);
  return fail(res, 500, "An unexpected error occurred.", err.message);
};

module.exports = { ApiError, asyncHandler, ok, fail, notFound, errorHandler };
