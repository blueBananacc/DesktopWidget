import type { DeviceTransport, InboundMessage, OutboundMessage } from "./protocol";

/** 没有硬件时使用的模拟设备：模拟连接延迟，并可在“我的设备”页手动触发设备端事件 */
export class MockTransport implements DeviceTransport {
  readonly kind = "mock" as const;
  private msgCb?: (m: InboundMessage) => void;
  private discCb?: () => void;
  lastState?: OutboundMessage;

  async connect() {
    await new Promise((r) => setTimeout(r, 600));
    return "收工牌-A12（模拟）";
  }
  async disconnect() {
    this.discCb?.();
  }
  async send(msg: OutboundMessage) {
    await new Promise((r) => setTimeout(r, 120));
    if (msg.type === "state") this.lastState = msg;
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
