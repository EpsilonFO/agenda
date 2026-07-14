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
        display: ["Sora", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f5f6fc",
          sunken: "#ecedf7",
        },
        ink: {
          DEFAULT: "#1a1930",
          soft: "#6a6982",
          faint: "#a2a0b8",
        },
        brand: {
          DEFAULT: "#6366f1",
          600: "#5558e3",
          700: "#4749c9",
          soft: "#eef0ff",
        },
        accent: {
          DEFAULT: "#8b5cf6",
          soft: "#f2ecfe",
        },
        line: "rgba(26, 25, 48, 0.08)",
        "line-strong": "rgba(26, 25, 48, 0.14)",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(26,25,48,0.04), 0 4px 12px rgba(26,25,48,0.05)",
        lift: "0 10px 28px -10px rgba(26,25,48,0.22)",
        panel: "0 28px 70px -26px rgba(26,25,48,0.32)",
        glow: "0 14px 34px -10px rgba(99,102,241,0.5)",
        "glow-sm": "0 8px 20px -8px rgba(99,102,241,0.45)",
        "inset-hi": "inset 0 1px 0 rgba(255,255,255,0.65)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
        "brand-gradient-hover": "linear-gradient(135deg, #5558e3 0%, #7c4ff2 100%)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
};

export default config;
