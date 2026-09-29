/**
 * Document chunking for the TickXplore RAG knowledge base.
 * ------------------------------------------------------------------
 * Plain-text Markdown in, small text chunks out.
 *
 * Why chunking at all: the language model can only read a limited amount of
 * text per question. Instead of sending every knowledge document on every
 * request, we split them into small pieces ("chunks") up front and later send
 * only the handful that actually look relevant to the user's question.
 *
 * Strategy (deliberately simple so it is easy to follow):
 *   1. Read the file and drop the YAML front matter (it is metadata, not content).
 *   2. Split on Markdown headings. A section under a `##` heading is almost
 *      always one coherent idea, so it is the best possible chunk boundary.
 *   3. If a section is still too long, break it further at paragraph/sentence
 *      boundaries, keeping a small overlap so a sentence cut in half at the end
 *      of one chunk is still complete at the start of the next.
 *   4. Attach metadata (source file, topic, heading, index) to every chunk.
 */

const crypto = require("crypto");

/** Target chunk size in characters. ~800 chars is roughly 150-200 words. */
const MAX_CHUNK_CHARS = 800;

/** Characters repeated from the end of one chunk into the start of the next. */
const OVERLAP_CHARS = 120;

/** Chunks shorter than this are merged into their neighbour — too small to match well. */
const MIN_CHUNK_CHARS = 120;

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a very small YAML subset (`key: value` lines) used by the knowledge
 * documents. This is not a general YAML parser on purpose — the knowledge files
 * are ours, and a full parser would be a needless dependency.
 *
 * @param {string} raw
 * @returns {Record<string, string>}
 */
const parseFrontMatter = (raw) => {
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) return {};

  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const lineMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!lineMatch) continue;
    out[lineMatch[1]] = lineMatch[2].replace(/^["']|["']$/g, "");
  }
  return out;
};

/** Remove Markdown syntax so the embedded text is plain language. */
const stripMarkdown = (text) =>
  text
    .replace(/^```[\s\S]*?```/gm, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading hashes
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s{0,3}\d+\.\s+/gm, "") // ordered list markers
    .replace(/^\s*>\s?/gm, "") // block quotes
    .replace(/[*_~]{1,3}/g, "") // emphasis
    .replace(/^\s*\|/gm, " ") // table pipes
    .replace(/\|/g, " ")
    .replace(/^\s*[-:|\s]+$/gm, " ") // table separator rows
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Break one long section into overlapping pieces, preferring paragraph, then
 * sentence, then word boundaries so a chunk never starts or ends mid-sentence
 * when it can be avoided.
 *
 * @param {string} text
 * @returns {string[]}
 */
const splitLongText = (text) => {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  const pieces = [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  let current = "";
  const flush = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      // A single oversized paragraph: fall back to sentence then word splitting.
      const sentences = paragraph.match(/[^.!?]+[.!?]+[\s]*|[^.!?]+$/g) || [paragraph];
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > MAX_CHUNK_CHARS && current) flush();
        if (sentence.length > MAX_CHUNK_CHARS) {
          for (const word of sentence.split(/\s+/)) {
            if (current.length + word.length + 1 > MAX_CHUNK_CHARS && current) {
              // Carry the tail of the previous chunk into this one as overlap.
              const tail = current.slice(-OVERLAP_CHARS);
              pieces.push(current.trim());
              current = `${tail} ${word}`;
            } else {
              current = current ? `${current} ${word}` : word;
            }
          }
        } else {
          current = current ? `${current} ${sentence.trim()}` : sentence.trim();
        }
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > MAX_CHUNK_CHARS && current) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return pieces;
};

/**
 * Turn one knowledge document into chunks with metadata.
 *
 * @param {string} rawText Full file contents.
 * @param {object} options
 * @param {string} options.source File name, e.g. `"booking.md"`.
 * @returns {Array<{content: string, source: string, topic: string, heading: string, chunkIndex: number, contentHash: string}>}
 */
const chunkDocument = (rawText, { source }) => {
  const meta = parseFrontMatter(rawText);
  const body = rawText.replace(FRONT_MATTER_RE, "");

  const topic = meta.topic || source.replace(/\.md$/i, "");
  const documentTitle = meta.title || topic;

  // Split on `##` headings. Everything before the first `##` (the introduction)
  // simply becomes the first section, labelled with the document title.
  const sections = [];
  let heading = documentTitle;
  let buffer = [];

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("# ")) continue; // the H1 is the document title, already captured

    const headingMatch = line.match(/^##\s+(.*)$/);
    if (headingMatch) {
      const content = buffer.join("\n").trim();
      if (content) sections.push({ heading, content });
      heading = headingMatch[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  const tail = buffer.join("\n").trim();
  if (tail) sections.push({ heading, content: tail });

  const chunks = [];
  for (const section of sections) {
    const plain = stripMarkdown(section.content);
    if (!plain) continue;

    for (const piece of splitLongText(plain)) {
      // Prefix with the heading so the retrieved text carries its own context.
      const content = `${documentTitle} — ${section.heading}\n${piece}`.trim();
      if (content.length < MIN_CHUNK_CHARS && chunks.length > 0) {
        // Too small to be worth its own vector: fold it into the previous chunk.
        chunks[chunks.length - 1].content = `${chunks[chunks.length - 1].content}\n${content}`;
        continue;
      }
      chunks.push({
        content,
        source,
        topic,
        heading: section.heading,
        chunkIndex: chunks.length,
        contentHash: crypto
          .createHash("sha256")
          .update(`${source}::${section.heading}::${content}`)
          .digest("hex")
          .slice(0, 32),
      });
    }
  }

  return chunks;
};

module.exports = {
  chunkDocument,
  parseFrontMatter,
  stripMarkdown,
  MAX_CHUNK_CHARS,
  OVERLAP_CHARS,
  MIN_CHUNK_CHARS,
};
