import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        teal: {
          50: "#fff5f8",
          100: "#fceaf1",
          200: "#f8dce7",
          300: "#f3d5e0",
          400: "#efbdce",
          500: "#e8a0b8",
          600: "#d989a7",
          700: "#e8a0b8",
          800: "#f8dce7",
          800: "#f8dce7",
          900: "#805363",
          950: "#344054"
        },
        medical: {
          50: "#fff5f8",
          100: "#fceaf1",
          200: "#f8dce7",
          300: "#f3d5e0",
          400: "#e8a0b8",
          500: "#e8a0b8",
          600: "#d989a7",
          700: "#e8a0b8",
          800: "#f8dce7",
          900: "#344054"
        }
      },
      minHeight: { touch: "48px" },
      minWidth: { touch: "48px" }
    }
  },
  plugins: []
} satisfies Config;
