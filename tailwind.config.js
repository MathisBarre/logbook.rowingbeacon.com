const colors = require("tailwindcss/colors");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    fontFamily: {
      sans: "Roboto, Inter, sans-serif",
      mono: "Roboto Mono, monospace, mono",
    },
    colors: {
      white: colors.white,
      gray: colors.gray,
      success: colors.green,
      error: colors.red,
      blue: colors.blue,
      yellow: colors.yellow,
      black: colors.black,
      "steel-blue": {
        50: "#f3f6fc",
        100: "#e7eef7",
        200: "#c9d9ee",
        300: "#99bae0",
        400: "#6296ce",
        500: "#4480c1",
        600: "#2d5f9c",
        700: "#254c7f",
        800: "#22426a",
        900: "#213859",
        950: "#16243b",
      },
    },
    extend: {
      borderWidth: {
        6: "6px",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/forms")],
};
