/**
 * Parse the paste-deck textarea into the list of links to preview/download:
 * one per line, trimmed, blanks dropped, and **de-duplicated** (first occurrence
 * wins, order preserved). Deduping is load-bearing — the preview rows key on the
 * URL, so a link pasted twice would otherwise collide on its React key and get
 * downloaded twice.
 */
export function parseLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const url = line.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
