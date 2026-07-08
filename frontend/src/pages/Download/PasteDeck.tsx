import { type KeyboardEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Folder } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { LinkMeta } from "@/lib/types";
import { type PreviewState, type Previews } from "./usePreviews";

const ART = "h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border/70 bg-secondary bg-cover bg-center text-sm";

const shortUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.hostname.replace("www.", "").replace("open.", "") + p.pathname;
  } catch {
    return u;
  }
};

function PreviewRow({ url, state }: { url: string; state?: PreviewState }) {
  if (!state || state === "loading") {
    return (
      <Row art={<span className={ART} />} name={shortUrl(url)} meta="Loading…">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-led shadow-[0_0_5px_hsl(var(--led)/0.5)]" />
      </Row>
    );
  }
  if (state.error) {
    return (
      <Row
        art={<span className={cn(ART, "grid place-items-center text-vfd")}>!</span>}
        name={state.name || shortUrl(url)}
        meta={state.error}
        tone="err"
      />
    );
  }
  const p = state as LinkMeta;
  const art = p.image ? (
    <span className={ART} style={{ backgroundImage: `url('${p.image}')` }} />
  ) : (
    <span className={cn(ART, "grid place-items-center text-muted-foreground")}>{p.kind === "soundcloud" ? "☁" : "♪"}</span>
  );
  const meta = p.count ? `${p.count} track${p.count === 1 ? "" : "s"}` : p.kind === "soundcloud" ? "SoundCloud" : "";
  return (
    <Row art={art} name={p.name || shortUrl(url)} meta={meta}>
      {p.kind ? (
        <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {p.kind}
        </Badge>
      ) : null}
    </Row>
  );
}

function Row({ art, name, meta, tone, children }: { art: ReactNode; name: string; meta: string; tone?: "err"; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      {art}
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", tone === "err" ? "text-vfd" : "text-foreground")}>{name}</div>
        <div className={cn("truncate font-mono text-xs", tone === "err" ? "text-vfd/80" : "text-muted-foreground")}>{meta}</div>
      </div>
      {children}
    </div>
  );
}

export function PasteDeck({
  text,
  setText,
  urls,
  preview,
  outdir,
  setOutdir,
  pickerSlot,
}: {
  text: string;
  setText: (v: string) => void;
  urls: string[];
  preview: Previews;
  outdir: string;
  setOutdir: (v: string) => void;
  pickerSlot?: ReactNode;
}) {
  const { previews, validUrls, trackTotal, anyLoading } = preview;

  const download = useMutation({
    mutationFn: () => api.download(validUrls, outdir.trim()),
    onSuccess: () => {
      setText("");
      toast.success("Download started");
      queryClient.invalidateQueries({ queryKey: qk.jobs });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Download failed"),
  });

  const submit = () => {
    if (!validUrls.length || download.isPending) return;
    download.mutate();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  let label = "Download";
  if (validUrls.length) label = trackTotal ? `Download ${trackTotal} track${trackTotal === 1 ? "" : "s"}` : `Download ${validUrls.length}`;
  else if (anyLoading) label = "Checking links…";
  const disabled = validUrls.length === 0 || download.isPending;

  return (
    <Card className="bevel overflow-hidden p-0">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder="Paste Spotify or SoundCloud links, one per line"
        className="min-h-[120px] resize-y rounded-none border-0 bg-transparent font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      {urls.length ? <div className="divide-y divide-border/60 border-t border-border/60 px-4">{urls.map((u) => <PreviewRow key={u} url={u} state={previews[u]} />)}</div> : null}

      <div className="flex items-center gap-2 border-t border-border/60 bg-secondary/30 p-3">
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <input
          value={outdir}
          onChange={(e) => setOutdir(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          title="Output folder"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        {pickerSlot}
        <Button
          type="button"
          onClick={submit}
          disabled={disabled}
          className={cn("press gap-2", !disabled && "led-glow")}
        >
          <Download className="h-4 w-4" strokeWidth={2.2} />
          {label}
        </Button>
      </div>
    </Card>
  );
}
