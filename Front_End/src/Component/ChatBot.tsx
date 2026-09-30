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
 *
 * This file owns state and orchestration only; the pieces it renders live in
 * `./chat/`. Nothing here talks to Hugging Face, and the request/response
 * contract with `POST /api/chatbot` is unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FaArrowDown } from "react-icons/fa";
import { chatApi, type ChatResponse, type PendingAction } from "../api";
import ChatComposer from "./chat/ChatComposer";
import ChatHeader from "./chat/ChatHeader";
import ChatLauncher from "./chat/ChatLauncher";
import ChatMessage, { type MessageBubble } from "./chat/ChatMessage";
import ChatWelcome from "./chat/ChatWelcome";
import PendingActionBar from "./chat/PendingActionBar";
import SuggestionChips from "./chat/SuggestionChips";
import TypingIndicator from "./chat/TypingIndicator";
import { STICK_TO_BOTTOM_PX, formatTime, type StatusKind } from "./chat/chatTheme";

const PANEL_ID = "tickxplore-chat-panel";
const TITLE_ID = "tickxplore-chat-title";
const HINT_ID = "tickxplore-chat-hint";

/** A reply arriving faster than this still gets a beat of "typing". */
const MIN_LOADING_MS = 400;

interface SendOptions {
  confirm?: boolean;
  actionToken?: string;
}

/**
 * The message shown when the backend returns `success: false`.
 *
 * The server already turns upstream failures into short, user-safe copy and
 * keeps stack traces, database errors and file paths to itself. We pass those
 * messages through, but only when they look like a sentence — a guard against an
 * error page or some other unexpected blob ever being rendered as a chat bubble.
 */
const friendlyError = (error: unknown): string => {
  const response = error as {
    response?: { status?: number; data?: { message?: unknown } };
  };
  const fromServer = response?.response?.data?.message;
  if (typeof fromServer === "string" && fromServer.trim().length > 0 && fromServer.length <= 300) {
    return fromServer;
  }

  const status = response?.response?.status;
  if (status === 429) {
    return "You're sending messages a little too quickly. Please wait a moment and try again.";
  }
  if (status === 401 || status === 403) {
    return "I couldn't verify your account for that. Please sign in and try again.";
  }
  if (status === 402 || status === 502 || status === 503 || status === 504) {
    return "The assistant is very busy right now. Please try again in a moment.";
  }
  if (status === 400) {
    return "I couldn't send that message. Could you rephrase it?";
  }
  return "I couldn't reach the assistant. Please check your connection and try again.";
};

