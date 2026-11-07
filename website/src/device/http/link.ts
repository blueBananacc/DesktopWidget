/** 字节通道：BLE / 串口 / 模拟设备都只负责搬运字节，HTTP 语义在 TunnelClient 里（tunnel.md §7） */
export interface ByteLink {
  readonly kind: "mock" | "ble" | "serial";
  /** 打开通道（可能弹出浏览器设备选择框），返回通道层面的设备名 */
  open(): Promise<string>;
  /** 静默重连：只用浏览器已授权的设备/端口，不弹选择框 */
  openGranted?(): Promise<string>;
  close(): Promise<void>;
  /** 按顺序写出；调用方保证同一时刻只有一个 write 在途 */
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): void;
  onClose(cb: () => void): void;
}
