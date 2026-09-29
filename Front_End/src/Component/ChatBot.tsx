/**
 * TickXplore chat window.
 * ------------------------------------------------------------------
 * This component used to call the Hugging Face API directly from the browser,
 * which meant the API key had to be shipped to every visitor in a
 * `VITE_HF_API_KEY`. That key is gone: all requests now go to our own
 * `POST /api/chatbot`, and the Hugging Face token stays on the server.
 *
 * The backend also does things a browser cannot: it reads TickXplore's
 * knowledge base (RAG), queries the real database for buses, vehicles,
 * hotels and the signed-in user's own bookings, and requires an explicit
 * confirmation before anything is changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCommentDots, FaPaperPlane, FaTimes } from "react-icons/fa";
import { BeatLoader } from "react-spinners";
import { chatApi, type ChatResponse, type PendingAction } from "../api";

type Role = "user" | "assistant";

interface Turn {
  role: Role;
  content: string;
}

interface Bubble extends Turn {
  /** Knowledge documents the backend cited for this answer. */
  sources?: string[];
}

const GREETING =
  "Hi! I'm the TickXplore assistant. Ask me about bookings, buses and vehicles, " +
  "stays, payments, refunds or how to sell on TickXplore. If you're signed in, " +
  "I can also look up your own bookings and payment status.";

const OPEN_LABEL = "Open the TickXplore assistant";
const CLOSE_LABEL = "Close the TickXplore assistant";

/** The message shown when the backend returns `success: false`. */
const friendlyError = (error: unknown): string => {
  const response = error as {
    response?: { status?: number; data?: { message?: string } };
  };
  const fromServer = response?.response?.data?.message;
  if (fromServer) return fromServer;

  if (response?.response?.status === 429) {
    return "You're sending messages a little too quickly. Please wait a moment and try again.";
  }
  if (response?.response?.status === 502 || response?.response?.status === 503) {
    return "The assistant is temporarily unavailable. Please try again shortly.";
  }
  return "I couldn't reach the assistant. Please check your connection and try again.";
};

const ChatBot = () => {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // The turns we send back to the backend, without the citation metadata.
  const history = useCallback(
    () => messages.map(({ role, content }) => ({ role, content })),
    [messages]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Suggestion chips are static, so they only need fetching once.
  useEffect(() => {
    let cancelled = false;
    chatApi
      .starters()
      .then((data) => {
        if (!cancelled && Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
      })
      .catch(() => {
        /* The chat still works without chips; ignore the failure silently. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Send one message and fold the backend reply into the thread. */
  const send = useCallback(
    async (text: string, options: { confirm?: boolean; actionToken?: string } = {}) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      // The user's own turn is shown immediately so the thread feels responsive.
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setDraft("");
      setIsLoading(true);
      setPending(null);

      try {
        const data: ChatResponse = await chatApi.send({
          message: trimmed,
          conversation: history(),
          ...options,
        });

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply, sources: data.sources },
        ]);
        // A pending action replaces the chips: the user must decide, not ask something else.
        setPending(data.pendingAction ?? null);
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        }
      } catch (error) {
        setMessages((prev) => [...prev, { role: "assistant", content: friendlyError(error) }]);
      } finally {
        setIsLoading(false);
      }
    },
    [history, isLoading]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };

  const toggle = () => {
    setIsOpen((open) => {
      // Seed the thread with a greeting the first time the window opens.
      if (!open && messages.length === 0) {
        setMessages([{ role: "assistant", content: GREETING }]);
      }
      return !open;
    });
  };

  const confirmAction = () => {
    if (!pending) return;
    void send("Yes, please go ahead.", {
      confirm: true,
      actionToken: pending.token,
    });
  };

  const declineAction = () => {
    setPending(null);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "No problem — I haven't changed anything." },
    ]);
  };

  return (
    <>
      <button
        onClick={toggle}
        aria-label={isOpen ? CLOSE_LABEL : OPEN_LABEL}
        aria-expanded={isOpen}
        title={isOpen ? CLOSE_LABEL : OPEN_LABEL}
        className="fixed bottom-4 left-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-card-lg transition-colors hover:bg-blue-700"
      >
        {isOpen ? <FaTimes size={20} /> : <FaCommentDots size={22} />}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="TickXplore assistant"
          className="fixed bottom-20 left-4 z-50 flex max-h-[calc(100vh-7rem)] w-[350px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card-lg"
        >
          <div className="border-b border-white/10 bg-slate-900 px-4 py-4 text-center">
            <h3 className="text-lg font-semibold text-white">TickXplore Assistant</h3>
            <p className="text-xs text-slate-400">Booking, stays, payments and refunds</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((message, index) => (
              <div key={index} className="space-y-1">
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-4 py-2 text-sm ${
                    message.role === "user"
                      ? "ml-auto bg-blue-600 text-white"
                      : "mr-auto bg-slate-100 text-slate-800"
                  }`}
                >
                  {message.content}
                </div>
                {message.sources && message.sources.length > 0 && (
                  <p className="px-1 text-[11px] text-slate-400">
                    From: {message.sources.join(", ")}
                  </p>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-center py-2">
                <BeatLoader size={6} color="#2563eb" />
              </div>
            )}

            <div ref={endRef} />
          </div>

          {pending && (
            <div className="border-t border-amber-200 bg-amber-50 px-3 py-2">
              <p className="mb-2 text-xs text-amber-900">This needs your confirmation.</p>
              <div className="flex gap-2">
                <button
                  onClick={confirmAction}
                  disabled={isLoading}
                  className="flex-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {pending.label}
                </button>
                <button
                  onClick={declineAction}
                  disabled={isLoading}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  No, thanks
                </button>
              </div>
            </div>
          )}

          {!pending && suggestions.length > 0 && !isLoading && (
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              type="text"
              placeholder="Ask about bookings, buses, stays..."
              aria-label="Type your message"
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={() => void send(draft)}
              disabled={isLoading || !draft.trim()}
              aria-label="Send message"
              className={`rounded-full p-2.5 text-white transition-colors ${
                isLoading || !draft.trim() ? "bg-slate-300" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              <FaPaperPlane size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatBot;
