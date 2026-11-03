import type { DeviceTransport } from "./protocol";

/**
 * 自定义屏幕（WASM）管线：用户/Agent 写 WAT（网页端 wabt 编译）或本地用 clang
 * 编译成 .wasm，二进制经 app 协议分片上传 → 设备 LittleFS /app_<status>.wasm →
 * wasm3 沙箱按状态执行。预览 = 浏览器 WebAssembly 跑同一份二进制，宿主函数
 * Shim 到 128×64 帧缓冲——看到的就是设备上跑的。
 */

export const APP_W = 128;
export const APP_H = 64;
export const APP_MAX_BYTES = 48 * 1024; // 与固件 APP_MAX_SIZE 一致
const CHUNK_BYTES = 1024;                // 每条 chunk 消息解码后的数据量

// ---------- base64 ----------

export const u8ToB64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 256) s += String.fromCharCode(...u8.subarray(i, i + 256));
  return btoa(s);
};

export const b64ToU8 = (b64: string) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

// ---------- WAT → wasm（wabt 懒加载，~1.5MB 仅在用到时下载） ----------

let wabtP: Promise<WabtModule> | undefined;
interface WabtModule { parseWat(name: string, src: string): { toBinary(o: { write_debug_names: boolean }): { buffer: ArrayBuffer } } }
const wabt = () => (wabtP ??= import("wabt").then((m) => ((m.default ?? m) as unknown as () => Promise<WabtModule>)()));

export async function compileWat(src: string): Promise<Uint8Array> {
  const w = await wabt();
  try {
    const { buffer } = w.parseWat("screen.wat", src).toBinary({ write_debug_names: false });
    return new Uint8Array(buffer);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

// ---------- 预览：实例化 wasm + 与设备同语的宿主 shim ----------

export interface ScreenPreview { stop(): void; }

/**
 * 在 canvas 上运行 wasm app：每 ~33ms 调一次 run()（与固件节流一致）。
 * 宿主语义与固件一致：px/rect 写 u8g2 页序缓冲，text 画 6x10 ASCII，
 * buttons 返回按键位掩码（预览中按数字键 1-4 模拟 K1-K4）。
 * run() 抛错（wasm trap）即停止并报给 onError。
 */
export async function previewScreen(bytes: Uint8Array, canvas: HTMLCanvasElement, onError?: (msg: string) => void): Promise<ScreenPreview> {
  const ctx = canvas.getContext("2d")!;
  const fb = new Uint8Array(1024); // u8g2 页序 1bpp
  let mask = 0;
  const px = (x: number, y: number) => { x |= 0; y |= 0; if (x >= 0 && x < APP_W && y >= 0 && y < APP_H) fb[(y >> 3) * APP_W + x] |= 1 << (y & 7); };
  const env = {
    clear: () => fb.fill(0),
    show: () => drawFrameTo(ctx, fb),
    px,
    rect: (x: number, y: number, w: number, h: number, fill: number) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (fill || i === 0 || j === 0 || i === w - 1 || j === h - 1) px(x + i, y + j);
    },
    text: (x: number, y: number, ptr: number, len: number) => {
      if (!mem || len <= 0 || len > 64) return;
      const s = new TextDecoder().decode(new Uint8Array(mem.buffer, ptr, len));
      drawFrameTo(ctx, fb);                                        // 先落当前缓冲（px/rect 的累计内容）
      ctx.font = "10px monospace"; ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic";
      ctx.fillText(s, x, y);                                       // 近似固件 6x10 字体的基线语义
      const d = ctx.getImageData(0, 0, APP_W, APP_H).data;         // 合成结果重新打包回页序缓冲
      for (let p = 0; p < 8; p++) for (let xx = 0; xx < APP_W; xx++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) if (d[((p * 8 + bit) * APP_W + xx) * 4] > 127) b |= 1 << bit;
        fb[p * APP_W + xx] = b;
      }
    },
    millis: () => performance.now() | 0,
    buttons: () => mask,
    status: () => 0,
  };
  let mem: WebAssembly.Memory | null = null;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes.slice().buffer), { env });
  mem = (instance.exports.memory as WebAssembly.Memory | undefined) ?? null;
  const run = instance.exports.run as () => void;
  if (typeof run !== "function") throw new Error("模块需要导出 run() 函数");

  const keymap = (e: KeyboardEvent, down: boolean) => {
    const i = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
    if (i >= 0) { e.preventDefault(); if (down) mask |= 1 << i; else mask &= ~(1 << i); }
  };
  const dn = (e: KeyboardEvent) => keymap(e, true);
  const up = (e: KeyboardEvent) => keymap(e, false);
  window.addEventListener("keydown", dn);
  window.addEventListener("keyup", up);

  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    try { run(); } catch (e) {
      stopFn();
      onError?.(e instanceof Error ? e.message : String(e));
    }
  }, 33);
  const stopFn = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("keydown", dn);
    window.removeEventListener("keyup", up);
  };
  return { stop: stopFn };
}

// ---------- 上传 ----------

/** 把 wasm 二进制分片写入设备某状态的存储槽；设备收齐落 flash，进入该状态自动执行。 */
export async function sendApp(t: DeviceTransport, status: string, bytes: Uint8Array, onProgress?: (sent: number) => void) {
  if (!bytes.length) throw new Error("空的 wasm 模块");
  if (bytes.length > APP_MAX_BYTES) throw new Error(`wasm 超过 ${APP_MAX_BYTES / 1024}KB 上限（${bytes.length}B）`);
  await t.send({ type: "app", op: "begin", status, size: bytes.length });
  for (let off = 0; off < bytes.length; off += CHUNK_BYTES) {
    await t.send({ type: "app", op: "chunk", data: u8ToB64(bytes.subarray(off, off + CHUNK_BYTES)) });
    onProgress?.(Math.min(off + CHUNK_BYTES, bytes.length) / bytes.length);
  }
  await t.send({ type: "app", op: "run" });
}

export const stopApp = (t: DeviceTransport) => t.send({ type: "app", op: "stop" });
export const clearApp = (t: DeviceTransport, status: string) => t.send({ type: "app", op: "clear", status });

// ---------- 预览渲染 ----------

/** 把 u8g2 页序 1bpp 帧画到 canvas（亮=白）。 */
export function drawFrameTo(ctx: CanvasRenderingContext2D, frame: Uint8Array) {
  const img = ctx.createImageData(APP_W, APP_H);
  for (let p = 0; p < 8; p++) for (let x = 0; x < APP_W; x++) {
    const byte = frame[p * APP_W + x];
    for (let b = 0; b < 8; b++) {
      const on = byte & (1 << b);
      const o = ((p * 8 + b) * APP_W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = on ? 255 : 17;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
