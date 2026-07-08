import type { Config } from "tailwindcss";

export default {
  darkMode: ["class", ".light &"] as unknown as Config["darkMode"], // dark default; .light opts out
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // `.light` (and panel utilities used by later tasks) aren't referenced in markup
  // yet, so Tailwind's content tree-shaking would purge these hand-written @layer
  // rules. Safelist keeps the light-mode override + panel atmosphere intact.
  safelist: ["light", "grain", "panel-label", "scanlines", "bevel", "led-glow", "press"],
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
