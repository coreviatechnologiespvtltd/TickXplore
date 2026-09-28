const { validationResult } = require("express-validator");

/**
 * express-validator runner.
 * ------------------------------------------------------------------
 * `express-validator` is already a dependency of this project; the hotel APIs are
 * the first to use it. Invalid input is answered with 400 and a field-keyed
 * error list so the dashboard can highlight the offending inputs:
 *
 *   { success: false, message: "Validation failed",
 *     errors: [{ field: "pricing.basePrice", message: "..." }] }
 *
 * @param {import("express-validator").ValidationChain[]} chains
 */
const validate = (chains = []) => async (req, res, next) => {
  try {
    await Promise.all(chains.map((chain) => chain.run(req)));
  } catch (error) {
    return next(error);
  }

  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array({ onlyFirstError: true }).map((error) => ({
    field: error.path ?? error.param ?? error.type,
    message: error.msg,
    location: error.location,
  }));

  return res.status(400).json({ success: false, message: "Validation failed", errors });
};

module.exports = { validate };
