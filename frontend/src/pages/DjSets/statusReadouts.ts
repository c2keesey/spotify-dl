import type { DjStatus } from "@/lib/types";

/**
 * Turns the raw `DjStatus` counts into self-explaining readouts for the status
 * strip. The counts mean genuinely different things — one wants you to open
 * rekordbox, one wants a click, several want nothing at all — and nothing in the
 * old strip said which. Every readout therefore carries a plain-language
 * `meaning` and, when the count is actually asking something of the user, an
 * explicit `action`. Both are meant to be rendered as visible text, never hidden
 * behind a hover. The `led` colour is decoration layered on top of that text —
 * per accessibility it is never the sole carrier of meaning.
 */
export type ReadoutTone = "ready" | "act" | "info";

export type ReadoutKey = "analyzed" | "pending" | "not_imported" | "missing" | "unmounted" | "not_a_file";

export type Readout = {
  key: ReadoutKey;
  count: number;
  /** Engraved uppercase panel label. */
  label: string;
  /** What this count actually means, in plain language. Always shown. */
  meaning: string;
  /** The user's explicit next move, or null when the count asks nothing. */
  action: string | null;
  /** LED colour — decoration only. Text always states the meaning too. */
  led: "on" | "warn" | "off";
  tone: ReadoutTone;
};

type ReadoutMeta = Omit<Readout, "count">;

/**
 * Order = "what should I do?" first. Work the user can act on now leads, the
 * ready count sits in the middle, and the purely informational counts (which on
 * this user's real library are the large ones — 740 missing, 186 streaming)
 * come last so a big number there never reads as the headline.
 */
const READOUTS: ReadoutMeta[] = [
  {
    key: "pending",
    label: "PENDING",
    meaning: "Rekordbox has these files but hasn't analyzed their BPM and key yet.",
    action: "Open rekordbox and let it finish analyzing.",
    led: "warn",
    tone: "act",
  },
  {
    key: "not_imported",
    label: "NOT IMPORTED",
    meaning: "On disk, but rekordbox has never seen them.",
    action: "Click Import to add them to your rekordbox collection.",
    led: "warn",
    tone: "act",
  },
  {
    key: "unmounted",
    label: "UNMOUNTED",
    meaning: "These live on a drive that isn't connected right now — not deleted.",
    action: "Plug the drive back in to use them.",
    led: "warn",
    tone: "act",
  },
  {
    key: "analyzed",
    label: "ANALYZED",
    meaning: "Rekordbox has computed BPM and key. Ready to use.",
    action: null,
    led: "on",
    tone: "ready",
  },
  {
    key: "missing",
    label: "MISSING",
    meaning:
      "Rekordbox has a row but the file isn't on disk — it was moved or deleted. Crate never touches your files, so it leaves these as-is.",
    action: null,
    led: "off",
    tone: "info",
  },
  {
    key: "not_a_file",
    label: "STREAMING",
    meaning: "Streaming entries (spotify:track:…) that never had a local file. Not an error — just not a local track.",
    action: null,
    led: "off",
    tone: "info",
  },
];

/** The non-zero readouts, in canonical reading order. Zero counts are dropped. */
export function buildReadouts(status: DjStatus): Readout[] {
  return READOUTS.filter((r) => status[r.key] > 0).map((r) => ({ ...r, count: status[r.key] }));
}

/**
 * True when there is genuinely nothing for the user to do about their library:
 * nothing waiting on rekordbox's analyzer and nothing waiting to be imported.
 * The strip should say this affirmatively rather than showing two silent zeros.
 */
export function nothingToDo(status: DjStatus): boolean {
  return status.pending === 0 && status.not_imported === 0;
}

/**
 * Why import and export are disabled, or null when they're available. Crate
 * refuses to write master.db while rekordbox is running, and a dead button that
 * doesn't say why is worse than no button.
 */
export function writeDisabledReason(status: DjStatus): string | null {
  if (!status.running) return null;
  return "Rekordbox is open. Crate never writes to its database while it's running, so Import is paused — close rekordbox to enable it.";
}
