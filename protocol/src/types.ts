export const PROTOCOL_VERSION = "1.0" as const;

export type SdrApplication = "sdrsharp" | "sdrpp" | "fake";
export type DemodMode = "NFM" | "WFM" | "AM" | "DSB" | "USB" | "LSB" | "CW" | "RAW";
export type RfAgcMode = "off" | "low" | "high" | "auto";
export type CapabilityAccess = "read" | "write" | "readwrite";

export interface CapabilityDescriptor {
  access: CapabilityAccess;
  label?: string;
  category?: string;
  unit?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  values?: Array<number | string | boolean>;
  experimental?: boolean;
}

export type Capabilities = Record<string, CapabilityDescriptor>;

export interface RecorderState {
  status: "idle" | "starting" | "recording" | "stopping" | "error";
  path?: string;
  durationSeconds?: number;
  droppedBuffers?: number;
  error?: string;
}

export interface RadioState {
  revision: number;
  sourceConnected: boolean;
  receiverRunning: boolean;
  targetVfo: string;
  frequencyHz: number;
  stepHz: number;
  volume: number;
  muted: boolean;
  mode: DemodMode;
  bandwidthHz: number;
  dspAgc?: { enabled: boolean };
  rf?: {
    agcMode?: RfAgcMode;
    attenuationDb?: number;
    lna?: boolean;
    overallGainDb?: number;
  };
  recorder: RecorderState;
  signal?: { snrDb?: number; peakDb?: number; floorDb?: number };
  controls?: Record<string, number | string | boolean>;
}

export type BindingAction = "adjust" | "toggle" | "cycle" | "set";

export interface ControlBinding {
  action: BindingAction;
  control: string;
  amount?: number;
  value?: number | string | boolean;
  inverted?: boolean;
}

export interface ConfigurableMapping {
  title: string;
  rotate?: ControlBinding | undefined;
  press?: ControlBinding | undefined;
  holdRotate?: ControlBinding | undefined;
}

export interface AdapterHello {
  type: "adapter.hello";
  protocolVersion: typeof PROTOCOL_VERSION;
  token: string;
  app: SdrApplication;
  appVersion: string;
  adapterVersion: string;
  architecture: string;
  sourceName: string;
  targetVfo: string;
  capabilities: Capabilities;
}

export interface StateSnapshot {
  type: "state.snapshot";
  state: RadioState;
}

export interface StatePatch {
  type: "state.patch";
  revision: number;
  changes: Record<string, unknown>;
}

export interface Command {
  type: "command";
  id: string;
  method: string;
  params: Record<string, unknown>;
  expectedRevision?: number;
}

export interface CommandResult {
  type: "command.result";
  id: string;
  ok: boolean;
  effectiveState?: RadioState;
  error?: {
    code: "unsupported" | "invalid" | "conflict" | "not_ready" | "host_mismatch" | "io_error" | "internal";
    message: string;
  };
}

export interface Heartbeat {
  type: "heartbeat";
  timestamp: number;
}

export type AdapterInbound = AdapterHello | StateSnapshot | StatePatch | CommandResult | Heartbeat;
export type AdapterOutbound = Command | Heartbeat;

export interface Preset {
  id: string;
  name: string;
  bank?: string;
  frequencyHz: number;
  mode: DemodMode;
  bandwidthHz: number;
  stepHz: number;
  dspAgc?: { enabled: boolean };
  rf?: RadioState["rf"];
  includeAudio?: boolean;
  volume?: number;
  muted?: boolean;
}
