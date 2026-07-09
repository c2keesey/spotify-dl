import type { Config } from "tailwindcss";

export default {
  // No `dark:` variant is used — theming is a plain `.light` class toggled on
  // <html> against a dark-by-default `:root`, so no darkMode config is needed.
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // `.light` is only ever applied via classList.toggle(), never as a literal
  // className the content scanner can see, so it must be safelisted or the
  // light-mode override gets purged. The panel utilities (grain/bevel/…) all
  // appear as literal classNames in the source, so the scanner keeps them.
  safelist: ["light"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Chakra Petch"', "sans-serif"],
        sans: ['"IBM Plex Sans"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      colors: {
        border: "hsl(var(--border))", input: "hsl(var(--input))", ring: "hsl(var(--ring))",
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        led: "hsl(var(--led))", vfd: "hsl(var(--vfd))", signal: "hsl(var(--signal-red))",
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
    },
  },
  plugins: [],
} satisfies Config;
