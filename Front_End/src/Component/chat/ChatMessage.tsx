/**
 * One bubble in the conversation.
 * ------------------------------------------------------------------
 * User turns are right-aligned, compact and blue. Assistant turns are
 * left-aligned on a plain white surface with a small bot avatar, which keeps a
 * long answer readable instead of a solid block of colour. Assistant messages
 * may be an answer or an error, and an error gets an amber treatment plus a
 * retry button so it can never be mistaken for a real answer.
 *
 * Knowledge-base citations are deliberately not shown. The backend still returns
 * them, but their values are raw filenames (`booking.md`, `payment.md`), which is
 * internal plumbing rather than anything useful to a visitor. `ChatResponse` in
 * `src/api/index.ts` still declares the field so the type matches the wire format.
 */
import { FaExclamationTriangle, FaRedo } from "react-icons/fa";
import { renderRichText } from "./richText";

export interface MessageBubble {
  role: "user" | "assistant";
  content: string;
  /** Marks a friendly failure message rather than a reply. */
  isError?: boolean;
  /** Set when `isError`, so the retry button knows what to resend. */
  retry?: () => void;
  /** Epoch millis, used for the timestamp and for a stable React key. */
  at?: number;
  /** Plays the arrival animation once, on the turn that just landed. */
  animate?: boolean;
}

interface ChatMessageProps {
  message: MessageBubble;
  time: string;
  /** Stable React key for this bubble. */
  bubbleKey: string;
}

const AVATAR = (
  <span
    aria-hidden="true"
    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-bold leading-none text-blue-600 ring-1 ring-blue-100"
  >
    T
  </span>
);

const ChatMessage = ({ message, time, bubbleKey }: ChatMessageProps) => {
  const { role, content, isError } = message;

  /* ---- user turn: right-aligned, no avatar ---- */
  if (role === "user") {
    return (
      <div
        key={bubbleKey}
        className={`flex justify-end ${message.animate ? "animate-chat-bubble-in" : ""}`}
      >
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-br-md bg-blue-600 px-3.5 py-2 text-[13.5px] leading-relaxed text-white shadow-sm [overflow-wrap:anywhere]">
            {/* User text is never parsed as Markdown — it is shown verbatim. */}
            <p className="whitespace-pre-wrap break-words">{content}</p>
          </div>
          <p className="mt-1 pr-1 text-right text-[10px] text-slate-500">{time}</p>
        </div>
      </div>
    );
  }

  /* ---- assistant turn: left-aligned, with avatar ---- */

  return (
    <div
      key={bubbleKey}
      className={`flex items-start gap-2 ${message.animate ? "animate-chat-bubble-in" : ""}`}
    >
      {AVATAR}

      <div className="min-w-0 max-w-[85%] flex-1">
        <div
          className={
            isError
              ? "rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-amber-900"
              : "rounded-2xl rounded-bl-md border border-slate-100 bg-white px-3.5 py-2 text-[13.5px] leading-relaxed text-slate-700 shadow-sm"
          }
        >
          {isError && (
            <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-amber-800">
              <FaExclamationTriangle size={12} aria-hidden="true" />
              Message not delivered
            </p>
          )}

          <div className={isError ? undefined : "space-y-1"}>{renderRichText(content)}</div>

          {isError && message.retry && (
            <button
              type="button"
              onClick={message.retry}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <FaRedo size={11} aria-hidden="true" />
              Try again
            </button>
          )}
        </div>

        <p className="mt-1 px-0.5 text-[10px] text-slate-500">{time}</p>
      </div>
    </div>
  );
};

export default ChatMessage;
