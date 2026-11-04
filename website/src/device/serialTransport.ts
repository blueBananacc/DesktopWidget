import type { DeviceTransport, InboundMessage, OutboundMessage } from "./protocol";

/** Chrome/Edge 桌面版 + localhost/HTTPS 下可用 */
export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator && window.isSecureContext;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * USB 串口传输：与 BLE 相同的 JSON + \n 协议，走 CH343 有线通道。
 * 用于没有蓝牙适配器的电脑联调；固件日志等非 JSON 行会被忽略。
 */
export class SerialTransport implements DeviceTransport {
  readonly kind = "serial" as const;
  private port?: SerialPort;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private msgCb?: (m: InboundMessage) => void;
  private discCb?: () => void;
  private helloRes?: (name: string) => void;
  private buffer = "";
  private queue: InboundMessage[] = []; // onMessage 挂载前收到的消息排队（sync 握手后设备立刻回推 hello+区间）
  private closed = false;

  private emit(m: InboundMessage) {
    if (this.msgCb) this.msgCb(m);
    else this.queue.push(m);
  }

  async connect() {
    if (!serialSupported()) throw new Error("当前浏览器不支持网页串口，请使用电脑版 Chrome 或 Edge");
    // 已授权过的端口直接复用（重连免弹选择框）；没有或多个授权时再让用户挑
    const granted = await navigator.serial.getPorts();
    return this.open(granted.length === 1 ? granted[0] : await navigator.serial.requestPort());
  }

  /** 静默重连：只用已授权的端口，没有就失败（页面刷新后自动恢复用，绝不弹选择框） */
  async connectGranted() {
    if (!serialSupported()) throw new Error("当前浏览器不支持网页串口");
    const granted = await navigator.serial.getPorts();
    if (!granted.length) throw new Error("没有已授权的串口");
    return this.open(granted[0]);
  }

  private async open(port: SerialPort) {
    this.port = port;
    await port.open({ baudRate: 460800 });   // 与固件 Serial.begin 一致：音频帧流需要 >11.5KB/s
    this.closed = false;
    void this.readLoop();
    this.writer = this.port.writable!.getWriter();
    await delay(2200); // 打开端口可能触发 DTR 复位，等板子启动
    const hello = new Promise<string>((res) => { this.helloRes = res; });
    const fallback = delay(2500).then(() => "收工牌(串口)");
    try {
      await this.send({ type: "sync" });
    } catch {
      return "收工牌(串口)";
    }
    const name = await Promise.race([hello, fallback]);
    this.helloRes = undefined;
    return name;
  }

  private async readLoop() {
    const reader = this.port!.readable!.getReader();
    this.reader = reader;
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        this.buffer += dec.decode(value, { stream: true });
        let i: number;
        while ((i = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, i);
          this.buffer = this.buffer.slice(i + 1);
          if (!line.trim()) continue;
          try {
            const m = JSON.parse(line) as InboundMessage;
            if (m.type === "hello" && this.helloRes) {
              this.helloRes(m.name);
              this.helloRes = undefined;
            }
            this.emit(m);
          } catch {
            /* 固件日志等非 JSON 行忽略 */
          }
        }
      }
    } catch {
      /* 拔掉 USB 或端口错误 */
    }
    if (!this.closed) this.discCb?.();
  }

  async disconnect() {
    this.closed = true;
    try { await this.reader?.cancel(); } catch { /* noop */ }
    try { this.reader?.releaseLock(); } catch { /* noop */ }
    try { this.writer?.releaseLock(); } catch { /* noop */ }
    try { await this.port?.close(); } catch { /* noop */ }
  }

  async send(msg: OutboundMessage) {
    if (!this.writer) throw new Error("串口未连接");
    await this.writer.write(new TextEncoder().encode(JSON.stringify(msg) + "\n"));
  }

  onMessage(cb: (m: InboundMessage) => void) {
    this.msgCb = cb;
    for (const m of this.queue) cb(m);
    this.queue = [];
  }
  onDisconnect(cb: () => void) {
    this.discCb = cb;
  }
}
