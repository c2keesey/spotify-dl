/**
 * Decides how to hand the exported cues file off to the OS. On iOS the Web
 * Share API opens the native share sheet (AirDrop, Files, Messages…), which is
 * the whole point on a tablet with no filesystem UI. Everywhere else — and on
 * any browser that can't share *files* specifically — we fall back to a plain
 * object-URL download. Pure so the branch is testable without a real navigator.
 */

type ShareCapableNavigator = {
  share?: (data: { files: File[] }) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
};

/**
 * "share" only when the platform can share these exact files (both `share` and
 * a `canShare({files})` that returns true); otherwise "download". Guarding on
 * `canShare({files})` matters because some browsers expose `share` but silently
 * drop the `files` field.
 */
export function pickExportMethod(nav: ShareCapableNavigator, files: File[]): "share" | "download" {
  const canShareFiles = typeof nav?.canShare === "function" && nav.canShare({ files });
  return typeof nav?.share === "function" && canShareFiles ? "share" : "download";
}
