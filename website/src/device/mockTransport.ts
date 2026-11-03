import type { DeviceTransport, InboundMessage, OutboundMessage } from "./protocol";
import { b64ToU8 } from "./app";

/** 没有硬件时使用的模拟设备：模拟连接延迟，并可在“我的设备”页手动触发设备端事件 */
export class MockTransport implements DeviceTransport {
  readonly kind = "mock" as const;
  private msgCb?: (m: InboundMessage) => void;
  private discCb?: () => void;
  lastState?: OutboundMessage;
  /** 模拟设备 LittleFS 里的自定义屏幕：与固件一样在 run/clear/list 后上报 apps */
  private apps = new Map<string, string>(); // status -> b64
  private upload?: { status: string; size: number; parts: string[] };

  async connect() {
    await new Promise((r) => setTimeout(r, 600));
    setTimeout(() => this.reportApps(), 700);
    return "收工牌-A12（模拟）";
  }
  async disconnect() {
    this.discCb?.();
  }
  async send(msg: OutboundMessage) {
    await new Promise((r) => setTimeout(r, msg.type === "app" && msg.op === "chunk" ? 30 : 120));
    if (msg.type === "state") this.lastState = msg;
    if (msg.type !== "app") return;
    if (msg.op === "begin") this.upload = { status: msg.status, size: msg.size, parts: [] };
    else if (msg.op === "chunk") this.upload?.parts.push(msg.data);
    else if (msg.op === "run" && this.upload) { this.apps.set(this.upload.status, this.upload.parts.join("")); this.upload = undefined; this.reportApps(); }
    else if (msg.op === "clear") { this.apps.delete(msg.status); this.reportApps(); }
    else if (msg.op === "list") this.reportApps();
    else if (msg.op === "dump") {
      const b64 = this.apps.get(msg.status);
      this.msgCb?.(b64 === undefined
        ? { type: "appData", status: msg.status, last: true, missing: true }
        : { type: "appData", status: msg.status, seq: 0, last: true, data: b64 });
    }
  }
  private reportApps() {
    this.msgCb?.({ type: "apps", list: [...this.apps].map(([status, b64]) => ({ status, size: b64ToU8(b64).length })) });
  }
  onMessage(cb: (m: InboundMessage) => void) {
    this.msgCb = cb;
  }
  onDisconnect(cb: () => void) {
    this.discCb = cb;
  }
  /** 模拟设备端操作 */
  emit(msg: InboundMessage) {
    this.msgCb?.(msg);
  }
  /** 模拟信号中断 */
  drop() {
    this.discCb?.();
  }
}
