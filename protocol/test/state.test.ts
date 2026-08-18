import { describe, expect, it } from "vitest";
import { OFFLINE_STATE, applyStatePatch, normalizeRadioState } from "../src/state.js";
import { validateProtocolMessage } from "../src/validator.js";

describe("control protocol", () => {
  it("accepts a complete adapter hello", () => {
    expect(validateProtocolMessage({
      type: "adapter.hello",
      protocolVersion: "1.0",
      token: "a".repeat(64),
      app: "fake",
      appVersion: "1",
      adapterVersion: "1",
      architecture: "test",
      sourceName: "Fake",
      targetVfo: "Radio",
      capabilities: {}
    })).toBe(true);
  });

  it("rejects an invalid volume", () => {
    expect(validateProtocolMessage({ type: "state.snapshot", state: { ...OFFLINE_STATE, volume: 2 } })).toBe(false);
  });

  it("applies only newer dotted-path patches", () => {
    const patched = applyStatePatch(OFFLINE_STATE, { "rf.agcMode": "high", frequencyHz: 7100000 }, 2);
    expect(patched.frequencyHz).toBe(7100000);
    expect(patched.rf?.agcMode).toBe("high");
    expect(applyStatePatch(patched, { frequencyHz: 1 }, 1)).toBe(patched);
  });

  it("normalizes values at adapter boundaries", () => {
    const state = normalizeRadioState({ ...OFFLINE_STATE, frequencyHz: 1000.4, stepHz: 0, volume: -2 });
    expect(state.frequencyHz).toBe(1000);
    expect(state.stepHz).toBe(1);
    expect(state.volume).toBe(0);
  });
});

