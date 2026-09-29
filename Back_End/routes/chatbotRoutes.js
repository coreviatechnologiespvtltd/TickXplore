/**
 * Chatbot routes — mounted at `/api/chatbot`.
 * ------------------------------------------------------------------
 * The mount path in `index.js` is unchanged, so this replaces the previous
 * keyword-matching endpoint in place rather than adding a second chat API.
 *
 * `chatLimiter` is much stricter than the general API limiter: every message costs
 * money and an upstream API call, so an unauthenticated visitor should not be able
 * to burn the quota for everyone else.
 */

const express = require("express");
const rateLimit = require("express-rate-limit");

const { chat, getStarters } = require("../controllers/chatbotController");
const { optionalAuth } = require("../middleware/chatAuth");

const router = express.Router();

/** 20 messages per 10 minutes per IP. */
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "You are sending messages too quickly. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/** GET /api/chatbot/starters — suggestion chips for the chat window. */
router.get("/starters", getStarters);

/** POST /api/chatbot — send a message. */
router.post("/", chatLimiter, optionalAuth, chat);

module.exports = router;
