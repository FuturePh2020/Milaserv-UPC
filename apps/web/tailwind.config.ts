import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#273148",
          "navy-dark": "#202A3D",
          teal: "#16B5B0",
          turquoise: "#24C8C2",
          white: "#FFFFFF",
          surface: "#F4F6F9",
          "text-gray": "#667085",
          "text-dark": "#1D2939",
          success: "#12B76A",
          warning: "#F79009",
          danger: "#F04438",
        },
      },
    },
  },
  plugins: [],
};

export default config;
