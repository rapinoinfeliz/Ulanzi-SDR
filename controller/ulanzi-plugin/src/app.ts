import UlanziApi, { Utils } from "ulanzideck-api";
import type { UlanziMessage } from "ulanzideck-api";
import { WebSocket } from "ws";
import { ActionController } from "./actions.js";
import { SettingsStore } from "./config.js";
import { EndpointPublisher } from "./endpoint.js";
import { ControlHub } from "./hub.js";
import { UlanziRenderer } from "./renderer.js";
import { SdrppRigctlAdapter } from "./rigctl.js";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.sdrcontrol";
const api = new UlanziApi();
const settings = new SettingsStore();
const endpoint = new EndpointPublisher(Utils.getPluginPath());
const hub = new ControlHub(endpoint.token);
const actions = new ActionController(api, hub, settings);
const renderer = new UlanziRenderer(api, actions, settings, hub);

const port = await hub.start();
await endpoint.publish(port);
const rigctlAdapter = process.platform === "darwin" && process.env.ULANZI_SDR_DISABLE_RIGCTL !== "1"
  ? new SdrppRigctlAdapter(port, endpoint.token, settings.get().sdrppRigctlPort)
  : undefined;
rigctlAdapter?.start();

hub.on("state", (state) => renderer.schedule(state, state.recorder.status === "recording" || state.muted));
actions.on("display", () => renderer.schedule(hub.getState(), true));
hub.on("adapter", (hello) => api.toast(`${hello.app} connected: ${hello.sourceName}`));
hub.on("warning", (error) => api.logMessage(String(error), "warn"));
hub.on("property-inspector", (socket: WebSocket, context?: string) => sendInspectorSnapshot(socket, context));
hub.on("configuration-request", (candidate) => {
  const updated = settings.replace(candidate);
  api.setGlobalSettings({ ...updated });
});
hub.on("action-configuration-request", (context: string, candidate: unknown, socket: WebSocket) => {
  try {
    actions.configure(context, candidate);
    sendInspectorSnapshot(socket, context);
  } catch (error) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
  }
});
settings.on("changed", (updated) => {
  rigctlAdapter?.setPort(updated.sdrppRigctlPort);
  hub.broadcastConfiguration(updated);
  renderer.schedule(hub.getState(), true);
});

api.connect(PLUGIN_UUID);
api.onConnected(() => {
  api.logMessage(`Ulanzi SDR hub listening on 127.0.0.1:${port}`);
  api.getGlobalSettings();
});
api.onClose(() => api.logMessage("Disconnected from Ulanzi Studio", "warn"));
api.onError((error) => api.logMessage(error, "error"));
api.onAdd((message) => {
  actions.add(message);
  api.getSettings(message.context);
  const context = actions.contexts.get(message.context);
  if (context) renderer.renderContext(context, hub.getState());
});
api.onClear((message) => actions.clear(message));
api.onSetActive((message) => actions.setActive(message));
api.onRun((message) => actions.run(message));
api.onKeyDown(() => undefined);
api.onKeyUp(() => undefined);
api.onDialDown((message) => actions.dialDown(message));
api.onDialUp((message) => actions.dialUp(message));
api.onDialRotate((message) => actions.rotate(message));
api.onParamFromApp((message) => refreshAction(message));
api.onParamFromPlugin((message) => refreshAction(message));
api.onDidReceiveGlobalSettings((message) => settings.replace(message.settings ?? message.param));
api.onDidReceiveSettings((message) => refreshAction(message));

function refreshAction(message: UlanziMessage): void {
  actions.add(message);
  const context = actions.contexts.get(message.context);
  if (context) renderer.renderContext(context, hub.getState());
}

function sendInspectorSnapshot(socket: WebSocket, context?: string): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: "config.snapshot",
    settings: settings.get(),
    action: actions.getActionConfiguration(context),
    capabilities: hub.getCapabilities(),
    state: hub.getState(),
    adapter: hub.getAdapterDescription()
  }));
}

async function shutdown(): Promise<void> {
  rigctlAdapter?.stop();
  await hub.close();
  await endpoint.cleanup();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.once("beforeExit", () => void endpoint.cleanup());
