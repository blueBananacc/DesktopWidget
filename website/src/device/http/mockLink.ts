import type { ByteLink } from "./link";
import { MockDevice } from "./mockDevice";

/** 模拟设备链路：写字节直接喂给 MockDevice 的 HTTP 解析器，设备回帧经 onData 上交 */
export class MockLink implements ByteLink {
  readonly kind = "mock" as const;
  readonly device: MockDevice;
  private dataCb?: (b: Uint8Array) => void;
  private closeCb?: () => void;

  constructor() {
    this.device = new MockDevice((b) => this.dataCb?.(b));
  }

  async open() {
    await new Promise((r) => setTimeout(r, 500));
    this.device.start();
    return "收工牌-A12（模拟）";
  }
  async close() {
    this.device.stop();
    this.closeCb?.();
  }
  async write(bytes: Uint8Array) {
    await new Promise((r) => setTimeout(r, 15));   // 模拟链路延迟
    this.device.feed(bytes);
  }
  onData(cb: (b: Uint8Array) => void) { this.dataCb = cb; }
  onClose(cb: () => void) { this.closeCb = cb; }
  /** 模拟信号中断（设备还在跑，只是链路断了） */
  drop() { this.closeCb?.(); }
}
