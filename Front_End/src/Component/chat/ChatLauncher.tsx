/**
 * The floating launcher for the chat window.
 * ------------------------------------------------------------------
 * Bottom-left, because the bottom-right corner is already taken by
 * `ScrollToTopButton` (lg:bottom-6 lg:right-8) and by the mobile filter button
 * on `AccommodationPage` (bottom-5 right-5 lg:hidden). Stacking three FABs in
 * one corner is worse than being unconventional, so this one stays left.
 *
 * The ping plays a couple of times on first load so the button is noticed, then
 * the class is dropped and it never distracts again.
 */
import { useEffect, useState, type RefObject } from "react";
import { FaChevronDown, FaCommentDots } from "react-icons/fa";
import { MINIMIZE_LABEL, OPEN_LABEL } from "./chatTheme";

interface ChatLauncherProps {
  isOpen: boolean;
  onToggle: () => void;
  /** The id of the panel this button controls, wired to `aria-controls`. */
  panelId: string;
  /** Focus returns here when the window is dismissed, so keyboard users are not
      dropped back at the top of the document. */
  buttonRef: RefObject<HTMLButtonElement>;
}

const ChatLauncher = ({ isOpen, onToggle, panelId, buttonRef }: ChatLauncherProps) => {
  // A brief attention pulse, only ever on the first mount of a page load.
  const [ping, setPing] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setPing(false), 3400);
    return () => window.clearTimeout(timer);
  }, []);

  const label = isOpen ? MINIMIZE_LABEL : OPEN_LABEL;

  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={isOpen}
      aria-controls={panelId}
      className={`group fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-50 flex h-14 w-14
        items-center justify-center rounded-full bg-blue-600 text-white shadow-card-lg ring-1 ring-blue-700/20
        transition-[transform,background-color,box-shadow] duration-200 ease-out
        hover:bg-blue-700 hover:shadow-xl hover:ring-blue-800/30 active:scale-95
        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60
        sm:bottom-6 sm:left-6 ${isOpen ? "scale-95" : ""}`}
    >
      {/* Attention ring. `animate-chat-ping` runs twice then stops for good. */}
      {ping && !isOpen && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-blue-500 animate-chat-ping"
        />
      )}

      {/* Icons cross-fade so the control does not snap between shapes. */}
      <span className="relative flex h-full w-full items-center justify-center">
        <FaCommentDots
          size={23}
          aria-hidden="true"
          className={`absolute transition-all duration-200 ease-out ${
            isOpen ? "scale-50 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"
          }`}
        />
        <FaChevronDown
          size={21}
          aria-hidden="true"
          className={`absolute transition-all duration-200 ease-out ${
            isOpen ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0"
          }`}
        />
      </span>
    </button>
  );
};

export default ChatLauncher;
