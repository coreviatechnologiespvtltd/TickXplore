/**
 * Follow-up question chips.
 * ------------------------------------------------------------------
 * The backend ships eight starters and never refreshes them (`suggestions` comes
 * back empty on a normal answer), so the old window showed all eight below every
 * single reply. That is a wall of text. This shows at most three, drops any the
 * user has already asked, and hides the row entirely if nothing is left.
 *
 * Questions the user already sent are filtered out, so the row naturally gets
 * more useful as the conversation goes on instead of repeating itself.
 */
import { MAX_VISIBLE_SUGGESTIONS } from "./chatTheme";

interface SuggestionChipsProps {
  suggestions: string[];
  /** Questions already in the thread, so we do not offer them again. */
  asked: string[];
  onPick: (question: string) => void;
}

const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const SuggestionChips = ({ suggestions, asked, onPick }: SuggestionChipsProps) => {
  const alreadyAsked = new Set(asked.map(normalise));

  const remaining = suggestions.filter((question) => !alreadyAsked.has(normalise(question)));
  const visible = remaining.slice(0, MAX_VISIBLE_SUGGESTIONS);

  if (visible.length === 0) return null;

  return (
    <div
      className="border-t border-slate-100 bg-slate-50/70 px-3 py-2.5 animate-fade-in"
      role="group"
      aria-label="Suggested questions"
    >
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        Try asking
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onPick(question)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-[11.5px] font-medium leading-tight text-slate-600 transition-all duration-150 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestionChips;
