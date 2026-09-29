/**
 * Chatbot HTTP controller — `POST /api/chatbot`.
 * ------------------------------------------------------------------
 * This is the only entry point the browser uses. It does four things and nothing
 * more: validate the request, identify the user from their JWT, hand the work to
 * the orchestrator, and return a clean JSON reply.
 *
 * The Hugging Face token is never touched here, and never leaves the server.
 */

const { answerQuestion, sanitizeHistory, SIGN_IN_REPLY, FALLBACK_REPLY } = require("../utils/chat/orchestrator");
const { ChatError } = require("../utils/chat/hfClient");
const { STARTER_QUESTIONS } = require("../utils/chat/tools");
const { createActionToken, verifyActionToken, describeAction, CONFIRMABLE } = require("../utils/chat/confirmation");
const { MAX_MESSAGE_CHARS, MAX_HISTORY_MESSAGES } = require("../utils/chat/config");

/**
 * POST /api/chatbot
 *
 * Body: `{ message: string, conversation?: Array<{role, content}>, confirm?: boolean, actionToken?: string }`
 */
const chat = async (req, res) => {
  try {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ success: false, message: "Please type a message." });
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({
        success: false,
        message: `Your message is too long. Please keep it under ${MAX_MESSAGE_CHARS} characters.`,
      });
    }
    if (body.conversation !== undefined && !Array.isArray(body.conversation)) {
      return res.status(400).json({ success: false, message: "Invalid conversation." });
    }

    // The user is identified from the verified JWT by `optionalAuth` — never from
    // anything in the request body. The chatbot therefore cannot be asked to act as
    // another person.
    const ctx = { user: req.user || null };
    const conversation = sanitizeHistory(body.conversation).slice(-MAX_HISTORY_MESSAGES);

    // --- Confirming a pending action -------------------------------------
    if (body.confirm === true) {
      const verified = verifyActionToken(body.actionToken, ctx);

      if (!verified.ok) {
        return res.status(400).json({ success: false, message: verified.error });
      }

      const result = await answerQuestion({
        message,
        conversation,
        ctx,
        confirm: true,
        action: verified.action,
      });

      return res.status(200).json({
        success: true,
        reply: result.reply,
        sources: result.sources,
        tool: result.tool,
        suggestions: [],
      });
    }

    // --- Proposing an action that needs confirmation ----------------------
    // The orchestrator may decide a destructive action is wanted. Rather than
    // running it, we return a confirmation request for the UI to show.
    const proposal = await proposeAction({ message, conversation, ctx });
    if (proposal) {
      return res.status(200).json({
        success: true,
        reply: proposal.reply,
        sources: [],
        tool: proposal.tool,
        suggestions: [],
        pendingAction: proposal.pendingAction,
      });
    }

    // --- Normal question ---------------------------------------------------
    const result = await answerQuestion({ message, conversation, ctx });

    return res.status(200).json({
      success: true,
      reply: result.reply,
      sources: result.sources,
      tool: result.tool,
      suggestions: [],
    });
  } catch (error) {
    // `ChatError` already carries a message that is safe to show the user.
    if (error instanceof ChatError) {
      const status = error.kind === "config" ? 503 : 502;
      return res.status(status).json({ success: false, message: error.message, code: error.kind });
    }

    // Anything else is logged server-side and hidden from the user, so no stack
    // trace, database message or internal path can leak.
    console.error("[chatbot] unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again.",
    });
  }
};

/**
 * Detect a request to change data and turn it into a confirmation prompt.
 *
 * The intent is matched on the message text rather than by the model, so a
 * confirmation is never produced by model output alone. Any tool the model names is
 * ignored here — this function only recognises the two actions that require
 * confirmation, and only when the user has not confirmed yet.
 *
 * @returns {Promise<null | {reply: string, tool: string, pendingAction: object}>}
 */
const proposeAction = async ({ message, conversation, ctx }) => {
  if (!ctx.user?._id) return null;

  const lower = message.toLowerCase();
  const askedEarlier = conversation.some((entry) => entry.role === "user" && CONFIRMABLE.has(entry.content));

  const wantsCancel =
    /\b(cancel|cancellation)\b/.test(lower) && /\b(my|the|this|a)?\s*booking/.test(lower);
  const wantsRefund =
    /\brefund\b/.test(lower) && /\b(request|apply|want|need|get|process)\b/.test(lower);

  if (!wantsCancel && !wantsRefund) return null;

  const tool = wantsCancel ? "cancel_booking" : "request_refund";

  // A cancel needs a target booking. Without one in the conversation we ask for it
  // rather than guessing which booking the user means.
  const bookingNumber = (message.match(/\b\d{8}\b/) || [])[0];
  const bookingId = (message.match(/\b[a-f\d]{24}\b/i) || [])[0];

  if (wantsCancel && !bookingNumber && !bookingId && !askedEarlier) {
    return {
      reply:
        "I can cancel a booking for you. Please tell me the booking number — you can find it on the My Bookings page — and I'll confirm the details before anything is cancelled.",
      tool,
      pendingAction: null,
    };
  }

  // Ask for a reason before submitting a refund request.
  if (wantsRefund && !askedEarlier) {
    return {
      reply: "Sure — I'll request a refund. Could you tell me the reason for the refund, and the booking number?",
      tool,
      pendingAction: null,
    };
  }

  const args = {};
  if (bookingNumber) args.bookingNumber = bookingNumber;
  if (bookingId) args.bookingId = bookingId;

  // The target is resolved server-side and always scoped to the signed-in user.
  const { lookupActionTarget } = require("../utils/chat/tools");
  let target;
  try {
    target = await lookupActionTarget({ tool, args }, ctx);
  } catch (error) {
    return { reply: error.message, tool, pendingAction: null };
  }

  const { token, expiresAt } = createActionToken({
    tool,
    args: { bookingId: target.bookingId },
    userId: ctx.user._id,
  });

  const summary = describeAction(tool, target);
  return {
    reply:
      `I found booking ${target.bookingNumber} — ${target.trip}` +
      (target.seats?.length ? `, seat${target.seats.length > 1 ? "s" : ""} ${target.seats.join(", ")}` : "") +
      `. Do you want me to ${summary}? This ${tool === "cancel_booking" ? "cannot be undone" : "will be reviewed by the admin team"}.`,
    tool,
    pendingAction: {
      tool,
      label: `Yes, ${summary}`,
      token,
      expiresAt,
    },
  };
};

/** GET /api/chatbot/starters — the suggestion chips shown before the first message. */
const getStarters = async (req, res) => {
  // Only the suggestion chips are returned. The internal tool names are not part of
  // the chat contract, so there is no reason to publish them to the browser.
  res.status(200).json({
    success: true,
    suggestions: STARTER_QUESTIONS,
  });
};

module.exports = { chat, getStarters, SIGN_IN_REPLY, FALLBACK_REPLY };
