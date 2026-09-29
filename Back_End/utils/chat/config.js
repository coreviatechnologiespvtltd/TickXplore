/**
 * Configuration for the TickXplore chatbot.
 * ------------------------------------------------------------------
 * Every setting the AI part of TickXplore reads lives here, so there is one place
 * to look and one place to change. All values come from the server-side root `.env`
 * and all of them have a working default except the Hugging Face token.
 *
 * NEVER prefix any of these with `VITE_`. The frontend Vite config uses the repo
 * root as its env directory, so any `VITE_*` variable is compiled into the public
 * JavaScript bundle and is readable by anyone who opens the browser. The chatbot
 * token is `HUGGINGFACE_API_KEY`, which is never exposed to the frontend.
 */

/** Hugging Face token. Server-side only. Required for both chat and embeddings. */
const HF_TOKEN_ENV = "HUGGINGFACE_API_KEY";

/**
 * The chat model that writes the replies.
 * Any model available on the Hugging Face Inference router works, for example
 * `meta-llama/Llama-3.1-8B-Instruct`, `Qwen/Qwen2.5-7B-Instruct`, or
 * `HuggingFaceH4/zephyr-7b-beta`. Change this in the `.env` file to switch models.
 */
const HF_CHAT_MODEL =
  process.env.HF_CHAT_MODEL || "meta-llama/Llama-3.1-8B-Instruct";

/**
 * The embedding model. This is a SEPARATE model from the chat model: it turns text
 * into numbers so the knowledge base can be searched, and it never writes a reply.
 * Changing it means re-running `npm run chat:ingest`, because stored vectors from a
 * different model cannot be compared with new ones.
 */
const HF_EMBEDDING_MODEL =
  process.env.HF_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2";

/** How long to wait for Hugging Face before giving up, in milliseconds. */
const HF_TIMEOUT_MS = Number(process.env.HF_TIMEOUT_MS) || 20_000;

/** Cap on reply length, so a chat window is never flooded. */
const HF_MAX_TOKENS = Number(process.env.HF_MAX_TOKENS) || 700;

/** Request guards. */
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 6000;

module.exports = {
  HF_TOKEN_ENV,
  HF_CHAT_MODEL,
  HF_EMBEDDING_MODEL,
  HF_TIMEOUT_MS,
  HF_MAX_TOKENS,
  MAX_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_CHARS,
};
