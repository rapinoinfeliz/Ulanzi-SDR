import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { RadioState } from "../../../protocol/src/types.js";
import { ControlHub } from "./hub.js";
import { RigctlConnection, SdrppRigctlAdapter } from "./rigctl.js";

const servers: net.Server[] = [];
const hubs: ControlHub[] = [];
const adapters: SdrppRigctlAdapter[] = [];
afterEach(async () => {
  for (const adapter of adapters.splice(0)) adapter.stop();
  await Promise.all(hubs.splice(0).map((hub) => hub.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("RigctlConnection", () => {
  it("serializes commands and collects multi-line replies", async () => {
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n");
          const command = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (command === "f") socket.write("7100000\n");
          else if (command === "m") socket.write("LSB\n2700\n");
          else socket.write("RPRT 0\n");
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("No TCP address");
    const connection = new RigctlConnection("127.0.0.1", address.port);
    await expect(connection.request("f", 1)).resolves.toEqual(["7100000"]);
    await expect(connection.request("m", 2)).resolves.toEqual(["LSB", "2700"]);
    await expect(connection.request("F 7200000", 1)).resolves.toEqual(["RPRT 0"]);
    connection.close();
  });

  it("controls a stock SDR++ Rigctl server through the Ulanzi hub", async () => {
    let frequency = 7_100_000;
    let mode = "LSB";
    let bandwidth = 2700;
    const commands: string[] = [];
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n");
          const command = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          commands.push(command);
          const parts = command.split(" ");
          if (command === "f") socket.write(`${frequency}\n`);
          else if (command === "m") socket.write(`${mode}\n${bandwidth}\n`);
          else if (parts[0] === "F") { frequency = Number(parts[1]); socket.write("RPRT 0\n"); }
          else if (parts[0] === "M") { mode = parts[1] ?? mode; bandwidth = Number(parts[2]); socket.write("RPRT 0\n"); }
          else socket.write("RPRT 0\n");
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("No TCP address");

    const token = "b".repeat(64);
    const hub = new ControlHub(token);
    hubs.push(hub);
    const hubPort = await hub.start();
    const adapter = new SdrppRigctlAdapter(hubPort, token, address.port);
    adapters.push(adapter);
    adapter.start();

    const initial = await waitForState(hub, (state) => state.sourceConnected);
    expect(initial.frequencyHz).toBe(7_100_000);
    expect(initial.mode).toBe("LSB");
    expect(hub.getCapabilities()).not.toHaveProperty("volume");

    await hub.command("control.adjust", { control: "frequencyHz", ticks: 1 });
    expect(hub.getState().frequencyHz).toBe(7_101_000);
    expect(commands).toContain("F 7101000");

    await hub.command("record.audio.set", { enabled: true });
    expect(commands).toContain("\\recorder_start");
    expect(hub.getState().recorder.status).toBe("recording");
  });
});

function waitForState(hub: ControlHub, predicate: (state: RadioState) => boolean): Promise<RadioState> {
  const current = hub.getState();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise<RadioState>((resolve, reject) => {
    const timeout = setTimeout(() => { hub.off("state", onState); reject(new Error("Timed out waiting for state")); }, 2500);
    const onState = (state: RadioState) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      hub.off("state", onState);
      resolve(state);
    };
    hub.on("state", onState);
  });
}
