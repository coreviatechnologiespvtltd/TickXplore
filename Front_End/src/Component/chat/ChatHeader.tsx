/**
 * The chat window header.
 * ------------------------------------------------------------------
 * Coloured to match the site navbar (`bg-slate-900`, `border-b border-white/5`)
 * and wordmarked the same way, so the window reads as part of TickXplore rather
 * than a bolted-on third-party widget.
 *
 * Minimize, close and reset are three distinct actions:
 *   - Minimize collapses the window and keeps the conversation.
 *   - Close dismisses it, also dropping any half-finished confirmation.
 *   - Reset empties the thread so the next message starts from the welcome state.
 *
 * None of them destroys a thread on its own, so a stray click never loses
 * anything the user typed.
 */
import { FaRedo, FaRobot, FaTimes } from "react-icons/fa";
import { FiMinus } from "react-icons/fi";
import {
  CLOSE_LABEL,
  MINIMIZE_LABEL,
  RESET_LABEL,
  STATUS,
  type StatusKind,
} from "./chatTheme";

interface ChatHeaderProps {
  status: StatusKind;
  titleId: string;
  onMinimize: () => void;
  onClose: () => void;
  onReset: () => void;
  /** The reset button is pointless when there is nothing to reset. */
  canReset: boolean;
}

const DOT_COLOR: Record<StatusKind, string> = {
  online: "bg-emerald-400",
  typing: "bg-blue-400",
  error: "bg-amber-400",
};

const iconButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors " +
  "duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 " +
  "disabled:pointer-events-none disabled:opacity-40";

const ChatHeader = ({
  status,
  titleId,
  onMinimize,
  onClose,
  onReset,
  canReset,
}: ChatHeaderProps) => (
  <div className="flex items-center gap-3 border-b border-white/5 bg-slate-900 px-3 py-3 sm:px-4">
    <span
      aria-hidden="true"
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white/10"
    >
      <FaRobot size={17} />
      {/* Availability dot, mirrored from the status text for colour-blind users. */}
      <span
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900 ${DOT_COLOR[status]} ${
          status === "typing" ? "animate-pulse" : ""
        }`}
      />
    </span>

    <div className="min-w-0 flex-1">
      <h2
        id={titleId}
        className="truncate text-[15px] font-semibold leading-tight text-white"
      >
        Tick<span className="text-blue-500">Xplore</span> Assistant
      </h2>
      {/* `aria-live` so the status change is announced without moving focus. */}
      <p
        className="truncate text-[11px] leading-tight text-slate-400"
        aria-live="polite"
        aria-atomic="true"
      >
        {STATUS[status]}
      </p>
    </div>

    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        className={iconButton}
        aria-label={RESET_LABEL}
        title={RESET_LABEL}
      >
        <FaRedo size={14} />
      </button>
      <button
        type="button"
        onClick={onMinimize}
        className={iconButton}
        aria-label={MINIMIZE_LABEL}
        title={MINIMIZE_LABEL}
      >
        <FiMinus size={16} />
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`${iconButton} hover:bg-red-500/15 hover:text-red-300`}
        aria-label={CLOSE_LABEL}
        title={CLOSE_LABEL}
      >
        <FaTimes size={15} />
      </button>
    </div>
  </div>
);

export default ChatHeader;