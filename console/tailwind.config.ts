import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b1220",
          900: "#111a2e",
          800: "#1a2540",
          700: "#243252",
        },
        pulse: {
          400: "#4fd1c5",
          500: "#38b2ac",
        },
      },
      keyframes: {
        "fade-cycle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        // Marks a message bubble that is still streaming.
        "pulse-slow": "fade-cycle 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
