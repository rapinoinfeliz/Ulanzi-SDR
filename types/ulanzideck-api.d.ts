declare module "ulanzideck-api" {
  export interface UlanziMessage {
    context: string;
    uuid?: string;
    key?: string;
    actionid?: string;
    active?: boolean;
    rotateEvent?: "left" | "right" | "hold-left" | "hold-right";
    param?: Record<string, unknown> | Array<Record<string, unknown>> | null;
    settings?: Record<string, unknown>;
  }

  type Handler = (message: UlanziMessage) => void;

  export class UlanziApi {
    connect(uuid: string): void;
    onConnected(handler: () => void): this;
    onClose(handler: () => void): this;
    onError(handler: (error: string) => void): this;
    onAdd(handler: Handler): this;
    onRun(handler: Handler): this;
    onClear(handler: Handler): this;
    onSetActive(handler: Handler): this;
    onParamFromApp(handler: Handler): this;
    onParamFromPlugin(handler: Handler): this;
    onDidReceiveGlobalSettings(handler: Handler): this;
    onKeyDown(handler: Handler): this;
    onKeyUp(handler: Handler): this;
    onDialDown(handler: Handler): this;
    onDialUp(handler: Handler): this;
    onDialRotate(handler: Handler): this;
    onSendToPlugin(handler: Handler): this;
    getGlobalSettings(context?: string): void;
    setGlobalSettings(settings: Record<string, unknown>, context?: string): void;
    setSettings(settings: Record<string, unknown>, context: string): void;
    setStateIcon(context: string, state: number, text?: string): void;
    setFeedbackLayout(context: string, layout: string): void;
    setFeedback(context: string, values: Record<string, unknown>): void;
    showAlert(context: string): void;
    toast(message: string): void;
    logMessage(message: string, level?: "info" | "debug" | "warn" | "error"): void;
  }

  export const Utils: {
    getPluginPath(): string;
  };

  export default UlanziApi;
}
