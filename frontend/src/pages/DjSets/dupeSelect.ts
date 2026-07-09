/**
 * Pure selection logic for the duplicates screen. Kept out of the component so
 * the one rule that actually protects the user's music — NEVER preselect a copy
 * for removal in a fuzzy group — is unit-tested in isolation.
 */
import type { DupeGroup } from "@/lib/types";

/** A stable key for a group (its index is stable within one server response,
 *  and the response is re-fetched wholesale). */
export function groupKey(group: DupeGroup, index: number): string {
  return `${group.reason}:${index}`;
}

/**
 * The initial "mark for removal" selection.
 *
 * Exact-path groups are certain duplicates (the same file at the same path), so
 * a default of "keep one, mark the rest" is defensible — we select every copy
 * except the first.
 *
 * Fuzzy groups are GUESSES. Presenting a guess as certainty and letting the user
 * bulk-act on it is how someone loses music, so a fuzzy group NEVER contributes
 * a preselected id. She must tick each fuzzy copy deliberately.
 */
export function defaultSelection(groups: DupeGroup[]): Set<string> {
  const selected = new Set<string>();
  for (const g of groups) {
    if (g.reason !== "exact_path") continue;
    for (const t of g.tracks.slice(1)) selected.add(t.id);
  }
  return selected;
}

/** One-line, plain-language "why these matched" for a group header. */
export function comparedSummary(group: DupeGroup): string {
  if (group.reason === "exact_path") {
    return group.compared.file_path ?? "same file path";
  }
  const { artist, title, duration } = group.compared;
  const bits = [artist, title].filter(Boolean).join(" — ");
  const dur = duration != null ? ` · ~${Math.round(duration)}s` : "";
  return `${bits}${dur}`;
}
