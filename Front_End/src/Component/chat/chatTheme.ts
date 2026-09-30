/**
 * Shared presentation constants for the chat window.
 * ------------------------------------------------------------------
 * Kept in one place so the launcher, the header and the panel stay in sync.
 * Every value here is copied from the existing TickXplore theme (see
 * `src/index.css` and `tailwind.config.js`) — no new palette is introduced.
 */

/** Matches `MAX_MESSAGE_CHARS` in `Back_End/utils/chat/config.js`. */
export const MAX_MESSAGE_CHARS = 2000;

/** How close to the bottom the user must be for us to keep auto-scrolling. */
export const STICK_TO_BOTTOM_PX = 80;

/** The backend ships 8 starter questions; three at a time is plenty to read. */
export const MAX_VISIBLE_SUGGESTIONS = 3;

export const BOT_NAME = "TickXplore Assistant";

export const OPEN_LABEL = "Open the TickXplore Assistant";
export const MINIMIZE_LABEL = "Minimize the TickXplore Assistant";
export const CLOSE_LABEL = "Close and clear the TickXplore Assistant";
export const RESET_LABEL = "Start a new conversation";

/** Status line copy. Kept short — it sits under the bot name in the header. */
export const STATUS = {
  online: "Online · usually replies instantly",
  typing: "Typing…",
  error: "Temporarily unavailable",
} as const;

export type StatusKind = keyof typeof STATUS;

/** Timestamp shown under each bubble, e.g. "14:32". */
export const formatTime = (value: number) =>
  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
