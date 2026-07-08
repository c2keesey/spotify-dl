import { cn } from "@/lib/utils";
import { meterSegments, type Segment } from "@/lib/meter";

const CHASE_MS = 1100;

const litClass: Record<Exclude<Segment, "off">, string> = {
  green: "bg-led shadow-[0_0_3px_0_hsl(var(--led)/0.55)]",
  amber: "bg-vfd shadow-[0_0_3px_0_hsl(var(--vfd)/0.6)]",
};

/**
 * Segmented LED VU-meter — the signature retro element. Discrete 3px blocks with
 * 1.5px gaps: green fills from the left, tips into amber at the top of the range.
 * `indeterminate` runs a CSS-keyframe chase (scanning band) for unknown totals;
 * it dies under prefers-reduced-motion via the global animation kill-switch.
 */
export function VuMeter({
  pct = 0,
  count = 24,
  indeterminate = false,
  className,
}: {
  pct?: number;
  count?: number;
  indeterminate?: boolean;
  className?: string;
}) {
  const block = "h-[14px] w-[3px] rounded-[1px]";
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn("flex items-end gap-[1.5px]", className)}
    >
      {indeterminate
        ? Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={cn(block, "bg-led motion-safe:animate-[meterChase_1.1s_linear_infinite] opacity-[0.12]")}
              style={{ animationDelay: `${(i / count - 1) * CHASE_MS}ms` }}
            />
          ))
        : meterSegments(pct, count).map((seg, i) => (
            <span
              key={i}
              className={cn(block, seg === "off" ? "bg-foreground/[0.07]" : litClass[seg])}
            />
          ))}
    </div>
  );
}
