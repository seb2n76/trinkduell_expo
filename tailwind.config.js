/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        slate: {
          950: "#020617",
        },
        fuchsia: {
          500: "#d946ef",
        },
        cyan: {
          400: "#22d3ee",
        },
        emerald: {
          500: "#10b981",
        },
        yellow: {
          400: "#facc15",
        },
        rose: {
          500: "#f43f5e",
        },
      },
    },
  },
  plugins: [],
}
