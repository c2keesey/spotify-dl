import { describe, expect, it } from "vitest";
import { parseLinks } from "./links";

describe("parseLinks", () => {
  it("splits lines, trims, and drops blanks", () => {
    expect(parseLinks("  a \n\n  b\n")).toEqual(["a", "b"]);
  });

  it("de-duplicates, keeping the first occurrence and order", () => {
    expect(parseLinks("a\nb\na\nc\nb")).toEqual(["a", "b", "c"]);
  });

  it("treats whitespace-only differences as the same link", () => {
    expect(parseLinks("https://x/1\n  https://x/1  ")).toEqual(["https://x/1"]);
  });

  it("returns [] for empty or whitespace input", () => {
    expect(parseLinks("")).toEqual([]);
    expect(parseLinks("   \n \n")).toEqual([]);
  });
});
