import { classifyPadGesture, cancelsLongPress, LONG_PRESS_MS, SWIPE_DX, TAP_SLOP } from "@/lib/padGesture";

describe("classifyPadGesture", () => {
  test("quick stationary press is a tap", () => {
    expect(classifyPadGesture(80, 0, 0)).toBe("tap");
    expect(classifyPadGesture(200, 3, -4)).toBe("tap"); // within slop
  });

  test("a press held to the long-press threshold is not a tap", () => {
    expect(classifyPadGesture(LONG_PRESS_MS, 0, 0)).toBe("none");
    expect(classifyPadGesture(LONG_PRESS_MS + 100, 0, 0)).toBe("none");
  });

  test("horizontal travel beyond the threshold is a swipe, either direction", () => {
    expect(classifyPadGesture(150, SWIPE_DX + 1, 0)).toBe("swipe");
    expect(classifyPadGesture(150, -(SWIPE_DX + 1), 5)).toBe("swipe");
  });

  test("a slow swipe still clears — duration doesn't veto deliberate travel", () => {
    expect(classifyPadGesture(LONG_PRESS_MS + 200, SWIPE_DX + 20, 0)).toBe("swipe");
  });

  test("mostly-vertical travel is not a swipe", () => {
    expect(classifyPadGesture(150, SWIPE_DX + 5, SWIPE_DX + 30)).toBe("none");
  });

  test("travel past slop but short of a swipe is nothing", () => {
    expect(classifyPadGesture(150, TAP_SLOP + 5, 0)).toBe("none");
    expect(classifyPadGesture(150, 0, 30)).toBe("none");
  });

  test("exactly the swipe threshold is not yet a swipe", () => {
    expect(classifyPadGesture(150, SWIPE_DX, 0)).toBe("none");
  });
});

describe("cancelsLongPress", () => {
  test("small wobble keeps the long-press pending", () => {
    expect(cancelsLongPress(3, 4)).toBe(false); // hypot 5 ≤ slop
    expect(cancelsLongPress(0, 0)).toBe(false);
  });

  test("movement past the slop cancels", () => {
    expect(cancelsLongPress(TAP_SLOP + 1, 0)).toBe(true);
    expect(cancelsLongPress(8, 8)).toBe(true); // hypot ≈ 11.3
  });
});
