/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/tw-elements-react/dist/js/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        dark: {
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 4px 24px -8px rgba(15, 23, 42, 0.12)",
        "card-lg": "0 12px 40px -12px rgba(15, 23, 42, 0.18)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        /* Chat window opening: rises and settles, like a real panel. */
        "chat-panel-in": {
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.97)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        /* Individual bubbles arriving, staggered by the inline animation-delay. */
        "chat-bubble-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        /* The three-dot "typing" indicator. */
        "chat-typing-dot": {
          "0%, 60%, 100%": { opacity: "0.25", transform: "translateY(0)" },
          "30%": { opacity: "1", transform: "translateY(-3px)" },
        },
        /* The launcher's one-time attention ping. Plays once, then the class drops. */
        "chat-ping": {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "70%, 100%": { transform: "scale(1.9)", opacity: "0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s ease-out both",
        "fade-in": "fade-in 0.4s ease-out both",
        "chat-panel-in": "chat-panel-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both",
        "chat-bubble-in": "chat-bubble-in 0.18s ease-out both",
        "chat-typing-dot": "chat-typing-dot 1.1s ease-in-out infinite",
        "chat-ping": "chat-ping 1.6s cubic-bezier(0, 0, 0.2, 1) 2 both",
      },
    },
  },
  plugins: [],
};