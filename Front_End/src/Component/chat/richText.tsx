/**
 * A very small Markdown renderer for assistant replies.
 * ------------------------------------------------------------------
 * The backend asks the model to "use short paragraphs or bullet points"
 * (`Back_End/utils/rag/prompts.js`), so replies arrive as Markdown-flavoured
 * plain text. The old window printed them with `whitespace-pre-wrap`, which left
 * literal `- ` prefixes on screen and made URLs dead text.
 *
 * This renders the handful of constructs the assistant actually produces —
 * paragraphs, bullet lists, numbered lists, bold, italic, inline code and links —
 * and nothing else. It is deliberately hand-rolled rather than pulling in
 * `marked` + a sanitiser, for two reasons: the supported grammar is tiny, and
 * we never build HTML strings, so there is no `dangerouslySetInnerHTML` anywhere
 * and no sanitiser to get wrong. Model output is never interpreted as HTML.
 *
 * The one thing that *is* dangerous in a model reply is a link, so every URL goes
 * through `safeHref` first: only `http`, `https` and `mailto` survive, and
 * anything else (`javascript:`, `data:`, `vbscript:`) degrades to plain text.
 */
import { type ReactNode } from "react";

/** Reject any URL scheme we do not explicitly want to make clickable. */
const safeHref = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  // A scheme-relative or relative URL has no scheme, so it cannot execute.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (!scheme) return null;
  if (scheme === "http" || scheme === "https" || scheme === "mailto") return value;
  return null;
};

/**
 * Inline formatting inside one block of text.
 * `**bold**`, `*italic*`, `` `code` ``, `[label](url)` and bare URLs.
 */
const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  // One pass over every inline construct at once, so markers cannot nest into
  // each other. Longest markers come first because `**` beats `*`.
  // The link arm allows one level of balanced inner parens, so
  // `[x](javascript:alert(1))` is captured whole and the label renders cleanly
  // instead of leaving a stray `)` behind.
  const pattern =
    /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))*\))|((?:https?:\/\/|www\.)[^\s<>()[\]{}"']+)/gi;

  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;

    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-900">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-700"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("[")) {
      // `[label](url)` — the label is plain text, the URL is validated.
      const closeLabel = token.indexOf("]");
      const label = token.slice(1, closeLabel);
      const href = safeHref(token.slice(closeLabel + 2, -1));
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-700"
          >
            {label}
          </a>
        ) : (
          label
        )
      );
    } else {
      // A bare URL. Give it a trailing `www.` if the model left the scheme off.
      // Trailing sentence punctuation is almost never part of the address, so
      // it is split off and appended *after* the link — and the href is built
      // from the trimmed value, not the raw token.
      const trimmed = token.replace(/[.,;:!?]+$/, "");
      const trailing = token.slice(trimmed.length);
      const href = safeHref(trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed);
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium break-all text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-700"
          >
            {trimmed}
          </a>
        ) : (
          trimmed
        )
      );
      if (trailing) nodes.push(trailing);
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
};

interface ListItem {
  key: string;
  indent: number;
  nodes: ReactNode[];
}

const isBullet = (line: string) => /^(\s*)[-*+]\s+(.*)$/.exec(line);
const isOrdered = (line: string) => /^(\s*)\d+[.)]\s+(.*)$/.exec(line);

/**
 * Render one bullet/ordered run. Consecutive list lines of the same kind become a
 * single `<ul>`/`<ol>`; an ordered item that interrupts bullets starts a new list.
 */
const renderList = (items: ListItem[], ordered: boolean, listKey: string) => {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      key={listKey}
      className={`my-1.5 space-y-1 ${ordered ? "list-decimal" : "list-disc"} marker:text-slate-400`}
    >
      {items.map((item) => (
        <li key={item.key} className={item.indent > 0 ? "ml-4" : undefined}>
          {item.nodes}
        </li>
      ))}
    </Tag>
  );
};

/**
 * Turn one assistant reply into React nodes.
 *
 * Blank lines separate blocks. Anything that is not a list item becomes a
 * paragraph, so a line the model forgot to mark still reads correctly.
 */
export const renderRichText = (raw: string): ReactNode[] => {
  const blocks = raw.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: ReactNode[] = [];
  let listBuffer: ListItem[] = [];
  let listOrdered = false;
  /** Guarantees a unique React key even when one block holds several lists. */
  let listSeq = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    out.push(renderList(listBuffer, listOrdered, `list-${listSeq++}`));
    listBuffer = [];
  };

  blocks.forEach((block, blockIndex) => {
    const keyPrefix = `b${blockIndex}`;

    // A single newline inside a block is a soft break, which we preserve.
    const lines = block.split("\n").filter((line) => line.trim().length > 0);

    lines.forEach((line, lineIndex) => {
      const bullet = isBullet(line);
      const ordered = bullet ? null : isOrdered(line);
      const match = bullet ?? ordered;
      const lineKey = `${keyPrefix}-l${lineIndex}`;

      if (match) {
        const indent = match[1].replace(/\t/g, "  ").length;
        const content = match[2];
        const asOrdered = ordered !== null;

        // Switching list type closes the previous list, so numbering restarts.
        if (listBuffer.length > 0 && asOrdered !== listOrdered) flushList();
        if (listBuffer.length === 0) listOrdered = asOrdered;

        listBuffer.push({
          key: lineKey,
          indent,
          nodes: renderInline(content, lineKey),
        });
        return;
      }

      flushList();
      out.push(
        <p key={lineKey} className="whitespace-pre-wrap break-words">
          {renderInline(line, lineKey)}
        </p>
      );
    });

    flushList();
  });

  return out;
};
