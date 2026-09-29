/**
 * The chatbot's brain: RAG + tools + Hugging Face.
 * ------------------------------------------------------------------
 * For one user message the flow is:
 *
 *   1. Read the user's message (and the recent conversation).
 *   2. RAG  — find the knowledge document chunks that match the question.
 *   3. Decide whether live data is needed, and fetch it with a controlled tool.
 *   4. Send the system prompt + knowledge + live data + conversation to Hugging Face.
 *   5. Return the reply, plus which knowledge sources were used.
 *
 * Nothing here gives the model database access. The model can only ask for one of the
 * allowlisted tools in `tools.js`, and the backend decides what that tool is allowed
 * to do and for whom.
 */

const { retrieveContext, formatContext, formatSources } = require("../rag/retriever");
const {
  buildSystemPrompt,
  TOOL_SELECTION_INSTRUCTION,
  NO_INFORMATION_REPLY,
} = require("../rag/prompts");
const { chatCompletion, structuredCompletion, hasToken } = require("./hfClient");
const { runTool, describeTools, TOOLS } = require("./tools");
const { formatTakeoffDate } = require("../../utils/datetime");
const { MAX_HISTORY_MESSAGES, MAX_HISTORY_CHARS, MAX_MESSAGE_CHARS } = require("./config");

/** Shape the model must return when choosing a tool. */
const TOOL_DECISION_SCHEMA = {
  type: "object",
  properties: {
    need: { type: "string", enum: ["none", "tool", "signin"] },
    tool: { type: "string" },
    args: { type: "object", additionalProperties: true },
  },
  required: ["need"],
  additionalProperties: false,
};

/** Live-data intent words, used to decide whether to even ask the model. */
const LIVE_DATA_WORDS = [
  "book", "booked", "booking", "bookings", "reservation", "reserve",
  "my trip", "my tickets", "ticket", "tickets",
  "available", "availability", "seats", "seat", "empty",
  "price", "prices", "fare", "cost", "how much",
  "buses", "bus", "vehicles", "vehicle", "jeep", "4x4", "scorpio",
  "route", "routes", "schedule", "schedules", "timing", "when",
  "payment", "paid", "refund", "refunded", "status",
  "hotel", "hotels", "villa", "villas", "stay", "room", "rooms",
  "cancel", "cancellation", "confirm",
];

/** Questions about the user's own account need a signed-in user. */
const PERSONAL_WORDS = [
  "my booking", "my bookings", "my ticket", "my tickets", "my trip", "my trips",
  "my payment", "my refund", "my reservation", "my reservations",
  "i booked", "i reserved", "i paid", "show me my", "list my",
  "my order", "my history",
];

/** True when the message plausibly needs live data from the database. */
const mentionsLiveData = (text) => {
  const lower = String(text || "").toLowerCase();
  return LIVE_DATA_WORDS.some((word) => lower.includes(word));
};

/** True when the message is about the user's own account. */
const mentionsPersonalData = (text) => {
  const lower = String(text || "").toLowerCase();
  return PERSONAL_WORDS.some((word) => lower.includes(word));
};

/**
 * Validate and cap the conversation sent by the frontend.
 * An untrusted client can send anything, so every field is checked here.
 *
 * @param {unknown} raw
 * @returns {Array<{role: string, content: string}>}
 */
const sanitizeHistory = (raw) => {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry) => entry && typeof entry === "object")
    // Any role other than user/assistant is DROPPED, not rewritten to "user". The
    // conversation arrives from an untrusted client, so a forged `system` or `tool`
    // turn must never reach the model.
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((entry) => entry.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES); // most recent turns only
};

/** Keep the total conversation size bounded. */
const capHistoryChars = (history) => {
  let total = 0;
  const kept = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    total += history[i].content.length;
    if (total > MAX_HISTORY_CHARS) break;
    kept.unshift(history[i]);
  }
  return kept;
};

/** Render tool output as a readable, compact block for the model. */
const formatToolResults = (results) => {
  const lines = [];
  for (const [name, result] of Object.entries(results)) {
    if (result.ok) {
      lines.push(`${name} result:\n${JSON.stringify(result.data)}`);
    } else {
      lines.push(`${name} could not run: ${result.error}`);
    }
  }
  return lines.join("\n\n");
};

/**
 * Ask the model whether a tool is needed, and run at most one.
 *
 * @returns {Promise<{results: object, requiresSignIn: boolean, usedTool: string|null}>}
 */
