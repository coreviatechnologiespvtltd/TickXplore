/**
 * Hugging Face chat client (server-side only).
 * ------------------------------------------------------------------
 * This is the only file in the project that talks to the chat model. It uses the
 * Hugging Face Inference Providers router with the OpenAI-compatible chat endpoint,
 * which is the current supported way to call chat models on Hugging Face.
 *
 * The `HUGGINGFACE_API_KEY` is read from the server environment and is never sent to
 * the browser, never logged, and never included in a response.
 *
 * Every failure is converted into a short, friendly message. The underlying status
 * and body are logged server-side only — they can contain internal details, so they
 * are never returned to the user.
 */

const axios = require("axios");

const { HF_CHAT_MODEL, HF_TIMEOUT_MS, HF_MAX_TOKENS } = require("./config");

/** The OpenAI-compatible chat completions endpoint on Hugging Face's router. */
const CHAT_URL = process.env.HF_ROUTER_URL || "https://router.huggingface.co/v1/chat/completions";

/** Thrown for problems the user should see as a friendly message. */
class ChatError extends Error {
  /**
   * @param {string} message Client-safe message.
   * @param {"config"|"timeout"|"unavailable"|"rate_limited"|"malformed"} kind
   * @param {number} [status]
   */
  constructor(message, kind, status) {
    super(message);
    this.name = "ChatError";
    this.kind = kind;
    this.status = status;
  }
}

/** True when a server-side token is configured. */
const hasToken = () => Boolean(process.env.HUGGINGFACE_API_KEY);

/** Map an upstream failure onto a safe message the chat window can display. */
const toChatError = (error) => {
  if (error instanceof ChatError) return error;

  if (axios.isCancel(error) || error.code === "ECONNABORTED") {
    return new ChatError(
      "The assistant took too long to respond. Please try again.",
      "timeout"
    );
  }

  const status = error.response?.status;

  if (status === 401 || status === 403) {
    console.error("[chat] Hugging Face rejected the server token (status %s).", status);
    return new ChatError(
      "The assistant is not configured correctly right now. Please try again later.",
      "config"
    );
  }

  if (status === 429) {
    return new ChatError(
      "The assistant is busy right now. Please try again in a moment.",
      "rate_limited",
      status
    );
  }

  // Hugging Face's router answers 402 when the free tier's per-window allowance is
  // used up, and 503 while a provider is scaling. Both are temporary from the
  // user's point of view, so they get the same "try again later" wording.
  if (status === 402 || status === 503) {
    console.error("[chat] Hugging Face quota or capacity reached (status %s).", status);
    return new ChatError(
      "The assistant is very busy right now. Please try again in a moment.",
      "rate_limited",
      status
    );
  }

  if (status === 404) {
    console.error("[chat] Model not found on Hugging Face: %s", HF_CHAT_MODEL);
    return new ChatError(
      "The assistant is temporarily unavailable. Please try again later.",
      "unavailable",
      status
    );
  }

  if (status >= 500) {
    console.error("[chat] Hugging Face is unavailable (status %s).", status);
    return new ChatError(
      "The assistant is temporarily unavailable. Please try again later.",
      "unavailable",
      status
    );
  }

  // Log the real cause server-side; return nothing specific to the client.
  console.error("[chat] Hugging Face request failed: %s", error.message);
  return new ChatError(
    "Something went wrong while reaching the assistant. Please try again.",
    "unavailable",
    status
  );
};

/**
 * Ask the chat model to continue a conversation.
 *
 * @param {Array<{role: string, content: string}>} messages OpenAI-style messages.
 * @param {object} [options]
 * @param {number} [options.temperature]
 * @param {number} [options.maxTokens]
 * @returns {Promise<string>} The assistant's reply text.
 * @throws {ChatError} With a client-safe message.
 */
