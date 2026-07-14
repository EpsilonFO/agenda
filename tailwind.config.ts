import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f7f8fa",
        },
        ink: {
          DEFAULT: "#1a1a2e",
          soft: "#5b5b6e",
        },
        brand: {
          DEFAULT: "#6366f1",
          soft: "#eef0ff",
        },
      },
      boxShadow: {
        soft: "0 1px 3px rgba(16, 24, 40, 0.06), 0 1px 2px rgba(16, 24, 40, 0.04)",
        panel: "0 10px 40px -12px rgba(16, 24, 40, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
