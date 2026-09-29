/**
 * Embeddings for the TickXplore RAG pipeline.
 * ------------------------------------------------------------------
 * An EMBEDDING MODEL IS NOT THE CHAT MODEL. They are two different jobs:
 *
 *   - The embedding model (`sentence-transformers/all-MiniLM-L6-v2`, 384 numbers)
 *     reads a piece of text and turns it into a list of numbers ("a vector") that
 *     captures its meaning. Two sentences that mean the same thing end up with
 *     similar vectors. This is what lets us search the knowledge base.
 *   - The chat model (see `utils/chat/hfClient.js`) reads the retrieved text and
 *     writes the reply you actually read.
 *
 * We send text to Hugging Face's public inference API using the server-side
 * `HUGGINGFACE_API_KEY`. The key is never sent to the browser.
 *
 * A disk cache is kept under `.cache/rag/` so re-indexing the knowledge base does
 * not re-embed text that has not changed, and so the chatbot keeps working even
 * if Hugging Face is briefly unreachable.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** The embedding model. Change `HF_EMBEDDING_MODEL` to swap models. */
const DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2";

/** Hugging Face's router proxies the free inference API under `/hf-inference/models/...`. */
const HF_INFERENCE_BASE = "https://router.huggingface.co/hf-inference/models";

/** The model actually in use right now. */
const embeddingModel = () => process.env.HF_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;

/**
 * The full feature-extraction URL.
 *
 * The `/pipeline/feature-extraction` suffix is REQUIRED. Without it Hugging Face
 * resolves the bare model URL to a sentence-similarity pipeline instead, which
 * rejects our payload with HTTP 400 ("missing ... argument: 'sentences'").
 */
const embeddingUrl = () =>
  `${HF_INFERENCE_BASE}/${embeddingModel()}/pipeline/feature-extraction`;

/** all-MiniLM-L6-v2 produces 384-dimension vectors. */
const EMBEDDING_DIMENSIONS = 384;

/** Sentences are embedded individually so a long document does not get averaged away. */
const MAX_TEXTS_PER_REQUEST = 16;

/** Hugging Face's free tier caps request payloads; keep each text well under it. */
const MAX_TEXT_CHARS = 2000;

/** Requests kept in flight at once. The disk cache absorbs the repeats. */
const CONCURRENCY = 4;

const CACHE_DIR = path.join(__dirname, "..", "..", ".cache", "rag");

/** True when a server-side token is configured. Never logs the token itself. */
const hasToken = () => Boolean(process.env.HUGGINGFACE_API_KEY);

/** Stable cache key: model + text, so changing models invalidates old vectors. */
const cacheKey = (text) => {
  return crypto
    .createHash("sha256")
    .update(`${embeddingModel()}::${text}`)
    .digest("hex");
};

const cachePath = (key) => path.join(CACHE_DIR, `${key}.json`);

const readCache = (key) => {
  try {
    const file = cachePath(key);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(parsed) && parsed.length === EMBEDDING_DIMENSIONS ? parsed : null;
  } catch {
    return null; // a corrupt cache entry is never fatal — just re-embed
  }
};

const writeCache = (key, vector) => {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(key), JSON.stringify(vector), "utf-8");
  } catch {
    // Caching is an optimisation. A read-only disk must not break the chatbot.
  }
};

/** Split a long string into sentences so each one is embedded on its own. */
const splitForEmbedding = (text) => {
  const trimmed = String(text).slice(0, MAX_TEXT_CHARS).trim();
  if (trimmed.length <= 500) return [trimmed];

  const parts = trimmed.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [trimmed];
  const sentences = parts.map((p) => p.trim()).filter(Boolean);
  return sentences.length > 1 ? sentences : [trimmed];
};

/** One HTTP call to the embedding endpoint for a batch of texts. */
const requestEmbeddings = async (texts) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(embeddingUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The status plus a short, truncated reason. Hugging Face's error bodies
      // describe the model/payload, never the token, and this is logged only for
      // the developer running `chat:ingest` — it is never returned to a user.
      const reason = (await response.text()).slice(0, 200);
      console.warn(
        `[rag/embeddings] Hugging Face responded ${response.status}: ${reason}`
      );
      throw Object.assign(new Error("embedding request failed"), {
        status: response.status,
      });
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Turn one piece of text into a vector.
 *
 * @param {string} text
 * @returns {Promise<number[]|null>} The vector, or `null` if embeddings are unavailable.
 */
const embedText = async (text) => {
  const clean = String(text || "").trim();
  if (!clean) return null;

  const key = cacheKey(clean);
  const cached = readCache(key);
  if (cached) return cached;

  if (!hasToken()) {
    console.warn("[rag/embeddings] HUGGINGFACE_API_KEY is not set; cannot embed text.");
    return null;
  }

  const parts = splitForEmbedding(clean);
  const batches = [];
  for (let i = 0; i < parts.length; i += MAX_TEXTS_PER_REQUEST) {
    batches.push(parts.slice(i, i + MAX_TEXTS_PER_REQUEST));
  }

  /** @type {number[][]} */
  const vectors = [];
  for (const batch of batches) {
    const payload = await requestEmbeddings(batch);

    // The endpoint returns either [[...]] (feature-extraction) or a single [...] row.
    const rows = Array.isArray(payload) && Array.isArray(payload[0]) ? payload : [payload];
    for (const row of rows) {
      if (Array.isArray(row) && row.length > 0) vectors.push(row.map(Number));
    }
    if (vectors.length >= parts.length) break;
  }

  if (vectors.length === 0) return null;

  // A chunk that was split into several sentences is represented by the mean of
  // its sentence vectors — one vector per chunk, which is what the store expects.
  const mean = new Array(vectors[0].length).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < vector.length; i += 1) mean[i] += vector[i];
  }
  const averaged = mean.map((value) => value / vectors.length);

  writeCache(key, averaged);
  return averaged;
};

/**
 * Embed several texts, reusing the cache wherever possible.
 *
 * A few run at a time: re-indexing the knowledge base means dozens of texts, and
 * firing them all at once would trip Hugging Face's rate limit for no benefit.
 *
 * @param {string[]} texts
 * @returns {Promise<Array<number|null>>} Vectors aligned with `texts`; `null` where embedding failed.
 */
const embedMany = async (texts) => {
  const results = new Array(texts.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await embedText(texts[index]);
      } catch (error) {
        console.warn(`[rag/embeddings] failed to embed a text: ${error.message}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () => worker())
  );
  return results;
};

module.exports = {
  embedText,
  embedMany,
  hasToken,
  embeddingModel,
  embeddingUrl,
  EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
};
