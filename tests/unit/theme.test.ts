import { describe, expect, test } from "bun:test";

import { accentStyle } from "../../src/lib/theme.ts";

describe("accentStyle", () => {
  test("derives the five accent tokens from the color", () => {
    const css = accentStyle("#2f9e44");
    for (const token of [
      "accent",
      "accent-ink",
      "accent-wash",
      "accent-line",
      "accent-bright",
    ]) {
      expect(css).toContain(`--${token}:hsl(`);
    }
  });

  test("keeps the hue, and fixes the lightness so text stays legible", () => {
    // A pale yellow must not become a pale link.
    expect(accentStyle("#ffff00")).toContain("--accent-ink:hsl(60 ");
    expect(accentStyle("#ffff00")).toContain("28%)");
  });

  test("accepts an alpha suffix and rejects garbage", () => {
    expect(accentStyle("#2f9e44ff")).not.toBe("");
    expect(accentStyle("red; } body { display:none")).toBe("");
    expect(accentStyle(undefined)).toBe("");
  });
});
