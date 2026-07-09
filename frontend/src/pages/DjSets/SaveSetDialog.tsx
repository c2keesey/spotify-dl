import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LedLamp } from "@/components/LedLamp";
import { api, ApiError } from "@/lib/api";
import type { DjTrack } from "@/lib/types";

/**
 * Save-to-rekordbox dialog. Names the set, shows a mono recap of the exact order
 * being written, and exports via `api.djExport`. Rekordbox-open is the one hard
 * failure (409): it renders *inline* (amber LED + "close rekordbox first") so
 * she can close rekordbox and retry without the dialog vanishing — every other
 * outcome is a toast. Existing playlists are never mutated (name collisions get
 * a "(2)" suffix server-side).
 */
export function SaveSetDialog({ tracks, setIds }: { tracks: DjTrack[]; setIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [locked, setLocked] = useState(false); // 409: rekordbox open
  const [cooldown, setCooldown] = useState(false); // brief post-save disable
  // Synchronous guard: a double-click fires both mousedowns before React can
  // re-render `save.isPending`, so without this the second click posts a second
  // export and rekordbox uniquifies it to "… (2)" (sdl-jzw).
  const inFlight = useRef(false);

  const save = useMutation({
    mutationFn: () => api.djExport(name.trim(), setIds),
    onSuccess: () => {
      toast.success(`Saved as "${name.trim()}"`);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 800);
      setOpen(false);
      setName("");
      setLocked(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setLocked(true); // inline, not a toast
      } else {
        toast.error(e instanceof ApiError ? e.detail : "Export failed");
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  function submit() {
    if (inFlight.current || save.isPending) return;
    if (name.trim().length === 0) return;
    inFlight.current = true;
    save.mutate();
  }

  const canSubmit = name.trim().length > 0 && !save.isPending && !cooldown;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setLocked(false);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={tracks.length === 0}>
          Save to rekordbox
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to rekordbox</DialogTitle>
          <DialogDescription>
            Existing playlists are never touched — name collisions get (2).
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (locked) setLocked(false);
            }}
            placeholder="Set name"
          />

          <ScrollArea className="h-48 rounded-md border border-border/60 bg-card">
            <ol className="divide-y divide-border/40 font-mono text-xs">
              {tracks.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="w-9 shrink-0 text-muted-foreground">{t.camelot ?? "—"}</span>
                  <span className="truncate text-foreground" title={t.title}>{t.title}</span>
                </li>
              ))}
            </ol>
          </ScrollArea>

          {locked && (
            <div className="flex items-center gap-2 rounded-md border border-vfd/40 bg-vfd/10 px-3 py-2 text-sm text-foreground">
              <LedLamp state="warn" />
              <span>rekordbox is open — close rekordbox first, then save.</span>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
