import type { UlanziApi } from "ulanzideck-api";
import type { Capabilities, RadioState } from "../../../protocol/src/types.js";
import type { ActionController, ActionContext } from "./actions.js";
import { isRecording } from "./actions.js";
import type { SettingsStore } from "./config.js";
import type { ControlHub } from "./hub.js";

export class UlanziRenderer {
  private timer: NodeJS.Timeout | undefined;
  private pendingState: RadioState | undefined;

  constructor(
    private readonly api: UlanziApi,
    private readonly actions: ActionController,
    private readonly settings: SettingsStore,
    private readonly hub: ControlHub
  ) {}

  schedule(state: RadioState, immediate = false): void {
    this.pendingState = state;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renderPending(), immediate ? 0 : 100);
  }

  renderContext(context: ActionContext, state: RadioState): void {
    const { title, value, active } = displayValue(context, state, this.actions.getSelectedPresetName(), this.settings.get().activeLayer, this.hub.getCapabilities());
    const stateIndex = !state.sourceConnected ? 0 : active ? 2 : 1;
    this.api.setStateIcon(context.context, stateIndex, `${title}\n${value}`);

    if (context.isEncoder && this.settings.get().enableV31Feedback) {
      try {
        this.api.setFeedbackLayout(context.context, "$UA2");
        this.api.setFeedback(context.context, {
          text2: { text: value },
          title: { text: title }
        });
      } catch (error) {
        this.api.logMessage(`D200X V3.1 feedback disabled after error: ${String(error)}`, "warn");
        const updated = this.settings.update({ enableV31Feedback: false });
        this.api.setGlobalSettings({ ...updated });
      }
    }
  }

  private renderPending(): void {
    const state = this.pendingState;
    this.pendingState = undefined;
    this.timer = undefined;
    if (!state) return;
    for (const context of this.actions.contexts.values()) {
      if (context.active) this.renderContext(context, state);
    }
  }
}

function displayValue(
  context: ActionContext,
  state: RadioState,
  presetName: string | undefined,
  layer: string,
  capabilities: Capabilities
): { title: string; value: string; active: boolean } {
  if (!state.sourceConnected) return { title: "SDR", value: "OFFLINE", active: false };
  switch (context.kind) {
    case "frequency": return { title: "TUNE", value: formatFrequency(state.frequencyHz), active: false };
    case "volume": return supports(capabilities, "volume") && supports(capabilities, "muted")
      ? { title: state.muted ? "MUTE" : "VOL", value: state.muted ? "ON" : `${Math.round(state.volume * 100)}%`, active: state.muted }
      : { title: "VOLUME", value: "UNAVAILABLE", active: false };
    case "filter": return { title: state.mode, value: formatFrequency(state.bandwidthHz), active: false };
    case "mode": return { title: "MODE", value: state.mode, active: false };
    case "gain": return supports(capabilities, "rf.agcMode") || supports(capabilities, "rf.attenuationDb") || supports(capabilities, "rf.lna")
      ? { title: `AGC ${(state.rf?.agcMode ?? "N/A").toUpperCase()}`, value: state.rf?.attenuationDb === undefined ? "N/A" : `ATT ${state.rf.attenuationDb}dB`, active: state.rf?.lna === true }
      : { title: "RF GAIN", value: "UNAVAILABLE", active: false };
    case "preset": return { title: "PRESET", value: presetName ?? "EMPTY", active: false };
    case "recording": return { title: "REC", value: isRecording(state) ? "ON" : state.recorder.status.toUpperCase(), active: isRecording(state) };
    case "layer": return { title: "LAYER", value: layer.toUpperCase(), active: false };
    case "layered": {
      if (layer === "memory") return { title: "MEMORY", value: presetName ?? "EMPTY", active: false };
      if (layer === "rf") return supports(capabilities, "rf.attenuationDb") || supports(capabilities, "rf.agcMode")
        ? { title: `RF ${(state.rf?.agcMode ?? "N/A").toUpperCase()}`, value: state.rf?.attenuationDb === undefined ? "N/A" : `ATT ${state.rf.attenuationDb}dB`, active: state.rf?.lna === true }
        : { title: "RF", value: "UNAVAILABLE", active: false };
      return { title: "TUNE", value: formatFrequency(state.frequencyHz), active: false };
    }
  }
}

function supports(capabilities: Capabilities, name: string): boolean {
  return capabilities[name]?.access === "readwrite" || capabilities[name]?.access === "read" || capabilities[name]?.access === "write";
}

function formatFrequency(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 3 : 5)} MHz`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 3)} kHz`;
  return `${value} Hz`;
}
