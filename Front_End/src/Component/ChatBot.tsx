import { useState, useEffect, useRef } from "react";
import { FaPaperPlane, FaCommentDots, FaTimes } from "react-icons/fa";
import { BeatLoader } from "react-spinners";
import { api } from "../api";

interface ChatMessage {
  from: "user" | "bot";
  text: string;
}

interface TouristEntry {
  location?: string;
  info?: string;
  [key: string]: unknown;
}

const ChatBot = () => {
  const [userInput, setUserInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [touristData, setTouristData] = useState<TouristEntry[]>([]);

  const apiKey = import.meta.env.VITE_HF_API_KEY as string | undefined;
  const MODEL_URL =
    "https://api-inference.huggingface.co/models/TinyLlama/TinyLlama-1.1B-Chat-v1.0";

  useEffect(() => {
    fetch("/tourist-info.json")
      .then((res) => res.json())
      .then((data) => setTouristData(data))
      .catch((err) => console.error("Failed to load tourist info:", err));
  }, []);

  const handleSend = async () => {
    const trimmed = userInput.trim();
    if (!trimmed || isLoading) return;

    setMessages((prev) => [...prev, { from: "user", text: trimmed }]);
    setIsLoading(true);
    setUserInput("");

    try {
      const exactMatch = touristData.find(
        (entry) =>
          (entry.location || "").toLowerCase() === trimmed.toLowerCase()
      );

      if (exactMatch && exactMatch.info) {
        setMessages((prev) => [
          ...prev,
          { from: "bot", text: exactMatch.info || "Sorry, I couldn't find that." },
        ]);
        setIsLoading(false);
        return;
      }

      const partialMatches = touristData.filter((entry) =>
        trimmed.toLowerCase().includes((entry.location || "").toLowerCase())
      );

      let prompt: string;
      if (partialMatches.length > 0) {
        const context = partialMatches
          .map((e) => e.info)
          .filter(Boolean)
          .join("\n")
          .slice(0, 500);
        prompt = `<|user|>\nPlease answer the following question strictly based on the context.\nQuestion: ${trimmed}\nContext: ${context}\n<|assistant|>`;
      } else {
        prompt = `<|user|>\n${trimmed}\n<|assistant|>`;
      }

      if (!apiKey) {
        setMessages((prev) => [
          ...prev,
          {
            from: "bot",
            text: "The AI assistant is not configured server-side yet. Please ask about a tourist destination listed on our Tourist Areas page.",
          },
        ]);
        setIsLoading(false);
        return;
      }

      const response = await api.post(MODEL_URL, { inputs: prompt }, {
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
      });

      const generated =
        (response.data as Array<{ generated_text?: string }>)?.[0]?.generated_text;
      const reply = generated?.replace(prompt, "").trim() || "No response from TinyLlama.";
      setMessages((prev) => [...prev, { from: "bot", text: reply }]);
    } catch (error) {
      const errorText =
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
        "Failed to contact TinyLlama. Please try again.";
      setMessages((prev) => [...prev, { from: "bot", text: errorText }]);
    }

    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSend();
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          from: "bot",
          text: "Hello! Welcome to TickXplore.\n\nYou can ask about:\n- Tourist places \n- Vehicle/bus availability\n- Booking and refunds",
        },
      ]);
    }
  }, [isOpen, messages.length]);

  return (
    <>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="fixed bottom-4 left-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-card-lg transition-colors hover:bg-blue-700"
        aria-label={isOpen ? "Close chat" : "Open chat"}
        
      >
        {isOpen ? <FaTimes size={20} /> : <FaCommentDots size={22} />}
      </button>

      {isOpen && (
        <div className="fixed bottom-20 right-4 z-50 flex max-h-[calc(100vh-7rem)] w-[350px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card-lg">
          <div className="bg-slate-900 border-b border-white/10 px-4 py-4 text-center">
            <h3 className="text-lg font-semibold text-white">TickXplore ChatBot</h3>
            <p className="text-xs text-slate-400">Ask about tourist places & booking</p>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm ${
                  msg.from === "user"
                    ? "ml-auto self-end bg-blue-600 text-white"
                    : "mr-auto self-start bg-slate-100 text-slate-800"
                }`}
              >
                {msg.text}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-center py-2">
                <BeatLoader size={6} color="#2563eb" />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-2">
            <input
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              type="text"
              placeholder="Type your message..."
              className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !userInput.trim()}
              className={`rounded-full p-2.5 text-white transition-colors ${
                isLoading || !userInput.trim()
                  ? "bg-slate-300"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
              aria-label="Send message"
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