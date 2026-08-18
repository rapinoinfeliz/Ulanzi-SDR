import { randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { OFFLINE_STATE, applyStatePatch, normalizeRadioState } from "../../../protocol/src/state.js";
import type {
  AdapterHello,
  AdapterInbound,
  Capabilities,
  Command,
  CommandResult,
  RadioState
} from "../../../protocol/src/types.js";
import { PROTOCOL_VERSION } from "../../../protocol/src/types.js";
import { protocolValidationErrors, validateProtocolMessage } from "../../../protocol/src/validator.js";
import type { HubSettings } from "./config.js";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 2500;

interface PendingCommand {
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class ControlHub extends EventEmitter {
  private readonly server: WebSocketServer;
  private adapter: WebSocket | undefined;
  private hello: AdapterHello | undefined;
  private radioState: RadioState = structuredClone(OFFLINE_STATE);
  private readonly pending = new Map<string, PendingCommand>();
  private heartbeat: NodeJS.Timeout | undefined;
  private lastAdapterMessage = 0;

  constructor(private readonly token: string) {
    super();
    this.server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: MAX_PAYLOAD_BYTES });
    this.server.on("connection", (socket, request) => this.handleConnection(socket, request));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("listening", () => resolve());
      this.server.once("error", reject);
    });
    const address = this.server.address();
    if (typeof address === "string" || address === null) throw new Error("WebSocket server has no TCP address");
    this.heartbeat = setInterval(() => this.heartbeatTick(), 5000);
    return address.port;
  }

  getState(): RadioState {
    return structuredClone(this.radioState);
  }

  getCapabilities(): Capabilities {
    return structuredClone(this.hello?.capabilities ?? {});
  }

  getAdapterDescription(): AdapterHello | undefined {
    return this.hello ? structuredClone(this.hello) : undefined;
  }

  async command(method: string, params: Record<string, unknown>, expectedRevision = this.radioState.revision): Promise<CommandResult> {
    if (!this.adapter || this.adapter.readyState !== WebSocket.OPEN || !this.hello) {
      throw new Error("No authenticated SDR adapter is connected");
    }
    const id = randomUUID();
    const message: Command = { type: "command", id, method, params, expectedRevision };

    return new Promise<CommandResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command ${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.adapter?.send(JSON.stringify(message), (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  broadcastConfiguration(settings: HubSettings): void {
    const message = JSON.stringify({ type: "config.snapshot", settings });
    for (const client of this.server.clients) {
      if ((client as WebSocket & { role?: string }).role === "property-inspector" && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error("Hub is shutting down"));
    }
    this.pending.clear();
    for (const client of this.server.clients) client.close(1001, "Hub shutdown");
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/property-inspector") {
      if (!safeTokenEquals(url.searchParams.get("token") ?? "", this.token)) {
        socket.close(1008, "Authentication failed");
        return;
      }
      (socket as WebSocket & { role?: string }).role = "property-inspector";
      socket.on("message", (raw) => this.handlePropertyInspector(socket, raw.toString()));
      this.emit("property-inspector", socket);
      return;
    }

    if (url.pathname !== "/control/v1") {
      socket.close(1008, "Unknown endpoint");
      return;
    }
    if (this.adapter && this.adapter.readyState === WebSocket.OPEN) {
      socket.close(1013, "An SDR adapter is already active");
      return;
    }
    let authenticated = false;
    const authenticationTimeout = setTimeout(() => socket.close(1008, "adapter.hello required"), 3000);
    socket.on("message", (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(1007, "Invalid JSON");
        return;
      }
      if (!validateProtocolMessage(message)) {
        socket.close(1007, protocolValidationErrors().slice(0, 120));
        return;
      }
      if (!authenticated) {
        if (!isAdapterHello(message) || !safeTokenEquals(message.token, this.token)) {
          socket.close(1008, "Authentication failed");
          return;
        }
        clearTimeout(authenticationTimeout);
        authenticated = true;
        this.adapter = socket;
        this.hello = message;
        this.lastAdapterMessage = Date.now();
        this.emit("adapter", structuredClone(message));
        return;
      }
      this.handleAdapterMessage(message as AdapterInbound);
    });
    socket.on("close", () => {
      clearTimeout(authenticationTimeout);
      if (socket === this.adapter) this.disconnectAdapter("Adapter disconnected");
    });
    socket.on("error", (error) => this.emit("warning", error));
  }

  private handleAdapterMessage(message: AdapterInbound): void {
    this.lastAdapterMessage = Date.now();
    switch (message.type) {
      case "state.snapshot":
        this.radioState = normalizeRadioState(message.state);
        this.emit("state", this.getState());
        break;
      case "state.patch":
        this.radioState = normalizeRadioState(applyStatePatch(this.radioState, message.changes, message.revision));
        this.emit("state", this.getState());
        break;
      case "command.result": {
        if (message.effectiveState) {
          this.radioState = normalizeRadioState(message.effectiveState);
          this.emit("state", this.getState());
        }
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          if (message.ok) pending.resolve(message);
          else pending.reject(new Error(message.error?.message ?? "SDR adapter rejected the command"));
        }
        break;
      }
      case "heartbeat":
        break;
      case "adapter.hello":
        break;
    }
  }

  private handlePropertyInspector(socket: WebSocket, raw: string): void {
    try {
      const message = JSON.parse(raw) as { type?: string; settings?: unknown };
      if (message.type === "config.get") this.emit("property-inspector", socket);
      if (message.type === "config.set" && message.settings) this.emit("configuration-request", message.settings);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid configuration message" }));
    }
  }

  private heartbeatTick(): void {
    if (!this.adapter || this.adapter.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastAdapterMessage > 15000) {
      this.adapter.close(1011, "Heartbeat timeout");
      return;
    }
    this.adapter.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
  }

  private disconnectAdapter(reason: string): void {
    this.adapter = undefined;
    this.hello = undefined;
    this.radioState = {
      ...this.radioState,
      revision: this.radioState.revision + 1,
      sourceConnected: false,
      receiverRunning: false,
      recorder: { status: "idle", error: reason }
    };
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error(reason));
    }
    this.pending.clear();
    this.emit("state", this.getState());
  }
}

function isAdapterHello(message: unknown): message is AdapterHello {
  return typeof message === "object"
    && message !== null
    && (message as { type?: unknown }).type === "adapter.hello"
    && (message as { protocolVersion?: unknown }).protocolVersion === PROTOCOL_VERSION;
}

function safeTokenEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
