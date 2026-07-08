import { cn } from "@/lib/utils";

const styles = {
  on: "bg-led shadow-[0_0_6px_1px_hsl(var(--led)/0.6)]",
  warn: "bg-vfd shadow-[0_0_6px_1px_hsl(var(--vfd)/0.55)]",
  err: "bg-signal shadow-[0_0_6px_1px_hsl(var(--signal-red)/0.5)]",
  off: "bg-muted-foreground/30",
} as const;

export function LedLamp({ state, className, title }: { state: keyof typeof styles; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-block h-2 w-2 rounded-full", styles[state], className)} />;
}
