/**
 * The "assistant is thinking" state.
 * ------------------------------------------------------------------
 * A staggered three-dot bounce inside an assistant-shaped bubble. It is placed
 * after the user's turn so the pairing reads correctly, and it is announced
 * politely by the surrounding `role="log"` region rather than stealing focus.
 *
 * Replaces the centred `BeatLoader` spinner, which appeared detached from the
 * conversation and gave no hint who was typing.
 */
const TypingIndicator = () => (
  <div className="flex items-start gap-2" aria-hidden="true">
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-bold leading-none text-blue-600 ring-1 ring-blue-100">
      T
    </span>
    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-slate-100 bg-white px-4 py-3.5 shadow-sm">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-chat-typing-dot"
          style={{ animationDelay: `${dot * 0.15}s` }}
        />
      ))}
    </div>
  </div>
);

export default TypingIndicator;
