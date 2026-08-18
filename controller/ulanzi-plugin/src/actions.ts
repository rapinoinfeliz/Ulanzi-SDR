import { EventEmitter } from "node:events";
import type { UlanziApi, UlanziMessage } from "ulanzideck-api";
import type { RadioState } from "../../../protocol/src/types.js";
import type { SettingsStore } from "./config.js";
import type { ControlHub } from "./hub.js";

export type ActionKind = "frequency" | "volume" | "filter" | "mode" | "gain" | "preset" | "recording" | "layer" | "layered";

export interface ActionContext {
  context: string;
  kind: ActionKind;
  active: boolean;
  isEncoder: boolean;
  dialMovedWhileDown: boolean;
  dialDownAt: number | undefined;
}

export class ActionController extends EventEmitter {
  readonly contexts = new Map<string, ActionContext>();
  private selectedPreset = 0;

  constructor(
    private readonly api: UlanziApi,
    private readonly hub: ControlHub,
    private readonly settings: SettingsStore
  ) { super(); }

  add(message: UlanziMessage): void {
    const configuredKind = isActionKind((message.param as Record<string, unknown> | undefined)?.kind)
      ? (message.param as Record<string, unknown>).kind as ActionKind
      : kindFromUuid(message.uuid ?? message.context.split("___")[0] ?? "");
    this.contexts.set(message.context, {
      context: message.context,
      kind: configuredKind,
      active: true,
      isEncoder: false,
      dialMovedWhileDown: false,
      dialDownAt: undefined
    });
  }

  clear(message: UlanziMessage): void {
    const values = Array.isArray(message.param) ? message.param : [];
    for (const value of values) {
      const context = typeof value.context === "string" ? value.context : undefined;
      if (context) this.contexts.delete(context);
    }
  }

  setActive(message: UlanziMessage): void {
    const item = this.contexts.get(message.context);
    if (item) item.active = message.active !== false;
  }

  dialDown(message: UlanziMessage): void {
    const item = this.ensure(message);
    item.isEncoder = true;
    item.dialMovedWhileDown = false;
    item.dialDownAt = Date.now();
  }

  dialUp(message: UlanziMessage): void {
    const item = this.ensure(message);
    item.isEncoder = true;
    const elapsed = item.dialDownAt ? Date.now() - item.dialDownAt : 0;
    item.dialDownAt = undefined;
    if (!item.dialMovedWhileDown && elapsed < 800) void this.press(item);
  }

  rotate(message: UlanziMessage): void {
    const item = this.ensure(message);
    item.isEncoder = true;
    const event = message.rotateEvent ?? "right";
    const direction = event.endsWith("left") ? -1 : 1;
    const held = event.startsWith("hold-");
    if (held || item.dialDownAt) item.dialMovedWhileDown = true;
    void this.rotateAction(item, direction, held);
  }

  run(message: UlanziMessage): void {
    void this.press(this.ensure(message));
  }

  getSelectedPresetName(): string | undefined {
    return this.settings.get().presets[this.selectedPreset]?.name;
  }

  private ensure(message: UlanziMessage): ActionContext {
    let item = this.contexts.get(message.context);
    if (!item) {
      this.add(message);
      item = this.contexts.get(message.context);
    }
    if (!item) throw new Error("Failed to create action context");
    return item;
  }

  private async rotateAction(item: ActionContext, direction: number, held: boolean): Promise<void> {
    try {
      switch (item.kind) {
        case "frequency":
          if (held) await this.cycleStep(direction);
          else await this.hub.command("control.adjust", { control: "frequencyHz", ticks: direction });
          break;
        case "volume":
          await this.hub.command("control.adjust", { control: "volume", ticks: direction });
          break;
        case "filter":
          await this.hub.command(held ? "control.cycle" : "control.adjust", held
            ? { control: "mode", direction }
            : { control: "bandwidthHz", ticks: direction });
          break;
        case "mode":
          await this.hub.command("control.cycle", { control: "mode", direction });
          break;
        case "gain":
          await this.hub.command(held ? "control.cycle" : "control.adjust", held
            ? { control: "rf.agcMode", direction }
            : { control: "rf.attenuationDb", ticks: -direction });
          break;
        case "preset": {
          const count = this.settings.get().presets.length;
          if (count > 0) this.selectedPreset = (this.selectedPreset + direction + count) % count;
          this.emit("display");
          break;
        }
        case "layered":
          await this.rotateLayered(direction, held);
          break;
        case "recording":
        case "layer":
          break;
      }
    } catch (error) {
      this.api.showAlert(item.context);
      this.api.logMessage(error instanceof Error ? error.message : String(error), "warn");
    }
  }

