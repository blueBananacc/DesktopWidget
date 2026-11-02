// Web Serial API 的最小类型声明（标准 DOM lib 尚未内置）
interface SerialPort {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface Navigator {
  serial: {
    requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
  };
}
