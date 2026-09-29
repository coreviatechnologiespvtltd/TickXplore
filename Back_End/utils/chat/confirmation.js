/**
 * Confirmation gate for actions that change data.
 * ------------------------------------------------------------------
 * Cancelling a booking or requesting a refund must never happen on a vague request
 * like "cancel my booking". Instead the chatbot proposes the action, and the backend
 * returns a `pendingAction` describing exactly what will happen. Only when the user
 * sends that back with `confirm: true` does the action execute.
 *
 * The pending action carries a short-lived signed token. That stops a user from
 * hand-crafting a request that confirms an action they never actually saw, and it
 * means a confirmation for one action cannot be replayed for a different one.
 *
 * HMAC signing uses the existing `JWT_SECRET`; no new secret is introduced.
 */

const crypto = require("crypto");

/** How long a confirmation stays valid. */
const TTL_MS = 5 * 60 * 1000;

/** Actions that may be confirmed this way. Must match keys in `tools.js`. */
const CONFIRMABLE = new Set(["cancel_booking", "request_refund"]);

/** Human-readable summary of what will happen, shown in the confirmation prompt. */
const describeAction = (tool, data) => {
  const number = data?.bookingNumber || "this booking";
  if (tool === "cancel_booking") {
    const seats = Array.isArray(data?.freedSeats) && data.freedSeats.length
      ? ` and free seat${data.freedSeats.length > 1 ? "s" : ""} ${data.freedSeats.join(", ")}`
      : "";
    return `cancel booking ${number}${seats}`;
  }
  if (tool === "request_refund") {
    const amount = data?.refundAmount != null ? ` of ${data.refundAmount}` : "";
    return `request a refund${amount} for booking ${number}`;
  }
  return `perform ${tool}`;
};

/**
 * The signing key for confirmation tokens.
 *
 * This is the app's existing `JWT_SECRET`; no new secret is introduced. There is
 * deliberately NO hardcoded fallback: a known default would let anyone who read the
 * source forge a "yes, cancel this booking" token. A development placeholder is
 * generated per process instead, so tokens still work locally but cannot be forged
 * from a value published in the repository.
 */
const DEV_SECRET = process.env.NODE_ENV === "production" ? null : crypto.randomBytes(32).toString("hex");

const secret = () => {
  const key = process.env.JWT_SECRET;
  if (key) return key;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set to sign chatbot confirmation tokens.");
  }
  return DEV_SECRET;
};

/** Base64url without padding, so the token is URL-safe. */
const encode = (value) => Buffer.from(value).toString("base64url");

/**
 * Create a signed, expiring confirmation token for an action.
 *
 * @param {{tool: string, args: object, userId: string}} action
 * @returns {{token: string, expiresAt: string}}
 */
const createActionToken = ({ tool, args, userId }) => {
  const payload = {
    tool,
    args: args || {},
    userId: String(userId),
    exp: Date.now() + TTL_MS,
  };

  const encoded = encode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${signature}`, expiresAt: new Date(payload.exp).toISOString() };
};

/**
 * Verify a confirmation token.
 *
 * The signature, the expiry and the user id are all checked, so a token issued to
 * one signed-in user cannot be used by another.
 *
 * @param {string} token
 * @param {{userId: string}} ctx The current user, from the verified JWT.
 * @returns {{ok: true, action: object} | {ok: false, error: string}}
 */
const verifyActionToken = (token, ctx) => {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, error: "That confirmation is not valid. Please try again." };
  }

  const [encoded, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", secret())
    .update(encoded)
    .digest("base64url");

  // Length check first so timingSafeEqual is never called with mismatched sizes.
  if (
    !signature ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return { ok: false, error: "That confirmation is not valid. Please try again." };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    return { ok: false, error: "That confirmation is not valid. Please try again." };
  }

  if (!payload.exp || Date.now() > payload.exp) {
    return { ok: false, error: "That confirmation expired. Please ask me again." };
  }
  if (!CONFIRMABLE.has(payload.tool)) {
    return { ok: false, error: "That action cannot be confirmed." };
  }
  if (String(payload.userId) !== String(ctx.user?._id)) {
    return { ok: false, error: "That confirmation belongs to a different account." };
  }

  return { ok: true, action: { tool: payload.tool, args: payload.args } };
};

/**
 * Look up the booking an action refers to, so the confirmation prompt can name it.
 * The lookup is always scoped to the signed-in user.
 *
 * @param {{tool: string, args: object}} action
 * @param {{user: object}} ctx
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
const describeActionTarget = async (action, ctx) => {
  if (!ctx?.user?._id) {
    return { ok: false, error: "You need to be signed in to do that." };
  }
  if (!CONFIRMABLE.has(action?.tool)) {
    return { ok: false, error: "That action cannot be confirmed." };
  }

  try {
    // Read-only lookup of the target booking, scoped to the signed-in user.
    const { lookupActionTarget } = require("./tools");
    return { ok: true, data: await lookupActionTarget(action, ctx) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

module.exports = {
  createActionToken,
  verifyActionToken,
  describeAction,
  CONFIRMABLE,
  TTL_MS,
};
