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
interface WabtModule { parseWat(name: string, src: Uint8Array): { toBinary(o: { write_debug_names: boolean }): { buffer: ArrayBuffer } } }
const wabt = () => (wabtP ??= import("wabt").then((m) => ((m.default ?? m) as unknown as () => Promise<WabtModule>)()));

export async function compileWat(src: string): Promise<Uint8Array> {
  const w = await wabt();
  try {
    // 必须传 UTF-8 字节：wabt 对 string 走 writeAsciiToMemory，中文注释会被截成单字节乱码（低字节恰为 \n 时直接断行报错）
    const utf8 = new TextEncoder().encode(src).slice(); // slice 保证底层 buffer 恰好等长（wabt 按 buffer.byteLength 拷贝）
    const { buffer } = w.parseWat("screen.wat", utf8).toBinary({ write_debug_names: false });
    return new Uint8Array(buffer);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

// ---------- 预览：实例化 wasm + 与设备同语的宿主 shim ----------

export interface ScreenPreview { stop(): void; press(key: number, down: boolean): void }
export interface PreviewOpts {
  status?: number; keyboard?: boolean; onError?: (msg: string) => void;
  /** 当前状态的区间起点（epoch ms）；不传则 segSec 从预览启动起算 */
  segStart?: number;
  /** 距下个计划节点的分钟数（-1 无），页面按 settings 计算后传入 */
  nodeMin?: () => number;
}

/**
 * 在 canvas 上运行 wasm app：每 ~33ms 调一次 run()（与固件节流一致）。
 * 宿主语义与固件一致：px/rect 写 u8g2 页序缓冲，text 画 6x10 ASCII，
 * buttons 返回按键位掩码（press() 或 keyboard=true 时数字键 1-4 模拟 K1-K4），
 * status 返回 opts.status（与固件 STATUSES 下标一致）。
 * run() 抛错（wasm trap）即停止并报给 onError。
 */
export async function previewScreen(bytes: Uint8Array, canvas: HTMLCanvasElement, opts: PreviewOpts = {}): Promise<ScreenPreview> {
  const { status = 0, keyboard = false, onError } = opts;
  const ctx = canvas.getContext("2d")!;
  const fb = new Uint8Array(1024); // u8g2 页序 1bpp
  let mask = 0;
  const segStart = opts.segStart ?? Date.now(); // segSec 语义：当前状态已持续秒数；未知起点时按"刚进入状态"预览
  const px = (x: number, y: number) => { x |= 0; y |= 0; if (x >= 0 && x < APP_W && y >= 0 && y < APP_H) fb[(y >> 3) * APP_W + x] |= 1 << (y & 7); };
  const env = {
    clear: () => fb.fill(0),
    show: () => drawFrameTo(ctx, fb),
    px,
    rect: (x: number, y: number, w: number, h: number, fill: number) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (fill || i === 0 || j === 0 || i === w - 1 || j === h - 1) px(x + i, y + j);
    },
    text: (x: number, y: number, ptr: number, len: number) => {
      if (!mem) throw new Error("text() 需要模块导出线性内存：把 (memory 1) 改成 (memory (export \"memory\") 1)");
      if (len <= 0 || len > 64) return;
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
    status: () => status,
    clock: () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, // 与设备校时后同值；浏览器时钟即本地时间
    segSec: () => Math.max(0, ((Date.now() - segStart) / 1000) | 0),
    nodeMin: () => opts.nodeMin?.() ?? -1,
  };
  let mem: WebAssembly.Memory | null = null;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes.slice().buffer), { env });
  mem = (instance.exports.memory as WebAssembly.Memory | undefined) ?? null;
  const run = instance.exports.run as () => void;
  if (typeof run !== "function") throw new Error("模块需要导出 run() 函数");
  try { run(); } catch (e) { throw new Error(`运行出错（wasm trap）：${e instanceof Error ? e.message : e}`); } // 首帧立即出画面；首帧 trap 直接报给调用方

  const press = (i: number, down: boolean) => { if (down) mask |= 1 << i; else mask &= ~(1 << i); };
  const keymap = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLElement && e.target.closest("textarea, input, select")) return; // 写代码时不抢键
    const i = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
    if (i >= 0) { e.preventDefault(); press(i, down); }
  };
  const dn = (e: KeyboardEvent) => keymap(e, true);
  const up = (e: KeyboardEvent) => keymap(e, false);
  if (keyboard) {
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
  }

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
  return { stop: stopFn, press };
}

