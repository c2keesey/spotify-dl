import { PasteDeck } from "./PasteDeck";

/**
 * Download page. Hero paste deck now; jobs/library/schedule sections land in
 * later tasks — each wrapped in its own staggered fadeUp block.
 */
export function DownloadPage({ outdir, setOutdir }: { outdir: string; setOutdir: (v: string) => void }) {
  return (
    <div className="space-y-8">
      <div style={{ animationDelay: "40ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <h1 className="font-display text-2xl tracking-widest text-foreground">DOWNLOAD</h1>
        <p className="panel-label mt-2">paste links · check · pull</p>
      </div>
      <div style={{ animationDelay: "100ms" }} className="animate-[fadeUp_.4s_ease_both]">
        <PasteDeck outdir={outdir} setOutdir={setOutdir} />
      </div>
    </div>
  );
}
