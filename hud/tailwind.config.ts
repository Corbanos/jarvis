import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "arc-cyan": "#00d4ff",
        "electric-blue": "#0066cc",
        "warning-amber": "#ff9500",
        "online-green": "#00ff88",
      },
      fontFamily: {
        mono: ["'Courier New'", "Courier", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
