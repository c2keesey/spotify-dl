import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/PanelHeader";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Cron } from "@/lib/types";

const shortUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.hostname.replace("www.", "").replace("open.", "") + p.pathname;
  } catch { return u; }
};

// Ports legacy cronTitle / cronSub verbatim.
const cronTitle = (c: Cron) =>
  c.managed
    ? (c.label ? `→ ${c.label}` : (c.urls ?? []).map(shortUrl).join(", "))
    : c.command.split(" ").pop()!.split("/").pop()!;
const cronSub = (c: Cron) => {
  if (c.managed) {
    const n = (c.urls ?? []).length;
    return `${c.friendly} · ${n} link${n === 1 ? "" : "s"}`;
  }
  return `${c.friendly} · ${c.command.split("/").pop()}`;
};

/** Scheduled-crons list: power-switch toggle, managed-only edit/armed-delete. */
export function CronList({ editingId, onEdit, onDeleted }: {
  editingId: string | null;
  onEdit: (c: Cron) => void;
  /** Fired after a cron is deleted so the edit flow can drop stale edit state. */
  onDeleted?: (id: string) => void;
}) {
  const crons = useQuery({ queryKey: qk.crons, queryFn: api.crons, refetchInterval: 30000 });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.crons });
  const toggle = useMutation({ mutationFn: (id: string) => api.cronToggle(id), onSuccess: invalidate });
  const del = useMutation({
    mutationFn: (id: string) => api.cronDelete(id),
    onSuccess: (_, id) => { invalidate(); onDeleted?.(id); },
  });
  const list = crons.data ?? [];

  return (
    <section className="space-y-3">
      <PanelHeader>Scheduled</PanelHeader>
      {list.length === 0 ? (
        <p className="panel-label">No schedules yet.</p>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
          {list.map((c) => (
            <CronRow
              key={c.id}
              c={c}
              editing={c.id === editingId}
              onToggle={() => toggle.mutate(c.id)}
              onEdit={() => onEdit(c)}
              onDelete={() => del.mutate(c.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CronRow({ c, editing, onToggle, onEdit, onDelete }: {
  c: Cron;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const onDeleteClick = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 2500);
      return;
    }
    onDelete();
  };

  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5 transition-colors", !c.enabled && "opacity-50", editing && "bg-led/[0.06]")}>
      <Switch
        checked={c.enabled}
        onCheckedChange={onToggle}
        aria-label={`${c.enabled ? "Disable" : "Enable"} schedule ${cronTitle(c)}`}
        className="data-[state=checked]:bg-led data-[state=checked]:shadow-[0_0_6px_hsl(var(--led)/0.5)]"
      />
      <div className="min-w-0 flex-1" title={c.command}>
        <div className="truncate text-sm text-foreground">{cronTitle(c)}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{cronSub(c)}</div>
      </div>
      {c.managed ? (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} className={cn(editing && "text-led")}>Edit</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDeleteClick} className={cn(armed && "text-signal")}>
            {armed ? "Remove?" : "Delete"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
