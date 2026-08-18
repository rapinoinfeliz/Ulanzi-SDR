import { EventEmitter } from "node:events";
import type { Preset } from "../../../protocol/src/types.js";

export interface HubSettings {
  schemaVersion: 1;
  enableV31Feedback: boolean;
  sdrppRigctlPort: number;
  activeLayer: "radio" | "rf" | "memory";
  stepValuesHz: number[];
  presets: Preset[];
}

export const DEFAULT_SETTINGS: HubSettings = {
  schemaVersion: 1,
  enableV31Feedback: false,
  sdrppRigctlPort: 4532,
  activeLayer: "radio",
  stepValuesHz: [1, 10, 100, 500, 1000, 2500, 5000, 6250, 8333, 9000, 10000, 12500, 25000, 50000, 100000],
  presets: []
};

export class SettingsStore extends EventEmitter {
  private value: HubSettings = structuredClone(DEFAULT_SETTINGS);

  get(): HubSettings {
    return structuredClone(this.value);
  }

  replace(candidate: unknown): HubSettings {
    const incoming = isRecord(candidate) ? candidate : {};
    const presets = Array.isArray(incoming.presets) ? incoming.presets.filter(isPreset) : this.value.presets;
    const steps = Array.isArray(incoming.stepValuesHz)
      ? incoming.stepValuesHz.filter((value): value is number => Number.isInteger(value) && value > 0)
      : this.value.stepValuesHz;
    const layer = incoming.activeLayer === "rf" || incoming.activeLayer === "memory" ? incoming.activeLayer : "radio";

    this.value = {
      schemaVersion: 1,
      enableV31Feedback: incoming.enableV31Feedback === true,
      sdrppRigctlPort: Number.isInteger(incoming.sdrppRigctlPort) && Number(incoming.sdrppRigctlPort) >= 1 && Number(incoming.sdrppRigctlPort) <= 65535
        ? Number(incoming.sdrppRigctlPort)
        : this.value.sdrppRigctlPort,
      activeLayer: layer,
      stepValuesHz: steps.length > 0 ? [...new Set(steps)].sort((a, b) => a - b) : [...DEFAULT_SETTINGS.stepValuesHz],
      presets
    };
    this.emit("changed", this.get());
    return this.get();
  }

  update(patch: Partial<HubSettings>): HubSettings {
    return this.replace({ ...this.value, ...patch });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreset(value: unknown): value is Preset {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && Number.isInteger(value.frequencyHz)
    && typeof value.mode === "string"
    && Number.isInteger(value.bandwidthHz)
    && Number.isInteger(value.stepHz);
}
