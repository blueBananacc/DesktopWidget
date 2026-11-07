import { BLE_NAME_PREFIX, BLE_RX_UUID, BLE_SERVICE_UUID, BLE_TX_UUID } from "../protocol";
import type { ByteLink } from "./link";

export const bleSupported = () => typeof navigator !== "undefined" && "bluetooth" in navigator && window.isSecureContext;

const CHUNK = 180;   // ATT MTU 内安全分片

/** Web Bluetooth 字节通道：仅 Chrome / Edge 等支持，且需 HTTPS 或 localhost，并由用户点击触发 */
export class BleLink implements ByteLink {
  readonly kind = "ble" as const;
  private device?: BluetoothDevice;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private dataCb?: (b: Uint8Array) => void;
  private closeCb?: () => void;
  private queue: Uint8Array[] = []; // onData 挂载前收到的数据排队（订阅 notify 后设备可能立刻回帧）

  async open() {
    if (!bleSupported()) throw new Error("当前浏览器不支持网页蓝牙，请使用电脑版 Chrome 或 Edge");
    return this.attach(await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: BLE_NAME_PREFIX }, { services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID],
    }));
  }

  /** 静默重连：只用浏览器已授权的设备，不弹选择框（页面刷新后自动恢复连接用；已授权设备的 gatt.connect 不需要用户手势） */
  async openGranted() {
    if (!bleSupported()) throw new Error("当前浏览器不支持网页蓝牙");
    const dev = (await navigator.bluetooth.getDevices()).find((d) => d.name?.startsWith(BLE_NAME_PREFIX));
    if (!dev) throw new Error("没有已授权的蓝牙设备");
    return this.attach(dev);
  }

  private async attach(device: BluetoothDevice) {
    this.device = device;
    device.addEventListener("gattserverdisconnected", () => this.closeCb?.());
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    this.rx = await service.getCharacteristic(BLE_RX_UUID);
    const tx = await service.getCharacteristic(BLE_TX_UUID);
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value?.byteLength) return;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (this.dataCb) this.dataCb(bytes);
      else this.queue.push(bytes);
    });
    return this.device.name ?? "收工牌";
  }

  async close() {
    this.device?.gatt?.disconnect();
  }

  async write(bytes: Uint8Array) {
    if (!this.rx) throw new Error("设备未连接");
    for (let i = 0; i < bytes.length; i += CHUNK) await this.rx.writeValueWithResponse(bytes.slice(i, i + CHUNK));
  }

  onData(cb: (b: Uint8Array) => void) {
    this.dataCb = cb;
    for (const b of this.queue) cb(b);
    this.queue = [];
  }
  onClose(cb: () => void) { this.closeCb = cb; }
}
