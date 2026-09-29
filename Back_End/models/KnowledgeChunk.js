/**
 * One chunk of a TickXplore knowledge document, stored in the existing MongoDB.
 * ------------------------------------------------------------------
 * This is the only new collection the chatbot adds. It holds the text of a chunk
 * plus its embedding (the list of numbers) so the chatbot can find relevant chunks
 * by meaning.
 *
 * Search happens in Node (see `utils/rag/retriever.js`) rather than through an
 * Atlas Vector Search index, so no extra dashboard configuration or infrastructure is
 * required and the chatbot works against a plain local MongoDB too.
 */

const mongoose = require("mongoose");

const knowledgeChunkSchema = new mongoose.Schema(
  {
    /** File the chunk came from, e.g. `"booking.md"`. */
    source: { type: String, required: true, trim: true },
    /** Broad subject, e.g. `"booking"`. Mirrors the document front matter. */
    topic: { type: String, required: true, trim: true, index: true },
    /** The `##` section heading the chunk belongs to. */
    heading: { type: String, default: "", trim: true },
    /** Position of the chunk inside its document. */
    chunkIndex: { type: Number, required: true },
    /** The plain-text chunk that was embedded. */
    content: { type: String, required: true },
    /** Hash of source+heading+content, used to skip re-embedding unchanged chunks. */
    contentHash: { type: String, required: true },
    /** The embedding vector. Stored as a plain array of numbers. */
    embedding: {
      type: [Number],
      default: undefined,
    },
    /** Which embedding model produced `embedding`, so a model change can be detected. */
    model: { type: String, default: "" },
  },
  { timestamps: true }
);

knowledgeChunkSchema.index({ source: 1, chunkIndex: 1 }, { unique: true });

module.exports = mongoose.models.KnowledgeChunk || mongoose.model("KnowledgeChunk", knowledgeChunkSchema);
