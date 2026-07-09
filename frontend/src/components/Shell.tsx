import { useEffect, useState, type ComponentType } from "react";
import { Disc3, Download, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { LedLamp } from "./LedLamp";

type Page = "download" | "dj";

function useTheme() {
  const [light, setLight] = useState(() => localStorage.getItem("theme") === "light");
  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
    localStorage.setItem("theme", light ? "light" : "dark");
  }, [light]);
  return { light, toggle: () => setLight((v) => !v) };
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  delay,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  delay: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{ animationDelay: delay }}
      className={cn(
        "press grid h-10 w-10 place-items-center rounded-md border transition-colors",
        "animate-[fadeUp_.4s_ease_both]",
        active
          ? "border-border bg-secondary text-led led-glow"
          : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.25 : 1.75} />
    </button>
  );
}

export function Shell({
  page,
  onPageChange,
  wide,
  children,
}: {
  page: Page;
  onPageChange: (p: Page) => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const { light, toggle } = useTheme();

  return (
    <div className="grain relative min-h-screen">
      <div className="flex">
        <aside className="sticky top-0 z-10 flex h-screen w-14 flex-col items-center gap-2 border-r border-border bg-card/40 py-4 bevel">
          {/* CRATE wordmark tile */}
          <div
            style={{ animationDelay: "0ms" }}
            className="grid h-10 w-10 place-items-center rounded-md border border-border bg-secondary bevel animate-[fadeUp_.4s_ease_both]"
            title="Crate"
          >
            <span className="font-display text-[15px] font-semibold leading-none tracking-tight text-led drop-shadow-[0_0_5px_hsl(var(--led)/0.6)]">
              CR
            </span>
          </div>

          <div className="my-1 h-px w-6 bg-border" />

          <RailButton
            icon={Download}
            label="Download"
            active={page === "download"}
            onClick={() => onPageChange("download")}
            delay="60ms"
          />
          <RailButton
            icon={Disc3}
            label="DJ Sets"
            active={page === "dj"}
            onClick={() => onPageChange("dj")}
            delay="100ms"
          />

          <div className="flex-1" />

          <RailButton
            icon={light ? Moon : Sun}
            label="Toggle theme"
            onClick={toggle}
            delay="160ms"
          />

          {/* localhost status */}
          <div
            style={{ animationDelay: "220ms" }}
            className="mt-1 flex flex-col items-center gap-1 animate-[fadeUp_.4s_ease_both]"
          >
            <LedLamp state="on" title="serving on localhost" className="animate-[ledBlink_.9s_ease_.45s_1]" />
            <span className="font-mono text-[8px] leading-none tracking-tight text-muted-foreground">localhost</span>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <main
            className={cn(
              "w-full px-6 py-8 md:px-10 md:py-12",
              // DJ Sets goes full-bleed to the viewport; Download keeps its
              // narrower centered reading column.
              wide ? "" : "mx-auto max-w-[720px]",
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