/** 上传前校验：真实实例化并跑约 10 帧，trap / 缺 run / 缺内存导出都拦下来——不把坏代码写进设备 */
export async function validateApp(bytes: Uint8Array, status: number): Promise<string> {
  const cv = document.createElement("canvas");
  cv.width = APP_W; cv.height = APP_H;
  let err = "";
  try {
    const p = await previewScreen(bytes, cv, { status, onError: (m) => { err = m; } });
    await new Promise((r) => setTimeout(r, 400));
    p.stop();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return err;
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

/** 二进制指纹（FNV-1a）：判断设备上的版本是否就是当前预览的这份 */
export function hashBytes(u8: Uint8Array) {
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 0x01000193);
  return `${u8.length}:${(h >>> 0).toString(16)}`;
}

/** 本机记录的"最近一次上传到设备的指纹"（按状态）；设备只上报大小，指纹用来识别同体积的改动 */
const DEPLOYED_KEY = "shougongpai.screenDeployed";
/** 断开时点了"恢复默认"：下次连接后真正发 clear 清掉设备上的程序 */
const PENDING_CLEAR_KEY = "shougongpai.pendingClear";
export const pendingClears = (): string[] => { try { return JSON.parse(localStorage.getItem(PENDING_CLEAR_KEY) || "[]"); } catch { return []; } };
export const setPendingClears = (list: string[]) => localStorage.setItem(PENDING_CLEAR_KEY, JSON.stringify(list));
export const deployedHashes = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(DEPLOYED_KEY) || "{}"); } catch { return {}; } };
export const setDeployedHash = (status: string, hash?: string) => {
  const { [status]: _drop, ...rest } = deployedHashes();
  localStorage.setItem(DEPLOYED_KEY, JSON.stringify(hash ? { ...rest, [status]: hash } : rest));
};

/** 编译结果缓存：总览缩略图和编辑器共用，同一份源码只编译一次 */
const compiled = new Map<string, Promise<Uint8Array>>();
export function screenBytes(def: { kind: "wat"; src: string } | { kind: "wasm"; b64: string }): Promise<Uint8Array> {
  if (def.kind === "wasm") return Promise.resolve(b64ToU8(def.b64));
  let p = compiled.get(def.src);
  if (!p) {
    p = compileWat(def.src);
    p.catch(() => compiled.delete(def.src));
    if (compiled.size > 32) compiled.clear();
    compiled.set(def.src, p);
  }
  return p;
}

// ---------- 预览渲染 ----------

export interface DefaultScreen { main: string; sub: string; clock: string; connected: boolean; layout: "full" | "clock" | "status" }

/**
 * 画固件的默认状态屏（坐标/字号对齐 shougongpai.ino drawOled）：左上连接点（仅蓝牙连接时实心）、
 * 右上 12px 时钟、16px 状态大字居中（基线 36，无说明行时 40）、12px 说明居中（基线 56）。
 * 浏览器字体与 u8g2 文泉驿点阵不同，二值化后形状接近但不逐像素一致。
 */
export function drawDefaultScreen(canvas: HTMLCanvasElement, d: DefaultScreen) {
  const ctx = canvas.getContext("2d")!;
  const font = (px: number) => `${px}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, APP_W, APP_H);
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.textBaseline = "alphabetic";
  if (d.layout !== "status") {
    ctx.beginPath(); ctx.arc(6.5, 6.5, 3, 0, Math.PI * 2);
    if (d.connected) ctx.fill(); else ctx.stroke();
    ctx.font = font(12); ctx.textAlign = "right"; ctx.fillText(d.clock, 128, 12);
  }
  ctx.textAlign = "center";
  ctx.font = font(16); ctx.fillText(d.main, 64, d.layout === "full" ? 36 : 40);
  if (d.layout === "full") { ctx.font = font(12); ctx.fillText(d.sub, 64, 56); }
  // 二值化成单色 OLED 像素
  const img = ctx.getImageData(0, 0, APP_W, APP_H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i] > 110 ? 255 : 17;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

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
