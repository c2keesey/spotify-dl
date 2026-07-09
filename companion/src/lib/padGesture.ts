/**
 * Pure gesture classification for the cue pads. The component owns the pointer
 * events and the long-press timer; the decisions about what a gesture *is*
 * live here so they are testable without a DOM.
 *
 * A pad interaction resolves to exactly one of:
 *  - "tap"       quick press, finger stayed put → jump/place
 *  - "swipe"     horizontal travel across the pad → clear
 *  - "longpress" held ≥ LONG_PRESS_MS without moving → pad menu
 *    (fired by a timer while the finger is still down; at pointerup the
 *    component sees the fired flag and classify() is not consulted)
 *  - "none"      anything else (wobble, vertical drag, slow indecisive press)
 */

export const LONG_PRESS_MS = 500;
/** horizontal travel that reads as a deliberate swipe-to-clear */
export const SWIPE_DX = 40;
/** movement beyond this cancels both the tap and the pending long-press */
export const TAP_SLOP = 10;

export type PadGesture = "tap" | "swipe" | "none";

/** Has the finger wandered far enough to cancel a pending long-press? */
export function cancelsLongPress(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > TAP_SLOP;
}

/**
 * Classify a completed press (pointerdown → pointerup) that did NOT already
 * fire the long-press timer. dt in ms; dx/dy in px (up minus down).
 */
export function classifyPadGesture(dt: number, dx: number, dy: number): PadGesture {
  // deliberate horizontal travel wins, even if it took a while
  if (Math.abs(dx) > SWIPE_DX && Math.abs(dx) > Math.abs(dy)) return "swipe";
  // a stationary press shorter than a long-press is a tap
  if (Math.hypot(dx, dy) <= TAP_SLOP && dt < LONG_PRESS_MS) return "tap";
  return "none";
}
