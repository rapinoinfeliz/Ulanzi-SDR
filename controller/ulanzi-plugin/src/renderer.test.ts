import { describe, expect, it } from "vitest";
import { OFFLINE_STATE } from "../../../protocol/src/state.js";
import type { ActionContext } from "./actions.js";
import { iconForContext, iconSlug } from "./renderer.js";

function context(kind: ActionContext["kind"], mapping?: ActionContext["mapping"]): ActionContext {
  return {
    context: `test.${kind}`,
    kind,
    active: true,
    isEncoder: true,
    dialMovedWhileDown: false,
    dialDownAt: undefined,
    mapping
  };
}

describe("OLED icon routing", () => {
  it("uses the configured control as the dynamic icon", () => {
    expect(iconForContext(context("configurable", {
      title: "SQL",
      press: { action: "toggle", control: "squelch.enabled" }
    }), OFFLINE_STATE, "radio")).toBe("squelch.enabled");
  });

  it("switches volume and layered icons with state", () => {
    expect(iconForContext(context("volume"), { ...OFFLINE_STATE, muted: true }, "radio")).toBe("muted");
    expect(iconForContext(context("layered"), OFFLINE_STATE, "memory")).toBe("preset");
  });

  it("maps protocol identifiers to catalog filenames", () => {
    expect(iconSlug("rf.attenuationDb")).toBe("rf-attenuation-db");
    expect(iconSlug("centerFrequencyHz")).toBe("center-frequency-hz");
  });
});
