import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Engraved panel label + hairline rule with an optional right-side action slot.
 * Replaces legacy section <h2>s across the app.
 */
export function PanelHeader({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("scanlines flex items-center justify-between gap-3 border-b border-border/70 pb-2", className)}>
      <span className="panel-label">{children}</span>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