const chatCompletion = async (messages, { temperature = 0.3, maxTokens = HF_MAX_TOKENS } = {}) => {
  if (!hasToken()) {
    console.error("[chat] HUGGINGFACE_API_KEY is not set on the server.");
    throw new ChatError(
      "The assistant is not configured right now. Please try again later.",
      "config"
    );
  }

  try {
    const response = await axios.post(
      CHAT_URL,
      {
        model: HF_CHAT_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        return_full_text: false,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: HF_TIMEOUT_MS,
        maxContentLength: 1024 * 1024,
      }
    );

    // The model may return several candidates; take the first.
    const reply = response.data?.choices?.[0]?.message?.content;

    if (typeof reply !== "string" || !reply.trim()) {
      console.error("[chat] Hugging Face returned an empty completion.");
      throw new ChatError(
        "The assistant did not return an answer. Please try again.",
        "malformed"
      );
    }

    return reply.trim();
  } catch (error) {
    throw toChatError(error);
  }
};

/**
 * Ask the model for a single JSON decision (used to pick a tool).
 * Anything that is not valid JSON of the expected shape becomes `null`, so a
 * confused model degrades to "no tool" rather than to an error.
 *
 * Not every model on the router supports every JSON mode. `meta-llama/...-Turbo`,
 * for example, answers HTTP 405 for `response_format: json_schema` but accepts
 * `json_object`. So we degrade: strict schema -> `json_object` -> no
 * `response_format` at all, and finally to `null` (no tool).
 *
 * @param {string} instruction The instruction to the model.
 * @param {object} [options]
 * @param {object} [options.jsonSchema] JSON schema describing the expected object.
 * @returns {Promise<object|null>}
 */
const structuredCompletion = async (instruction, { jsonSchema } = {}) => {
  if (!hasToken()) {
    throw new ChatError(
      "The assistant is not configured right now. Please try again later.",
      "config"
    );
  }

  const messages = [
    {
      role: "system",
      content:
        "You are a JSON-only router. Reply with a single valid JSON object and nothing " +
        "else. No prose, no markdown, no code fences.",
    },
    { role: "user", content: instruction },
  ];

  /** @type {Array<object|undefined>} One attempt per JSON mode, best first. */
  const attempts = [];
  if (jsonSchema) {
    attempts.push({
      type: "json_schema",
      json_schema: { name: "tool_decision", strict: true, schema: jsonSchema },
    });
    attempts.push({ type: "json_object" });
  }
  attempts.push(undefined); // no response_format: the prompt alone is enough

  let lastError = null;

  for (const responseFormat of attempts) {
    const body = {
      model: HF_CHAT_MODEL,
      messages,
      temperature: 0,
      max_tokens: 200,
    };
    if (responseFormat) body.response_format = responseFormat;

    try {
      const response = await axios.post(CHAT_URL, body, {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: HF_TIMEOUT_MS,
      });

      const raw = response.data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") return null;

      // Models sometimes wrap JSON in prose or code fences despite instructions.
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = fenced ? fenced[1] : raw;
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start === -1 || end === -1) return null;

      return JSON.parse(candidate.slice(start, end + 1));
    } catch (error) {
      const status = error.response?.status;
      // Only a rejected JSON *mode* is worth retrying. Anything else (auth, quota,
      // network) would fail again, so stop immediately.
      const modeRejected = (status === 400 || status === 405 || status === 422) && !lastError;
      if (!modeRejected) {
        lastError = toChatError(error);
        break;
      }
      lastError = toChatError(error);
      console.warn(
        `[chat] model rejected ${responseFormat ? responseFormat.type : "plain"} JSON mode ` +
          `(status ${status}); trying a looser mode.`
      );
    }
  }

  // A failed tool decision must not fail the request — the assistant simply
  // answers from retrieved knowledge instead.
  console.warn(`[chat] tool decision unavailable (${lastError?.kind}); continuing without it.`);
  return null;
};

module.exports = { chatCompletion, structuredCompletion, ChatError, hasToken, CHAT_URL };