const resolveLiveData = async ({ message, history, ctx }) => {
  const empty = { results: {}, requiresSignIn: false, usedTool: null };

  if (!mentionsLiveData(message)) return empty;

  // A personal question from a signed-out user is answered with "sign in first"
  // without spending a model call.
  if (mentionsPersonalData(message) && !ctx.user?._id) {
    return { ...empty, requiresSignIn: true };
  }

  const recent = history.slice(-4).map((entry) => `${entry.role}: ${entry.content}`).join("\n");
  const toolList = describeTools({ isAuthenticated: Boolean(ctx.user?._id) });
  const instruction = [
    TOOL_SELECTION_INSTRUCTION.replace("{toolList}", toolList),
    "",
    "Recent conversation:",
    recent || "(none)",
    "",
    "User's latest message:",
    message,
  ].join("\n");

  const decision = await structuredCompletion(instruction, { jsonSchema: TOOL_DECISION_SCHEMA });
  if (!decision || decision.need === "none") return empty;

  if (decision.need === "signin") return { ...empty, requiresSignIn: true };

  const name = typeof decision.tool === "string" ? decision.tool : "";
  if (!Object.prototype.hasOwnProperty.call(TOOLS, name)) return empty;

  const result = await runTool(name, decision.args || {}, ctx);
  if (!result.ok && /signed in/i.test(result.error || "")) {
    return { ...empty, requiresSignIn: true };
  }

  return { results: { [name]: result }, requiresSignIn: false, usedTool: name };
};

/** Reply used when the user asks something that needs their account but is signed out. */
const SIGN_IN_REPLY =
  "I can look that up for you, but you need to be signed in first. " +
  "Please sign in to TickXplore and ask me again.";

/** Reply used when nothing could answer the question. */
const FALLBACK_REPLY = NO_INFORMATION_REPLY;

/**
 * Answer one user message.
 *
 * @param {object} params
 * @param {string} params.message The user's latest message.
 * @param {Array} [params.conversation] Earlier turns from the frontend.
 * @param {object} [params.ctx] `{ user }` from the verified JWT, if signed in.
 * @param {boolean} [params.confirm] The user confirmed a pending action.
 * @param {object} [params.action] The action being confirmed.
 * @returns {Promise<{reply: string, sources: string[], tool: string|null, suggestions: string[]}>}
 */
const answerQuestion = async ({ message, conversation, ctx = {}, confirm, action }) => {
  const cleanMessage = String(message || "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!cleanMessage) {
    return { reply: "Please type a question.", sources: [], tool: null, suggestions: [] };
  }

  // No token configured: answer from retrieved knowledge is impossible, so be honest.
  if (!hasToken()) {
    return {
      reply:
        "The TickXplore assistant is not configured on the server right now. " +
        "Please try again shortly or contact TickXplore support.",
      sources: [],
      tool: null,
      suggestions: [],
    };
  }

  const history = capHistoryChars(sanitizeHistory(conversation));

  // A confirmed action runs first, and its result becomes context for the reply.
  let actionResult = null;
  if (confirm && action && action.tool) {
    const outcome = await runTool(action.tool, action.args || {}, ctx);
    actionResult = { tool: action.tool, ...outcome };
  }

  // Step 1 — retrieve relevant knowledge (RAG).
  const retrieval = await retrieveContext(cleanMessage);
  const knowledge = formatContext(retrieval.chunks);

  // Step 2 — gather live data if it is needed.
  const { results, requiresSignIn } = await resolveLiveData({ message: cleanMessage, history, ctx });

  if (requiresSignIn && !actionResult) {
    return {
      reply: SIGN_IN_REPLY,
      sources: [],
      tool: null,
      suggestions: [],
    };
  }

  // Nothing retrieved and no tool data: do not call the model and invite a guess.
  if (!knowledge && Object.keys(results).length === 0 && !actionResult) {
    return { reply: FALLBACK_REPLY, sources: [], tool: null, suggestions: [] };
  }

  // Step 3 — build the prompt and ask the model.
  const toolResults = [
    formatToolResults(results),
    actionResult
      ? `Result of the action the user just confirmed (${actionResult.tool}):\n${
          actionResult.ok ? JSON.stringify(actionResult.data) : actionResult.error
        }`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt({
    knowledge,
    toolResults,
    today: formatTakeoffDate(new Date()),
    isAuthenticated: Boolean(ctx.user?._id),
  });

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: cleanMessage },
  ];

  const reply = await chatCompletion(messages);

  return {
    reply,
    sources: formatSources(retrieval.chunks),
    tool: Object.keys(results)[0] || actionResult?.tool || null,
    suggestions: [],
  };
};

module.exports = {
  answerQuestion,
  sanitizeHistory,
  mentionsLiveData,
  mentionsPersonalData,
  SIGN_IN_REPLY,
  FALLBACK_REPLY,
  LIVE_DATA_WORDS,
  PERSONAL_WORDS,
};
