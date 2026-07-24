/** @type {import('tailwindcss').Config} */
// Design tokens mirror the AJN web design system (brand teal + neutral slate)
// so the mobile app reads as the same product. Dark mode via class strategy,
// driven by NativeWind's colorScheme.
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0f766e",
          50: "#f0fdfa",
          100: "#ccfbf1",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          900: "#134e4a",
        },
        // Stage accent colors, keyed by workflow phase.
        stage: {
          idle: "#64748b",
          prep: "#0ea5e9",
          transit: "#f59e0b",
          active: "#8b5cf6",
          done: "#16a34a",
          problem: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};
