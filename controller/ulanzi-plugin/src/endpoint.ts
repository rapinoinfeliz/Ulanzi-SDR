import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EndpointDescription {
  protocolVersion: "1.0";
  host: "127.0.0.1";
  port: number;
  pid: number;
  token: string;
  createdAt: string;
}

export class EndpointPublisher {
  readonly token = randomBytes(32).toString("hex");
  private readonly endpointPath: string;
  private readonly browserPath: string;

  constructor(pluginRoot: string, appDataRoot = defaultAppDataRoot()) {
    this.endpointPath = path.join(appDataRoot, "UlanziSDR", "endpoint.json");
    this.browserPath = path.join(pluginRoot, "ws-port.js");
  }

  async publish(port: number): Promise<EndpointDescription> {
    const description: EndpointDescription = {
      protocolVersion: "1.0",
      host: "127.0.0.1",
      port,
      pid: process.pid,
      token: this.token,
      createdAt: new Date().toISOString()
    };
    await fs.mkdir(path.dirname(this.endpointPath), { recursive: true, mode: 0o700 });
    await atomicWrite(this.endpointPath, `${JSON.stringify(description, null, 2)}\n`, 0o600);
    const browserValue = { port, token: this.token };
    await atomicWrite(this.browserPath, `window.__ULANZI_SDR_ENDPOINT__ = ${JSON.stringify(browserValue)};\n`, 0o600);
    return description;
  }

  async cleanup(): Promise<void> {
    try {
      const current = JSON.parse(await fs.readFile(this.endpointPath, "utf8")) as Partial<EndpointDescription>;
      if (current.pid === process.pid) await fs.unlink(this.endpointPath);
    } catch {
      // A stale/missing discovery file is harmless.
    }
  }
}

function defaultAppDataRoot(): string {
  if (process.platform === "win32") return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
}

async function atomicWrite(destination: string, contents: string, mode: number): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, { encoding: "utf8", mode });
  await fs.rename(temporary, destination);
}

