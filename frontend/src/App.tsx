import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";
import { DownloadPage } from "@/pages/Download";
import { DjSetsPage } from "@/pages/DjSets";
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
        <DownloadPage outdir={outdir} setOutdir={setOutdir} />
      ) : (
        <DjSetsPage outdir={outdir} />
      )}
    </Shell>
  );
}
