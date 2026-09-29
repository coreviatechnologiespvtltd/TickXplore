/**
 * Build the TickXplore RAG knowledge base.
 * ------------------------------------------------------------------
 * Reads every Markdown file in `knowledge/`, splits it into chunks, embeds each
 * chunk, and stores the text + vector in MongoDB. Run it after editing any
 * knowledge document:
 *
 *   cd Back_End
 *   npm run chat:ingest
 *
 * Only changed chunks are re-embedded: each chunk has a `contentHash`, so an
 * untouched file costs nothing. Chunks whose file was deleted are removed.
 *
 * Needs `HUGGINGFACE_API_KEY` in the root `.env` and a reachable `MONGO_URI`.
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { chunkDocument } = require("./chunker");
const { embedMany, EMBEDDING_DIMENSIONS } = require("./embeddings");
const KnowledgeChunk = require("../../models/KnowledgeChunk");

// The `.env` lives at the repository root, three levels above this file
// (Back_End/utils/rag -> Back_End/utils -> Back_End -> repo root).
require("dotenv").config({ path: path.join(__dirname, "..", "..", "..", ".env") });

const KNOWLEDGE_DIR = path.join(__dirname, "..", "..", "knowledge");

/** Which embedding model produced the vectors currently in the database. */
const currentEmbeddingModel = () =>
  process.env.HF_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2";

/** Read every `*.md` in the knowledge directory. */
const readKnowledgeFiles = () => {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    throw new Error(`Knowledge directory not found: ${KNOWLEDGE_DIR}`);
  }

  return fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((file) => file.toLowerCase().endsWith(".md"))
    .sort()
    .map((file) => ({
      source: file,
      text: fs.readFileSync(path.join(KNOWLEDGE_DIR, file), "utf-8"),
    }));
};

/**
 * Index the knowledge base into MongoDB.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun] Report what would happen without writing.
 * @returns {Promise<{files: number, chunks: number, embedded: number, cached: number, removed: number}>}
 */
const ingestKnowledgeBase = async ({ dryRun = false } = {}) => {
  const files = readKnowledgeFiles();
  if (files.length === 0) throw new Error("No .md files found in the knowledge directory.");

  const allChunks = files.flatMap(({ source, text }) => chunkDocument(text, { source }));
  if (allChunks.length === 0) throw new Error("Knowledge files produced no chunks.");

  const model = currentEmbeddingModel();
  const existing = await KnowledgeChunk.find({}).lean();
  const existingByHash = new Map(existing.map((doc) => [doc.contentHash, doc]));

  const stats = { files: files.length, chunks: allChunks.length, embedded: 0, cached: 0, removed: 0 };
  const operations = [];

  // Reuse vectors for chunks that are unchanged, then embed only the rest. A chunk
  // whose vector came from a different model is always re-embedded, because vectors
  // from two models are not comparable.
  const reusable = allChunks.map((chunk) => {
    const previous = existingByHash.get(chunk.contentHash);
    const usable =
      previous &&
      previous.model === model &&
      Array.isArray(previous.embedding) &&
      previous.embedding.length === EMBEDDING_DIMENSIONS;
    return usable ? previous.embedding : null;
  });

  const pendingIndexes = reusable.reduce(
    (acc, vector, index) => (vector ? acc : [...acc, index]),
    []
  );

  stats.cached = allChunks.length - pendingIndexes.length;

  if (pendingIndexes.length > 0) {
    const fresh = await embedMany(pendingIndexes.map((index) => allChunks[index].content));
    pendingIndexes.forEach((chunkIndex, position) => {
      if (fresh[position]) {
        reusable[chunkIndex] = fresh[position];
        stats.embedded += 1;
      }
    });
  }

  allChunks.forEach((chunk, index) => {
    operations.push({
      updateOne: {
        filter: { source: chunk.source, chunkIndex: chunk.chunkIndex },
        update: {
          $set: {
            source: chunk.source,
            topic: chunk.topic,
            heading: chunk.heading,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: chunk.contentHash,
            embedding: reusable[index] || undefined,
            model,
          },
        },
        upsert: true,
      },
    });
  });

  // Drop chunks from files that no longer exist, so a deleted document stops
  // being retrievable.
  const liveSources = new Set(files.map((f) => f.source));
  const staleSources = [...new Set(existing.map((d) => d.source))].filter(
    (source) => !liveSources.has(source)
  );
  stats.removed = existing.filter((d) => staleSources.includes(d.source)).length;

  if (dryRun) return stats;

  if (operations.length) await KnowledgeChunk.bulkWrite(operations, { ordered: false });
  if (staleSources.length) await KnowledgeChunk.deleteMany({ source: { $in: staleSources } });

  return stats;
};

/** Run directly as a script: `node utils/rag/ingest.js`. */
const runFromCli = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("MONGO_URI is not set. Add it to the root .env file.");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Connected to MongoDB.");

  const stats = await ingestKnowledgeBase();
  const total = await KnowledgeChunk.countDocuments();

  console.log("Knowledge base updated:");
  console.log(`  documents read     : ${stats.files}`);
  console.log(`  chunks produced    : ${stats.chunks}`);
  console.log(`  newly embedded     : ${stats.embedded}`);
  console.log(`  reused from cache  : ${stats.cached}`);
  console.log(`  stale chunks removed: ${stats.removed}`);
  console.log(`  total chunks stored : ${total}`);

  await mongoose.connection.close();
};

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error(`Ingestion failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { ingestKnowledgeBase, readKnowledgeFiles, KNOWLEDGE_DIR };
