/**
 * First-open welcome state.
 * ------------------------------------------------------------------
 * Replaces the single long greeting paragraph with something scannable: a short
 * hello, one line on what the assistant can do, and five tappable quick actions.
 * Each button sends its own question, so a first-time visitor can get an answer
 * without typing anything.
 *
 * Every question here is answerable from `Back_End/knowledge/` (booking, vehicle,
 * cancellation/refund, tourist) and the live booking tools, so none of them
 * dead-end in the assistant's "I don't have that information" reply.
 */
import {
  FaCalendarCheck,
  FaCar,
  FaMapMarkedAlt,
  FaTicketAlt,
  FaUndo,
} from "react-icons/fa";

interface QuickAction {
  label: string;
  question: string;
  Icon: typeof FaTicketAlt;
}

/** Kept in the same order the backend presents its own starters. */
const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Book a bus ticket",
    question: "How do I book a bus ticket?",
    Icon: FaTicketAlt,
  },
  {
    label: "Reserve a vehicle",
    question: "How do I reserve a vehicle?",
    Icon: FaCar,
  },
  {
    label: "Manage my booking",
    question: "How do I check my bookings?",
    Icon: FaCalendarCheck,
  },
  {
    label: "Refund information",
    question: "How can I request a refund?",
    Icon: FaUndo,
  },
  {
    label: "Explore destinations",
    question: "What tourist destinations can I visit?",
    Icon: FaMapMarkedAlt,
  },
];

interface ChatWelcomeProps {
  onPick: (question: string) => void;
}

const ChatWelcome = ({ onPick }: ChatWelcomeProps) => (
  <div className="animate-chat-bubble-in">
    <p className="text-[15px] font-semibold text-slate-900">Hello there! 👋</p>
    <p className="mt-1 text-[13.5px] leading-relaxed text-slate-600">
      I&apos;m the <span className="font-semibold text-slate-800">TickXplore Assistant</span>. I
      can help with bookings, buses, vehicles, stays, payments and refunds — and if you&apos;re
      signed in, I can look up your own bookings too.
    </p>

    <p className="mt-3.5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      How can I help you?
    </p>

    <div className="grid gap-1.5">
      {QUICK_ACTIONS.map(({ label, question, Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(question)}
          className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-all duration-150 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-white">
            <Icon size={13} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">{label}</span>
          <span
            aria-hidden="true"
            className="shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500"
          >
            →
          </span>
        </button>
      ))}
    </div>
  </div>
);

export default ChatWelcome;
