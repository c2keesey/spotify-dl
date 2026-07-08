import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { LinkMeta } from "@/lib/types";

export type PreviewState = LinkMeta | "loading";

export type Previews = {
  /** Per-URL cache: LinkMeta once resolved, "loading" while in flight, absent if unseen. */
  previews: Record<string, PreviewState>;
  /** URLs whose preview loaded error-free with a known kind (downloadable). */
  validUrls: string[];
  /** Sum of track counts across valid URLs (0 when none report a count). */
  trackTotal: number;
  /** True while any current URL is still being checked. */
  anyLoading: boolean;
};

const errorMeta = (url: string): LinkMeta => ({
  url,
  kind: null,
  name: null,
  image: null,
  count: null,
  error: "Couldn't check this link.",
});

/**
 * Live link previews with parity to the legacy schedulePreviews/validUrls logic:
 * 350ms debounce, per-URL cache that persists across edits, and only unseen URLs
 * are fetched. `urls` is the trimmed, non-empty list of lines from the textarea.
 */
export function usePreviews(urls: string[]): Previews {
  const [cache, setCache] = useState<Record<string, PreviewState>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  // Debounce on the joined content so identical arrays across renders don't retrigger.
  const key = urls.join("\n");
  useEffect(() => {
    const timer = setTimeout(() => {
      const unseen = urlsRef.current.filter((u) => !(u in cacheRef.current));
      if (!unseen.length) return;
      setCache((c) => {
        const next = { ...c };
        for (const u of unseen) next[u] = "loading";
        return next;
      });
      for (const u of unseen) {
        api
          .preview(u)
          .then((meta) => setCache((c) => ({ ...c, [u]: meta })))
          .catch(() => setCache((c) => ({ ...c, [u]: errorMeta(u) })));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [key]);

  const validUrls = urls.filter((u) => {
    const p = cache[u];
    return !!p && p !== "loading" && !p.error && !!p.kind;
  });
  const trackTotal = validUrls.reduce((n, u) => n + ((cache[u] as LinkMeta).count || 0), 0);
  const anyLoading = urls.some((u) => cache[u] === "loading");

  return { previews: cache, validUrls, trackTotal, anyLoading };
}
