import type { ByteLink } from "./link";

/** Chrome/Edge 桌面版 + localhost/HTTPS 下可用 */
export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * USB 串口字节通道（CH343，460800 8N1）。
 * 固件日志与 HTTP 帧共用 UART——解析器（codec.MessageParser）负责丢弃非报文字节。
 */
export class SerialLink implements ByteLink {
  readonly kind = "serial" as const;
  private port?: SerialPort;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private dataCb?: (b: Uint8Array) => void;
  private closeCb?: () => void;
  private closed = false;

  async open() {
    if (!serialSupported()) throw new Error("当前浏览器不支持网页串口，请使用电脑版 Chrome 或 Edge");
    const granted = await navigator.serial.getPorts();
    return this.attach(granted.length === 1 ? granted[0] : await navigator.serial.requestPort());
  }

  /** 静默重连：只用已授权的端口，没有就失败（页面刷新后自动恢复用，绝不弹选择框） */
  async openGranted() {
    if (!serialSupported()) throw new Error("当前浏览器不支持网页串口");
    const granted = await navigator.serial.getPorts();
    if (!granted.length) throw new Error("没有已授权的串口");
    return this.attach(granted[0]);
  }

  private async attach(port: SerialPort) {
    this.port = port;
    await port.open({ baudRate: 460800 });   // 与固件 Serial.begin 一致：音频帧流需要 >11.5KB/s
    this.closed = false;
    void this.readLoop();
    this.writer = this.port.writable!.getWriter();
    await delay(2200);                        // 打开端口可能触发 DTR 复位，等板子启动
    return "收工牌(串口)";
  }

  private async readLoop() {
    const reader = this.port!.readable!.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) this.dataCb?.(value);
      }
    } catch {
      /* 拔掉 USB 或端口错误 */
    }
    if (!this.closed) this.closeCb?.();
  }

  async close() {
    this.closed = true;
    try { await this.reader?.cancel(); } catch { /* noop */ }
    try { this.reader?.releaseLock(); } catch { /* noop */ }
    try { this.writer?.releaseLock(); } catch { /* noop */ }
    try { await this.port?.close(); } catch { /* noop */ }
  }

  async write(bytes: Uint8Array) {
    if (!this.writer) throw new Error("串口未连接");
    await this.writer.write(bytes);
  }

  onData(cb: (b: Uint8Array) => void) { this.dataCb = cb; }
  onClose(cb: () => void) { this.closeCb = cb; }
}
