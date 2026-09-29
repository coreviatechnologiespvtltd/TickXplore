/**
 * Retrieve relevant knowledge for a user's question.
 * ------------------------------------------------------------------
 * This is the "R" in RAG — Retrieval. The steps are:
 *
 *   1. Turn the user's question into a vector (the same numbers the documents
 *      were turned into when they were indexed).
 *   2. Compare that vector against every stored chunk and keep the closest ones.
 *   3. Return those chunks as context for the chat model.
 *
 * Similarity uses cosine similarity: the angle between two vectors. 1 means
 * "these mean the same thing", 0 means "unrelated". It is a few lines of maths
 * rather than a new database, which keeps the whole RAG setup self-contained.
 */

const KnowledgeChunk = require("../../models/KnowledgeChunk");
const { embedText, hasToken } = require("./embeddings");

/** How many chunks to hand to the chat model. Four is enough to cover a question. */
const DEFAULT_TOP_K = 4;

/**
 * Chunks scoring below this are treated as "nothing relevant found".
 * Cosine similarity between an English sentence and a relevant paragraph is
 * typically 0.2 or higher; unrelated text sits well below 0.1.
 */
const MIN_SCORE = 0.15;

/**
 * Cosine similarity of two equal-length vectors.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} -1 to 1
 */
const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Find the knowledge chunks most relevant to a question.
 *
 * @param {string} question
 * @param {object} [options]
 * @param {number} [options.topK]
 * @param {number} [options.minScore]
 * @returns {Promise<{found: boolean, chunks: Array<{content: string, source: string, topic: string, heading: string, score: number}>}>}
 */
const retrieveContext = async (question, { topK = DEFAULT_TOP_K, minScore = MIN_SCORE } = {}) => {
  const empty = { found: false, chunks: [] };

  const text = String(question || "").trim();
  if (!text) return empty;

  // Without a token the knowledge base cannot be searched. The caller falls back
  // to a "I don't have that information" reply rather than guessing.
  if (!hasToken()) return empty;

  let queryVector;
  try {
    queryVector = await embedText(text);
  } catch (error) {
    console.warn(`[rag/retriever] could not embed the question: ${error.message}`);
    return empty;
  }
  if (!queryVector) return empty;

  let stored;
  try {
    stored = await KnowledgeChunk.find({ embedding: { $exists: true, $ne: [] } })
      .select("content source topic heading embedding")
      .lean();
  } catch (error) {
    console.warn(`[rag/retriever] knowledge base is unavailable: ${error.message}`);
    return empty;
  }

  if (!stored || stored.length === 0) {
    console.warn("[rag/retriever] no indexed chunks found. Run `npm run chat:ingest`.");
    return empty;
  }

  const scored = stored
    .map((doc) => ({
      content: doc.content,
      source: doc.source,
      topic: doc.topic,
      heading: doc.heading,
      score: cosineSimilarity(queryVector, doc.embedding),
    }))
    .filter((doc) => doc.score >= minScore)
    .sort((a, b) => b.score - a.score);

  return { found: scored.length > 0, chunks: scored.slice(0, topK) };
};

/**
 * Format retrieved chunks into the context block given to the chat model.
 *
 * @param {Array<{content: string, source: string}>} chunks
 * @returns {string}
 */
const formatContext = (chunks) =>
  chunks
    .map((chunk, index) => `[Knowledge ${index + 1} — ${chunk.source}]\n${chunk.content}`)
    .join("\n\n");

/** Short source list for the UI, e.g. `["booking.md", "payment.md"]`. */
const formatSources = (chunks) => [...new Set(chunks.map((chunk) => chunk.source))];

module.exports = {
  retrieveContext,
  formatContext,
  formatSources,
  cosineSimilarity,
  DEFAULT_TOP_K,
  MIN_SCORE,
};
