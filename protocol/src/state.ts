import type { RadioState } from "./types.js";

export const OFFLINE_STATE: RadioState = {
  revision: 0,
  sourceConnected: false,
  receiverRunning: false,
  targetVfo: "Radio",
  frequencyHz: 0,
  stepHz: 1000,
  volume: 0.5,
  muted: false,
  mode: "AM",
  bandwidthHz: 6000,
  recorder: { status: "idle" }
};

export function applyStatePatch(state: RadioState, changes: Record<string, unknown>, revision: number): RadioState {
  if (revision <= state.revision) return state;

  const next = structuredClone(state) as RadioState;
  for (const [path, value] of Object.entries(changes)) {
    setPath(next as unknown as Record<string, unknown>, path, value);
  }
  next.revision = revision;
  return next;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!key) continue;
    const existing = cursor[key];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leaf = parts.at(-1);
  if (leaf) cursor[leaf] = value;
}

export function normalizeRadioState(state: RadioState): RadioState {
  return {
    ...state,
    frequencyHz: Math.max(0, Math.round(state.frequencyHz)),
    stepHz: Math.max(1, Math.round(state.stepHz)),
    bandwidthHz: Math.max(1, Math.round(state.bandwidthHz)),
    volume: Math.min(1, Math.max(0, state.volume))
  };
}

