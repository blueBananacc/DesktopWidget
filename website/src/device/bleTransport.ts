import { BLE_NAME_PREFIX, BLE_RX_UUID, BLE_SERVICE_UUID, BLE_TX_UUID } from "./protocol";
import type { DeviceTransport, InboundMessage, OutboundMessage } from "./protocol";

export const bleSupported = () => typeof navigator !== "undefined" && "bluetooth" in navigator && window.isSecureContext;

const CHUNK = 180;

/** Web Bluetooth 传输：仅 Chrome / Edge 等支持，且需 HTTPS 或 localhost，并由用户点击触发 */
export class BleTransport implements DeviceTransport {
  readonly kind = "ble" as const;
  private device?: BluetoothDevice;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private msgCb?: (m: InboundMessage) => void;
  private discCb?: () => void;
  private buffer = "";
  private queue: InboundMessage[] = []; // onMessage 挂载前收到的消息排队（订阅 TX 后设备立刻回推 hello+区间）

  private emit(m: InboundMessage) {
    if (this.msgCb) this.msgCb(m);
    else this.queue.push(m);
  }

  async connect() {
    if (!bleSupported()) throw new Error("当前浏览器不支持网页蓝牙，请使用电脑版 Chrome 或 Edge");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: BLE_NAME_PREFIX }, { services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID],
    });
    this.device.addEventListener("gattserverdisconnected", () => this.discCb?.());
    const server = await this.device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    this.rx = await service.getCharacteristic(BLE_RX_UUID);
    const tx = await service.getCharacteristic(BLE_TX_UUID);
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      this.buffer += new TextDecoder().decode(value);
      let i: number;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        try {
          this.emit(JSON.parse(line));
        } catch {
          /* 忽略无法解析的帧 */
        }
      }
    });
    return this.device.name ?? "收工牌";
  }

  async disconnect() {
    this.device?.gatt?.disconnect();
  }

  async send(msg: OutboundMessage) {
    if (!this.rx) throw new Error("设备未连接");
    const bytes = new TextEncoder().encode(JSON.stringify(msg) + "\n");
    for (let i = 0; i < bytes.length; i += CHUNK) await this.rx.writeValueWithResponse(bytes.slice(i, i + CHUNK));
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
