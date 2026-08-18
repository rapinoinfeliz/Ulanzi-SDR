import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIGURABLE_MAPPING, normalizeMapping } from "./actions.js";

describe("configurable action mappings", () => {
  it("uses safe defaults for a new action", () => {
    expect(normalizeMapping(undefined)).toEqual(DEFAULT_CONFIGURABLE_MAPPING);
  });

  it("preserves explicitly disabled gestures and sanitizes the title", () => {
    const mapping = normalizeMapping({
      title: "  SQUELCH CONTROL WITH A VERY LONG NAME  ",
      rotate: { action: "adjust", control: "squelch.threshold", amount: 2, inverted: true },
      press: null,
      holdRotate: { action: "cycle", control: "filter.type" }
    });
    expect(mapping.title).toBe("SQUELCH CONTROL WI");
    expect(mapping.rotate).toEqual({ action: "adjust", control: "squelch.threshold", amount: 2, inverted: true });
    expect(mapping.press).toBeUndefined();
    expect(mapping.holdRotate).toEqual({ action: "cycle", control: "filter.type" });
  });

  it("rejects unsafe control paths", () => {
    const mapping = normalizeMapping({ rotate: { action: "adjust", control: "../../bad", amount: 1 } });
    expect(mapping.rotate).toEqual(DEFAULT_CONFIGURABLE_MAPPING.rotate);
  });
});
