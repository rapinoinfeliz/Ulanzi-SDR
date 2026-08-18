import { EventEmitter } from "node:events";
import type { UlanziApi, UlanziMessage } from "ulanzideck-api";
import type { ConfigurableMapping, ControlBinding, RadioState } from "../../../protocol/src/types.js";
import type { SettingsStore } from "./config.js";
import type { ControlHub } from "./hub.js";

export type ActionKind = "frequency" | "volume" | "filter" | "mode" | "gain" | "preset" | "recording" | "layer" | "layered" | "configurable";

export const DEFAULT_CONFIGURABLE_MAPPING: ConfigurableMapping = {
  title: "CUSTOM",
  rotate: { action: "adjust", control: "frequencyHz", amount: 1000 },
  press: { action: "cycle", control: "stepHz" },
  holdRotate: { action: "cycle", control: "mode" }
};

export interface ActionContext {
  context: string;
  kind: ActionKind;
  active: boolean;
  isEncoder: boolean;
  dialMovedWhileDown: boolean;
  dialDownAt: number | undefined;
  mapping?: ConfigurableMapping | undefined;
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
    const saved = isRecord(message.settings) ? message.settings : isRecord(message.param) ? message.param : {};
    const configuredKind = isActionKind(saved.kind)
      ? saved.kind
      : kindFromUuid(message.uuid ?? message.context.split("___")[0] ?? "");
    this.contexts.set(message.context, {
      context: message.context,
      kind: configuredKind,
      active: true,
      isEncoder: false,
      dialMovedWhileDown: false,
      dialDownAt: undefined,
      mapping: configuredKind === "configurable" ? normalizeMapping(saved.mapping) : undefined
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

  getActionConfiguration(context: string | undefined): { kind?: ActionKind; mapping?: ConfigurableMapping | undefined } {
    if (!context) return {};
    const item = this.contexts.get(context);
    return item ? { kind: item.kind, mapping: item.mapping ? structuredClone(item.mapping) : undefined } : {};
  }

  configure(context: string, candidate: unknown): ConfigurableMapping {
    const item = this.contexts.get(context);
    if (!item || item.kind !== "configurable") throw new Error("Configurable action is not active");
    const mapping = normalizeMapping(candidate);
    item.mapping = mapping;
    this.api.setSettings({
      kind: "configurable",
      mapping: {
        title: mapping.title,
        rotate: mapping.rotate ?? null,
        press: mapping.press ?? null,
        holdRotate: mapping.holdRotate ?? null
      }
    }, context);
    this.emit("display");
    return structuredClone(mapping);
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
        case "configurable":
          await this.executeBinding(held ? item.mapping?.holdRotate ?? item.mapping?.rotate : item.mapping?.rotate, direction);
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
        case "configurable":
          await this.executeBinding(item.mapping?.press, 1);
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

  private async executeBinding(binding: ControlBinding | undefined, direction: number): Promise<void> {
    if (!binding) return;
    if (!canWrite(this.hub, binding.control)) throw new Error(`${binding.control} is unavailable in the connected SDR`);
    const effectiveDirection = binding.inverted ? -direction : direction;
    switch (binding.action) {
      case "adjust":
        await this.hub.command("control.adjust", { control: binding.control, ticks: effectiveDirection, ...(binding.amount === undefined ? {} : { amount: binding.amount }) });
        break;
      case "cycle":
        await this.hub.command("control.cycle", { control: binding.control, direction: effectiveDirection });
        break;
      case "toggle":
        await this.hub.command("control.toggle", { control: binding.control });
        break;
      case "set":
        await this.hub.command("control.set", { control: binding.control, value: binding.value });
        break;
    }
  }
}

export function kindFromUuid(uuid: string): ActionKind {
  const tail = uuid.split(".").at(-1)?.toLowerCase();
  if (isActionKind(tail)) return tail;
  return "frequency";
}

function isActionKind(value: unknown): value is ActionKind {
  return typeof value === "string" && ["frequency", "volume", "filter", "mode", "gain", "preset", "recording", "layer", "layered", "configurable"].includes(value);
}

export function isRecording(state: RadioState): boolean {
  return state.recorder.status === "recording" || state.recorder.status === "starting";
}

function canWrite(hub: ControlHub, capability: string): boolean {
  const access = hub.getCapabilities()[capability]?.access;
  return access === "write" || access === "readwrite";
}

export function normalizeMapping(candidate: unknown): ConfigurableMapping {
  const value = isRecord(candidate) ? candidate : {};
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 18) : DEFAULT_CONFIGURABLE_MAPPING.title;
  return {
    title,
    rotate: normalizeBinding(value.rotate, DEFAULT_CONFIGURABLE_MAPPING.rotate),
    press: normalizeBinding(value.press, DEFAULT_CONFIGURABLE_MAPPING.press),
    holdRotate: normalizeBinding(value.holdRotate, DEFAULT_CONFIGURABLE_MAPPING.holdRotate)
  };
}

function normalizeBinding(candidate: unknown, fallback: ControlBinding | undefined): ControlBinding | undefined {
  if (candidate === null || candidate === false) return undefined;
  if (!isRecord(candidate)) return fallback ? structuredClone(fallback) : undefined;
  const action = candidate.action;
  const control = candidate.control;
  if (!isBindingAction(action) || typeof control !== "string" || !/^[A-Za-z0-9_.]+$/.test(control)) return fallback ? structuredClone(fallback) : undefined;
  const result: ControlBinding = { action, control };
  if (typeof candidate.amount === "number" && Number.isFinite(candidate.amount) && candidate.amount > 0) result.amount = candidate.amount;
  if (typeof candidate.value === "number" || typeof candidate.value === "string" || typeof candidate.value === "boolean") result.value = candidate.value;
  if (candidate.inverted === true) result.inverted = true;
  return result;
}

function isBindingAction(value: unknown): value is ControlBinding["action"] {
  return value === "adjust" || value === "toggle" || value === "cycle" || value === "set";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
