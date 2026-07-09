import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { importBundle } from "@/lib/importBundle";
import { db } from "@/lib/idb";
import { deleteSetAudio } from "@/lib/opfs";
import type { StoredSet } from "@/lib/types";

type Progress = { done: number; total: number; label: string };
type ImportError = { name: string; message: string };

const EVICTION_WARNING =
  "iOS may evict imported audio under disk pressure. Keep the .crate in Files; cues are always safe.";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function ImportScreen({ onOpenSet }: { onOpenSet: (stem: string) => void }) {
  const [sets, setSets] = useState<StoredSet[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredSet | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const rows = await db.listSets();
    rows.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    setSets(rows);
  };

  useEffect(() => {
    void refresh();
    // Ask for durable storage; if the grant is false or the API is absent, we
    // surface the eviction warning so Helen keeps the .crate around.
    void (async () => {
      try {
        const ok = await navigator.storage?.persist?.();
        setPersisted(ok ?? false);
      } catch {
        setPersisted(false);
      }
    })();
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;
    setError(null);
    setImporting(true);
    setProgress({ done: 0, total: 0, label: "Reading manifest…" });
    try {
      const stored = await importBundle(file, (done, total, label) =>
        setProgress({ done, total, label }),
      );
      await refresh();
      toast.success(`Imported "${stored.name}"`);
      onOpenSet(stored.stem);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError({ name: file.name, message });
      toast.error(`Couldn't import ${file.name}`);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteSetAudio(target.stem);
      await db.deleteSet(target.stem);
      await db.deleteCues(target.stem);
      for (const t of target.manifest.tracks) await db.deletePeaks(target.stem, t.id);
      await refresh();
      toast.success(`Deleted "${target.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="grain min-h-dvh flex flex-col items-center p-6">
      <div className="w-full max-w-md space-y-4 pt-8">
        <Card className="bevel">
          <CardHeader>
            <p className="panel-label">Flight Deck</p>
            <CardTitle className="font-display text-3xl tracking-tight text-led led-glow">
              Flightcase
            </CardTitle>
            <CardDescription>
              AirDrop a <code>.crate</code> bundle from Crate, then place hot cues and loops while you
              fly. Your work comes home as rekordbox hot cues.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {persisted === false && (
              <div className="flex gap-2 rounded-md border border-vfd/40 bg-vfd/10 p-3 text-sm text-vfd">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{EVICTION_WARNING}</span>
              </div>
            )}

            <input
              ref={fileInput}
              type="file"
              accept=".crate,.zip"
              className="sr-only"
              onChange={onFile}
              disabled={importing}
            />
            <Button
              type="button"
              size="lg"
              className="press h-14 w-full text-base"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              {importing ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Upload className="size-5" />
              )}
              {importing ? "Importing…" : "Import a .crate bundle"}
            </Button>

            {progress && (
              <div className="space-y-1.5">
                <div className="h-2 overflow-hidden rounded-full border border-border bg-secondary">
                  <div
                    className="h-full bg-led transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono text-xs text-muted-foreground">
                  <span className="truncate">{progress.label}</span>
                  {progress.total > 0 && (
                    <span className="shrink-0 pl-2">
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </div>
              </div>
            )}

            {error && !importing && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <p className="font-medium text-destructive">Couldn&apos;t import {error.name}</p>
                <p className="mt-1 text-muted-foreground">{error.message}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {sets.length > 0 && (
          <Card className="bevel">
            <CardHeader className="pb-2">
              <p className="panel-label">Imported Sets</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {sets.map((s, i) => (
                <div key={s.stem}>
                  {i > 0 && <Separator className="mb-2" />}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="press min-w-0 flex-1 rounded-md py-2 text-left"
                      onClick={() => onOpenSet(s.stem)}
                    >
                      <p className="truncate font-medium">{s.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="font-mono">
                          {s.manifest.tracks.length} tracks
                        </Badge>
                        <span>{formatDate(s.importedAt)}</span>
                      </div>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="size-5" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the imported audio <strong>and its cues and loops</strong> from
              this device. You can re-import the audio from the <code>.crate</code>, but any cues you
              placed for this set will be gone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete set
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
