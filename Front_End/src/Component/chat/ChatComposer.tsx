/**
 * The message composer.
 * ------------------------------------------------------------------
 * Upgraded from a single-line `<input>` to an auto-growing `<textarea>`:
 *   - Enter sends, Shift+Enter inserts a newline.
 *   - `isComposing` is checked so IME input methods (Nepali, Chinese, Japanese)
 *     are not cut short mid-composition by an Enter that is still part of the
 *     candidate selection.
 *   - Grows from one row to `MAX_TEXTAREA_HEIGHT`, then scrolls internally, so a
 *     long message never pushes the conversation off the screen.
 *
 * No `enterKeyHint="send"` here: on a textarea the browser would label the
 * return key "send" and then insert a newline anyway, which is worse than not
 * promising anything. Mobile users have the always-visible send button.
 *
 * The field stays editable while a reply is generating so the user can line up
 * their next question; only the send button is disabled. `maxLength` mirrors the
 * backend's `MAX_MESSAGE_CHARS` so the client rejects over-long input rather
 * than round-tripping to a 400.
 */
import { useEffect, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
import { FaPaperPlane } from "react-icons/fa";
import { MAX_MESSAGE_CHARS } from "./chatTheme";

const MAX_TEXTAREA_HEIGHT = 112; // ~5 rows
const COUNTER_THRESHOLD = Math.floor(MAX_MESSAGE_CHARS * 0.9);

interface ChatComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  hintId: string;
}

const ChatComposer = ({
  draft,
  onDraftChange,
  onSend,
  isLoading,
  inputRef,
  hintId,
}: ChatComposerProps) => {
  const canSend = draft.trim().length > 0 && !isLoading;

  /* Grow to fit the content, then stop and scroll internally. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [draft, inputRef]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) =>
    onDraftChange(event.target.value);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Let an IME finish choosing a candidate instead of submitting.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  const showCounter = draft.length > COUNTER_THRESHOLD;

  return (
    <div className="border-t border-slate-100 bg-white px-3 pt-2.5 pb-2">
      <div
        className={`flex items-end gap-2 rounded-xl border bg-white px-3 py-1.5 transition-shadow focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 ${
          isLoading ? "border-slate-200" : "border-slate-300"
        }`}
      >
        <label htmlFor="tickxplore-chat-input" className="sr-only">
          Type your message to the TickXplore Assistant
        </label>
        <textarea
          id="tickxplore-chat-input"
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder="Ask me anything…"
          aria-describedby={hintId}
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          className="max-h-28 min-h-[2.25rem] flex-1 resize-none border-0 bg-transparent py-1.5 text-[13.5px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
        />

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send message"
          className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
            canSend
              ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700 active:scale-90"
              : "cursor-not-allowed bg-slate-200 text-slate-400"
          }`}
        >
          <FaPaperPlane size={13} />
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
        <p id={hintId} className="hidden text-[10.5px] text-slate-400 sm:block">
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">Enter</kbd> to
          send
          <span className="mx-1 text-slate-300">·</span>
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">
            Shift + Enter
          </kbd>{" "}
          for a new line
        </p>
        <p className="ml-auto text-[10.5px] text-slate-400" aria-hidden="true">
          {showCounter ? (
            <span className={draft.length >= MAX_MESSAGE_CHARS ? "font-semibold text-amber-600" : ""}>
              {draft.length} / {MAX_MESSAGE_CHARS}
            </span>
          ) : (
            <span className="hidden sm:inline">Powered by TickXplore</span>
          )}
        </p>
      </div>
    </div>
  );
};

export default ChatComposer;