  private async press(item: ActionContext): Promise<void> {
    const state = this.hub.getState();
    try {
      switch (item.kind) {
        case "frequency":
          await this.cycleStep(1);
          break;
        case "volume":
          await this.hub.command("control.set", { control: "muted", value: !state.muted });
          break;
        case "filter":
        case "mode":
          await this.hub.command("control.cycle", { control: "mode", direction: 1 });
          break;
        case "gain":
          if (canWrite(this.hub, "rf.lna")) await this.hub.command("control.set", { control: "rf.lna", value: state.rf?.lna !== true });
          else await this.hub.command("control.cycle", { control: "rf.agcMode", direction: 1 });
          break;
        case "preset": {
          const preset = this.settings.get().presets[this.selectedPreset];
          if (preset) await this.hub.command("preset.apply", { preset });
          break;
        }
        case "recording":
          await this.hub.command("record.audio.set", { enabled: state.recorder.status !== "recording" });
          break;
        case "layer":
          this.cycleLayer();
          break;
        case "layered":
          await this.pressLayered();
          break;
      }
    } catch (error) {
      this.api.showAlert(item.context);
      this.api.logMessage(error instanceof Error ? error.message : String(error), "warn");
    }
  }

  private cycleLayer(): void {
    const layers = ["radio", "rf", "memory"] as const;
    const current = this.settings.get().activeLayer;
    const next = layers[(layers.indexOf(current) + 1) % layers.length] ?? "radio";
    const updated = this.settings.update({ activeLayer: next });
    this.api.setGlobalSettings({ ...updated });
    this.api.toast(`SDR layer: ${next.toUpperCase()}`);
  }

  private async rotateLayered(direction: number, held: boolean): Promise<void> {
    switch (this.settings.get().activeLayer) {
      case "radio":
        if (held) await this.cycleStep(direction);
        else await this.hub.command("control.adjust", { control: "frequencyHz", ticks: direction });
        break;
      case "rf":
        await this.hub.command(held ? "control.cycle" : "control.adjust", held
          ? { control: "rf.agcMode", direction }
          : { control: "rf.attenuationDb", ticks: -direction });
        break;
      case "memory": {
        const count = this.settings.get().presets.length;
        if (count > 0) this.selectedPreset = (this.selectedPreset + direction + count) % count;
        this.emit("display");
        break;
      }
    }
  }

  private async pressLayered(): Promise<void> {
    switch (this.settings.get().activeLayer) {
      case "radio":
        await this.cycleStep(1);
        break;
      case "rf":
        if (canWrite(this.hub, "rf.lna")) {
          await this.hub.command("control.set", { control: "rf.lna", value: this.hub.getState().rf?.lna !== true });
        } else {
          await this.hub.command("control.cycle", { control: "rf.agcMode", direction: 1 });
        }
        break;
      case "memory": {
        const preset = this.settings.get().presets[this.selectedPreset];
        if (preset) await this.hub.command("preset.apply", { preset });
        break;
      }
    }
  }

  private async cycleStep(direction: number): Promise<void> {
    const values = this.settings.get().stepValuesHz;
    if (values.length === 0) return;
    const current = this.hub.getState().stepHz;
    const exact = values.indexOf(current);
    const start = exact >= 0 ? exact : values.findIndex((value) => value >= current);
    const index = start >= 0 ? start : values.length - 1;
    const next = values[(index + (direction < 0 ? -1 : 1) + values.length) % values.length];
    await this.hub.command("control.set", { control: "stepHz", value: next });
  }
}

export function kindFromUuid(uuid: string): ActionKind {
  const tail = uuid.split(".").at(-1)?.toLowerCase();
  if (isActionKind(tail)) return tail;
  return "frequency";
}

function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && ["frequency", "volume", "filter", "mode", "gain", "preset", "recording", "layer", "layered"].includes(value);
}

export function isRecording(state: RadioState): boolean {
  return state.recorder.status === "recording" || state.recorder.status === "starting";
}

function canWrite(hub: ControlHub, capability: string): boolean {
  const access = hub.getCapabilities()[capability]?.access;
  return access === "write" || access === "readwrite";
}
