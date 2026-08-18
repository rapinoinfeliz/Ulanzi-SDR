import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ControlHub } from "./hub.js";

const hubs: ControlHub[] = [];
afterEach(async () => Promise.all(hubs.splice(0).map((hub) => hub.close())));

describe("ControlHub", () => {
  it("authenticates one adapter and applies state snapshots", async () => {
    const token = "a".repeat(64);
    const hub = new ControlHub(token);
    hubs.push(hub);
    const port = await hub.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/control/v1`);
    await new Promise<void>((resolve) => socket.once("open", resolve));
    socket.send(JSON.stringify({
      type: "adapter.hello",
      protocolVersion: "1.0",
      token,
      app: "fake",
      appVersion: "1",
      adapterVersion: "1",
      architecture: "test",
      sourceName: "Fake",
      targetVfo: "Radio",
      capabilities: {}
    }));
    socket.send(JSON.stringify({
      type: "state.snapshot",
      state: {
        revision: 1,
        sourceConnected: true,
        receiverRunning: true,
        targetVfo: "Radio",
        frequencyHz: 7100000,
        stepHz: 1000,
        volume: 0.5,
        muted: false,
        mode: "LSB",
        bandwidthHz: 2700,
        recorder: { status: "idle" }
      }
    }));
    await new Promise<void>((resolve) => hub.once("state", () => resolve()));
    expect(hub.getState().frequencyHz).toBe(7100000);
    socket.close();
  });
});

