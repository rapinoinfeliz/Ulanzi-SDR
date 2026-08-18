import net from "node:net";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { OFFLINE_STATE } from "../../../protocol/src/state.js";
import type { Command, CommandResult, DemodMode, Preset, RadioState } from "../../../protocol/src/types.js";

const MODES: DemodMode[] = ["NFM", "WFM", "AM", "DSB", "USB", "CW", "LSB", "RAW"];
const STEPS = [1, 10, 100, 500, 1000, 2500, 5000, 6250, 8333, 9000, 10000, 12500, 25000, 50000, 100000, 250000, 500000, 1000000];

interface PendingRequest {
  expectedLines: number;
  lines: string[];
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class RigctlConnection extends EventEmitter {
  private socket: net.Socket | undefined;
  private buffer = "";
  private pending: PendingRequest | undefined;
  private chain = Promise.resolve<unknown>(undefined);

  constructor(private readonly host = "127.0.0.1", private readonly port = 4532) { super(); }

  get connected(): boolean {
    return this.socket?.readyState === "open";
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.close();
    const socket = net.createConnection({ host: this.host, port: this.port });
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5000);
    socket.on("data", (data) => this.receive(data.toString("utf8")));
    socket.on("error", (error) => this.emit("warning", error));
    socket.on("close", () => {
      this.rejectPending(new Error("Rigctl connection closed"));
      this.emit("close");
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Rigctl connection timed out"));
      }, 1200);
      socket.once("connect", () => { clearTimeout(timeout); resolve(); });
      socket.once("error", (error) => { clearTimeout(timeout); socket.destroy(); reject(error); });
    });
    this.socket = socket;
  }

  request(command: string, expectedLines: number): Promise<string[]> {
    const operation = this.chain.then(() => this.requestNow(command, expectedLines));
    this.chain = operation.catch(() => undefined);
    return operation;
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) socket.destroy();
    this.rejectPending(new Error("Rigctl connection reset"));
  }

  private async requestNow(command: string, expectedLines: number): Promise<string[]> {
    await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error("Rigctl is not connected");
    if (expectedLines === 0) {
      await new Promise<void>((resolve, reject) => socket.write(`${command}\n`, (error) => error ? reject(error) : resolve()));
      return [];
    }
    return new Promise<string[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = undefined;
        reject(new Error(`Rigctl command timed out: ${command}`));
      }, 1200);
      this.pending = { expectedLines, lines: [], resolve, reject, timeout };
      socket.write(`${command}\n`, (error) => {
        if (!error) return;
        this.rejectPending(error);
      });
    });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      const pending = this.pending;
      if (!pending) continue;
      pending.lines.push(line);
      if (pending.lines.length >= pending.expectedLines) {
        clearTimeout(pending.timeout);
        this.pending = undefined;
        if (pending.lines[0]?.startsWith("RPRT ") && pending.lines[0] !== "RPRT 0") {
          pending.reject(new Error(`Rigctl rejected command: ${pending.lines[0]}`));
        } else {
          pending.resolve(pending.lines);
        }
      }
    }
  }

  private rejectPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending = undefined;
    pending.reject(error);
  }
}

export class SdrppRigctlAdapter {
  private rigctl: RigctlConnection;
  private rigctlPort: number;
  private webSocket: WebSocket | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private state: RadioState = structuredClone(OFFLINE_STATE);
  private readonly results = new Map<string, CommandResult>();
  private operation = Promise.resolve<unknown>(undefined);
  private stopped = false;

  constructor(
    private readonly hubPort: number,
    private readonly token: string,
    rigctlPort = Number.parseInt(process.env.ULANZI_SDR_RIGCTL_PORT ?? "4532", 10)
  ) {
    this.rigctlPort = validPort(rigctlPort) ? rigctlPort : 4532;
    this.rigctl = new RigctlConnection("127.0.0.1", this.rigctlPort);
  }

  start(): void {
    this.stopped = false;
    this.connectHub();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.webSocket?.close(1001, "Adapter shutdown");
    this.rigctl.close();
  }

  setPort(port: number): void {
    if (!validPort(port) || port === this.rigctlPort) return;
    this.rigctlPort = port;
    this.rigctl.close();
    this.rigctl = new RigctlConnection("127.0.0.1", port);
    void this.poll(true);
  }

