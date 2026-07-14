import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Manrope",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        display: ["Manrope", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        surface: {
          DEFAULT: "#101d31", // panneau opaque (agenda)
          muted: "#0a1526", // fond de l'app
          sunken: "#0c1728",
          raised: "#16253c",
        },
        ink: {
          DEFAULT: "#e9f1f7",
          soft: "#9db0c2",
          faint: "#5f7286",
        },
        brand: {
          DEFAULT: "#2dd4bf",
          600: "#14b8a6",
          700: "#0d9488",
          ink: "#04211f", // texte sur aplat de marque
        },
        accent: {
          DEFAULT: "#38bdf8",
        },
        line: "rgba(255, 255, 255, 0.08)",
        "line-strong": "rgba(255, 255, 255, 0.16)",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.3), 0 8px 24px -12px rgba(0,0,0,0.5)",
        lift: "0 14px 40px -14px rgba(0,0,0,0.6)",
        panel: "0 30px 80px -32px rgba(0,0,0,0.7)",
        glow: "0 14px 40px -12px rgba(45,212,191,0.38)",
        "glow-sm": "0 8px 24px -10px rgba(45,212,191,0.34)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #2dd4bf 0%, #38bdf8 100%)",
        "brand-gradient-hover":
          "linear-gradient(135deg, #14b8a6 0%, #0ea5e9 100%)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
};

export default config;
