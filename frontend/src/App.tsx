import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

export default function App() {
  const [page, setPage] = useState<"download" | "dj">("download");
  const [outdir, setOutdir] = useState(() => localStorage.getItem("outdir") ?? "");
  const config = useQuery({ queryKey: qk.config, queryFn: api.config });

  // Seed from config when nothing stored ("" or missing = unseeded); persist only
  // non-empty values so the mount-time "" never blocks seeding.
  useEffect(() => {
    if (config.data && !localStorage.getItem("outdir")) setOutdir(config.data.default_output);
  }, [config.data]);

  useEffect(() => {
    if (outdir) localStorage.setItem("outdir", outdir);
  }, [outdir]);

  return (
    <Shell page={page} onPageChange={setPage} wide={page === "dj"}>
      {page === "download" ? (
        <div style={{ animationDelay: "40ms" }} className="animate-[fadeUp_.4s_ease_both]">
          <h1 className="font-display text-2xl tracking-widest text-foreground">DOWNLOAD</h1>
          <p className="panel-label mt-3">download page — task 6</p>
          <p className="mt-4 font-mono text-xs text-muted-foreground">output: {outdir || "…"}</p>
        </div>
      ) : (
        <div style={{ animationDelay: "40ms" }} className="animate-[fadeUp_.4s_ease_both]">
          <h1 className="font-display text-2xl tracking-widest text-foreground">DJ SETS</h1>
          <p className="panel-label mt-3">dj page — task 9</p>
        </div>
      )}
    </Shell>
  );
}