/** True when the request never got an HTTP response back at all. */
const isNetworkError = (error: unknown): boolean => {
  const response = error as { response?: unknown; request?: unknown };
  return !response?.response && Boolean(response?.request);
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

const ChatBot = () => {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MessageBubble[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Parked at the bottom? If not, a new message must not yank the view. */
  const stickToBottomRef = useRef(true);
  /** The turn to resend if a request fails. */
  const retryRef = useRef<{ text: string; options: SendOptions } | null>(null);
  /**
   * Whether a request is in flight. A ref rather than `isLoading`, because the
   * retry button is built inside a state updater that closes over an older
   * render — reading the state there would give a stale `false`/`true` and
   * either drop the retry or let two requests overlap.
   */
  const inFlightRef = useRef(false);

  /**
   * The turns we send back to the backend, without the citation metadata.
   *
   * Error bubbles are skipped: they are our own UI copy, not something the
   * assistant said, and feeding them back would put a "Message not delivered"
   * line into the model's context.
   */
  const history = useCallback(
    () =>
      messages
        .filter((message) => !message.isError)
        .map(({ role, content }) => ({ role, content })),
    [messages]
  );

  const jumpToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setShowJumpButton(false);
  }, []);

  /* Only follow new messages when the user is already at the bottom. */
  useEffect(() => {
    if (!isOpen) return;
    if (!stickToBottomRef.current) {
      setShowJumpButton(true);
      return;
    }
    // Wait for the browser to lay the new bubble out before measuring.
    const frame = requestAnimationFrame(() => jumpToBottom(prefersReducedMotion() ? "auto" : "smooth"));
    return () => cancelAnimationFrame(frame);
  }, [messages, isLoading, isOpen, jumpToBottom]);

  /* Track whether the user is parked at the bottom, so we stop stealing scroll. */
  const handleThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance <= STICK_TO_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    setShowJumpButton(!atBottom);
  };

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
    async (text: string, options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed || inFlightRef.current) return;

      // The user's own turn is shown immediately so the thread feels responsive.
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed, at: Date.now(), animate: true },
      ]);
      setDraft("");
      setIsLoading(true);
      setHasError(false);
      setPending(null);
      // A new question means we want the newest turn, whatever we were reading.
      stickToBottomRef.current = true;
      setShowJumpButton(false);
      retryRef.current = { text: trimmed, options };
      inFlightRef.current = true;

      // A fast reply should still register as "typing" rather than flashing past.
      const minimumDelay = new Promise<void>((resolve) =>
        window.setTimeout(resolve, MIN_LOADING_MS)
      );

      try {
        const data: ChatResponse = await chatApi.send({
          message: trimmed,
          conversation: history(),
          ...options,
        });
        await minimumDelay;

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.reply,
            // `data.sources` is intentionally dropped. The backend still sends
            // the knowledge documents it used, but their values are raw
            // filenames, which is internal plumbing rather than something a
            // visitor can act on.
            at: Date.now(),
            animate: true,
          },
        ]);
        retryRef.current = null;
        // A pending action replaces the chips: the user must decide, not ask something else.
        setPending(data.pendingAction ?? null);
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
        }
      } catch (error) {
        await minimumDelay;
        const attempt = retryRef.current;

        setMessages((prev) => {
          const next = prev.slice();
          // Drop the optimistic user turn so "Try again" does not duplicate it.
          if (next[next.length - 1]?.role === "user") next.pop();

          return [
            ...next,
            {
              role: "assistant",
              content: friendlyError(error),
              isError: true,
              at: Date.now(),
              animate: true,
              // `inFlightRef` is cleared in `finally`, which runs before the user
              // can click, so this re-entry is accepted rather than dropped.
              retry: attempt
                ? () => {
                    setHasError(false);
                    void send(attempt.text, attempt.options);
                  }
                : undefined,
            },
          ];
        });
        setHasError(true);

        // A dropped connection will not fix itself on an instant retry, so we stop
        // remembering the turn and let the user rephrase instead.
        if (isNetworkError(error)) retryRef.current = null;
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [history]
  );

  /* ---- open / close / reset ---- */

  const open = useCallback(() => {
    setIsOpen(true);
    stickToBottomRef.current = true;
    // Focus the composer, but only once the panel has actually mounted.
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  /** Collapse the window and hand focus back to the launcher. */
  const dismiss = useCallback(() => {
    setIsOpen(false);
    setShowJumpButton(false);
    stickToBottomRef.current = true;
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  /** Close: dismiss, and drop any half-finished confirmation. */
  const close = useCallback(() => {
    setPending(null);
    setHasError(false);
    dismiss();
  }, [dismiss]);

  /** Start over: empty the thread, keeping the window open. */
  const reset = useCallback(() => {
    setMessages([]);
    setPending(null);
    setHasError(false);
    setDraft("");
    setShowJumpButton(false);
    stickToBottomRef.current = true;
    retryRef.current = null;
    window.requestAnimationFrame(() => {
      threadRef.current?.scrollTo({ top: 0 });
      inputRef.current?.focus();
    });
  }, []);

  const toggle = () => {
    if (isOpen) {
      dismiss();
    } else {
      open();
    }
  };

  /* ---- keyboard + viewport ---- */

  // Escape collapses the window, from anywhere inside it.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, dismiss]);

  /**
   * Keep the window inside the visible viewport.
   *
   * `100vh` does not shrink when a mobile keyboard opens, so a bottom-anchored
   * panel ends up hidden behind it. `visualViewport` reports the real height and
   * we hand it to the panel as `--chat-vh` (see `.chat-vh-cap` in index.css).
   */
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const viewport = window.visualViewport;
    if (!panel || !viewport) return;

    const sync = () => panel.style.setProperty("--chat-vh", `${viewport.height}px`);
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, [isOpen]);

  /* ---- derived ---- */

  const status: StatusKind = isLoading ? "typing" : hasError ? "error" : "online";
  /** No turns yet — show the welcome state instead of an empty box. */
  const isWelcome = messages.length === 0;
  const asked = messages.filter((m) => m.role === "user").map((m) => m.content);

  return (
    <>
      <ChatLauncher
        isOpen={isOpen}
        onToggle={toggle}
        panelId={PANEL_ID}
        buttonRef={launcherRef}
      />

      {isOpen && (
        <div
          id={PANEL_ID}
          ref={panelRef}
          role="dialog"
          aria-labelledby={TITLE_ID}
          className="chat-vh-cap animate-chat-panel-in fixed bottom-[max(5.25rem,env(safe-area-inset-bottom))] left-3 z-[60] flex w-[calc(100vw-1.5rem)] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card-lg sm:bottom-[5.5rem] sm:left-6"
        >
          <ChatHeader
            status={status}
            titleId={TITLE_ID}
            onMinimize={dismiss}
            onClose={close}
            onReset={reset}
            canReset={!isWelcome && !isLoading}
          />

          <div
            ref={threadRef}
            onScroll={handleThreadScroll}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={isLoading}
            aria-label="Conversation with the TickXplore Assistant"
            className="chat-scroll relative flex-1 space-y-3 overflow-y-auto px-3 py-3.5"
          >
            {isWelcome ? (
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-bold leading-none text-blue-600 ring-1 ring-blue-100"
                >
                  T
                </span>
                <div className="min-w-0 flex-1">
                  <ChatWelcome onPick={(question) => void send(question)} />
                  <p className="mt-3.5 border-t border-slate-100 pt-2.5 text-[11px] leading-relaxed text-slate-500">
                    I can help with general travel questions too, but I&apos;ll always point you to
                    TickXplore support for anything account-specific.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <ChatMessage
                  key={`${message.role}-${index}-${message.at ?? 0}`}
                  bubbleKey={`${message.role}-${index}`}
                  message={message}
                  time={message.at ? formatTime(message.at) : ""}
                />
              ))
            )}

            {isLoading && <TypingIndicator />}
            {/* The dots above are decorative, so tell screen readers separately. */}
            {isLoading && <p className="sr-only">The TickXplore Assistant is typing a reply…</p>}
          </div>

          {/* Offered instead of yanking the view when the user is reading back. */}
          {showJumpButton && (
            <div className="pointer-events-none relative">
              <button
                type="button"
                onClick={() => jumpToBottom()}
                className="pointer-events-auto absolute -top-10 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-slate-600 shadow-card transition-colors hover:border-blue-300 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 animate-fade-in"
              >
                <FaArrowDown size={11} aria-hidden="true" />
                Jump to latest
              </button>
            </div>
          )}

          {pending && (
            <PendingActionBar
              pending={pending}
              isLoading={isLoading}
              onConfirm={() => {
                if (!pending) return;
                void send("Yes, please go ahead.", {
                  confirm: true,
                  actionToken: pending.token,
                });
              }}
              onDecline={() => {
                setPending(null);
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: "No problem — I haven't changed anything.",
                    at: Date.now(),
                    animate: true,
                  },
                ]);
              }}
            />
          )}

          {!isWelcome && !pending && !isLoading && (
            <SuggestionChips
              suggestions={suggestions}
              asked={asked}
              onPick={(question) => void send(question)}
            />
          )}

          <ChatComposer
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void send(draft)}
            isLoading={isLoading}
            inputRef={inputRef}
            hintId={HINT_ID}
          />
        </div>
      )}
    </>
  );
};

export default ChatBot;