  private connectHub(): void {
    if (this.stopped) return;
    const socket = new WebSocket(`ws://127.0.0.1:${this.hubPort}/control/v1`, { maxPayload: 64 * 1024 });
    this.webSocket = socket;
    socket.on("open", () => {
      this.send({
        type: "adapter.hello",
        protocolVersion: "1.0",
        token: this.token,
        app: "sdrpp",
        appVersion: "stock-rigctl",
        adapterVersion: "0.2.0",
        architecture: process.arch,
        sourceName: "SDR++ Rigctl",
        targetVfo: "Radio",
        capabilities: {
          frequencyHz: { access: "readwrite" },
          stepHz: { access: "readwrite", values: STEPS },
          mode: { access: "readwrite", values: MODES },
          bandwidthHz: { access: "readwrite", minimum: 1 },
          "record.audio": { access: "write", values: [true, false] }
        }
      });
      void this.poll(true);
      this.pollTimer = setInterval(() => void this.poll(false), 1000);
    });
    socket.on("message", (raw) => void this.receiveHubMessage(raw.toString()));
    socket.on("close", () => {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connectHub(), 1000);
    });
    socket.on("error", () => undefined);
  }

  private async receiveHubMessage(raw: string): Promise<void> {
    let message: { type?: string; [key: string]: unknown };
    try { message = JSON.parse(raw) as typeof message; }
    catch { return; }
    if (message.type === "heartbeat") {
      this.send({ type: "heartbeat", timestamp: Date.now() });
      return;
    }
    if (message.type !== "command" || typeof message.id !== "string" || typeof message.method !== "string" || !isRecord(message.params)) return;
    const cached = this.results.get(message.id);
    if (cached) { this.send(cached); return; }
    const result = await this.execute(message as unknown as Command);
    this.results.set(message.id, result);
    if (this.results.size > 128) this.results.delete(this.results.keys().next().value as string);
    this.send(result);
  }

  private async execute(command: Command): Promise<CommandResult> {
    return this.serialize(() => this.executeNow(command));
  }

  private async executeNow(command: Command): Promise<CommandResult> {
    if (command.expectedRevision !== undefined && command.expectedRevision !== this.state.revision) {
      return failure(command.id, "conflict", "State revision changed before command execution");
    }
    try {
      switch (command.method) {
        case "control.adjust": await this.adjust(String(command.params.control), Number(command.params.ticks), optionalPositiveNumber(command.params.amount)); break;
        case "control.set": await this.set(String(command.params.control), command.params.value); break;
        case "control.cycle": await this.cycle(String(command.params.control), Number(command.params.direction)); break;
        case "control.toggle": await this.toggle(String(command.params.control)); break;
        case "preset.apply": await this.applyPreset(command.params.preset as Preset); break;
        case "record.audio.set": await this.setRecording(command.params.enabled === true); break;
        default: throw new UnsupportedError(`Unsupported command: ${command.method}`);
      }
      await this.pollNow(false);
      return { type: "command.result", id: command.id, ok: true, effectiveState: structuredClone(this.state) };
    } catch (error) {
      const unsupported = error instanceof UnsupportedError;
      return failure(command.id, unsupported ? "unsupported" : "io_error", error instanceof Error ? error.message : String(error));
    }
  }

  private async adjust(control: string, ticks: number, amount?: number): Promise<void> {
    if (control === "frequencyHz") return this.set(control, this.state.frequencyHz + (amount ?? this.state.stepHz) * ticks);
    if (control === "bandwidthHz") return this.set(control, Math.max(1, this.state.bandwidthHz + ticks * (amount ?? Math.max(10, Math.floor(this.state.stepHz / 10)))));
    throw new UnsupportedError(`${control} is unavailable through stock SDR++ Rigctl`);
  }

  private async set(control: string, value: unknown): Promise<void> {
    if (control === "frequencyHz") {
      await expectOk(this.rigctl.request(`F ${Math.max(0, Math.round(Number(value)))}`, 1));
      return;
    }
    if (control === "stepHz") {
      this.state = { ...this.state, stepHz: Math.max(1, Math.round(Number(value))), revision: this.state.revision + 1 };
      return;
    }
    if (control === "mode") {
      await this.setMode(String(value) as DemodMode, this.state.bandwidthHz);
      return;
    }
    if (control === "bandwidthHz") {
      await this.setMode(this.state.mode, Math.max(1, Math.round(Number(value))));
      return;
    }
    throw new UnsupportedError(`${control} is unavailable through stock SDR++ Rigctl`);
  }

  private async cycle(control: string, direction: number): Promise<void> {
    if (control === "stepHz") {
      const index = Math.max(0, STEPS.indexOf(this.state.stepHz));
      return this.set(control, STEPS[(index + (direction < 0 ? -1 : 1) + STEPS.length) % STEPS.length]);
    }
    if (control === "mode") {
      const index = Math.max(0, MODES.indexOf(this.state.mode));
      return this.set(control, MODES[(index + (direction < 0 ? -1 : 1) + MODES.length) % MODES.length]);
    }
    throw new UnsupportedError(`${control} cannot be cycled through stock SDR++ Rigctl`);
  }

  private async toggle(control: string): Promise<void> {
    if (control === "record.audio") return this.setRecording(this.state.recorder.status !== "recording");
    throw new UnsupportedError(`${control} cannot be toggled through stock SDR++ Rigctl`);
  }

  private async applyPreset(preset: Preset): Promise<void> {
    await this.setMode(preset.mode, preset.bandwidthHz);
    this.state = { ...this.state, stepHz: preset.stepHz };
    await expectOk(this.rigctl.request(`F ${preset.frequencyHz}`, 1));
  }

  private async setRecording(enabled: boolean): Promise<void> {
    await expectOk(this.rigctl.request(enabled ? "\\recorder_start" : "\\recorder_stop", 1));
    this.state = { ...this.state, recorder: { status: enabled ? "recording" : "idle" }, revision: this.state.revision + 1 };
  }

  private async setMode(mode: DemodMode, bandwidthHz: number): Promise<void> {
    const rigctlMode = mode === "NFM" ? "FM" : mode;
    await expectOk(this.rigctl.request(`M ${rigctlMode} ${Math.max(1, Math.round(bandwidthHz))}`, 1));
  }

  private async poll(force: boolean): Promise<void> {
    return this.serialize(() => this.pollNow(force));
  }

  private async pollNow(force: boolean): Promise<void> {
    try {
      const [frequency] = await this.rigctl.request("f", 1);
      const [rigMode, bandwidth] = await this.rigctl.request("m", 2);
      const mode = rigMode === "FM" ? "NFM" : rigMode as DemodMode;
      const candidate: RadioState = {
        ...this.state,
        sourceConnected: true,
        receiverRunning: this.state.sourceConnected ? this.state.receiverRunning : true,
        frequencyHz: parseRigInteger(frequency, "frequency", 0),
        mode: MODES.includes(mode) ? mode : "RAW",
        bandwidthHz: parseRigInteger(bandwidth, "bandwidth", 1)
      };
      if (force || fingerprint(candidate) !== fingerprint(this.state)) candidate.revision = this.state.revision + 1;
      this.state = candidate;
      this.send({ type: "state.snapshot", state: this.state });
    } catch (error) {
      this.rigctl.close();
      const changed = this.state.sourceConnected;
      this.state = { ...this.state, sourceConnected: false, receiverRunning: false, revision: this.state.revision + (changed ? 1 : 0) };
      this.send({ type: "state.snapshot", state: this.state });
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation);
    this.operation = result.catch(() => undefined);
    return result;
  }

  private send(value: unknown): void {
    if (this.webSocket?.readyState === WebSocket.OPEN) this.webSocket.send(JSON.stringify(value));
  }
}

class UnsupportedError extends Error {}

async function expectOk(response: Promise<string[]>): Promise<void> {
  const lines = await response;
  if (lines[0] !== "RPRT 0") throw new Error(lines[0] ?? "Rigctl returned no status");
}

type CommandErrorCode = NonNullable<CommandResult["error"]>["code"];

function failure(id: string, code: CommandErrorCode, message: string): CommandResult {
  return { type: "command.result", id, ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseRigInteger(value: string | undefined, field: string, minimum: number): number {
  if (!value || !/^-?\d+$/.test(value)) throw new Error(`Invalid Rigctl ${field} response`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Out-of-range Rigctl ${field} response`);
  return parsed;
}

function fingerprint(state: RadioState): string {
  const { revision: _, ...value } = state;
  return JSON.stringify(value);
}
