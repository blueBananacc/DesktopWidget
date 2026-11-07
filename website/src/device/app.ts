import type { DeviceApi } from "./api";

/**
 * 自定义屏幕（WASM）管线：用户/Agent 写 WAT（网页端 wabt 编译）或本地用 clang
 * 编译成 .wasm，二进制经 app 协议分片上传 → 设备 LittleFS /app_<status>.wasm →
 * wasm3 沙箱按状态执行。预览 = 浏览器 WebAssembly 跑同一份二进制，宿主函数
 * Shim 到 128×64 帧缓冲——看到的就是设备上跑的。
 */

export const APP_W = 128;
export const APP_H = 64;
export const APP_MAX_BYTES = 48 * 1024; // 与固件 APP_MAX_SIZE 一致

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
    // wabt 的 toBinary 不校验类型：比如 import 声明漏写 (result i32) 会产出"能编不能用"的模块，
    // 设备端 ValidateSignature 会拒绝链接并报 missing imported function。这里先过一遍原生校验把错误前置。
    new WebAssembly.Module(buffer);
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
  let color = 1; // 绘制模式：0灭 1亮 2反色XOR（与固件 appColor 一致）
  const segStart = opts.segStart ?? Date.now(); // segSec 语义：当前状态已持续秒数；未知起点时按"刚进入状态"预览
  const px = (x: number, y: number) => {
    x |= 0; y |= 0;
    if (x >= 0 && x < APP_W && y >= 0 && y < APP_H) {
      const i = (y >> 3) * APP_W + x, m = 1 << (y & 7);
      if (color === 0) fb[i] &= ~m; else if (color === 2) fb[i] ^= m; else fb[i] |= m;
    }
  };
  const FONTS = ["10px monospace", "12px sans-serif", "bold 17px sans-serif"];
  const fontOf = (f: number) => FONTS[f] ?? FONTS[0];
  // 文字绘制：在离屏画布渲染字形，按 color 模式合并进帧缓冲（0=擦掉字形区域 2=XOR）
  const tcv = document.createElement("canvas");
  tcv.width = APP_W; tcv.height = APP_H;
  const tctx = tcv.getContext("2d", { willReadFrequently: true })!;
  const drawTextAt = (x: number, y: number, s: string, font: string) => {
    tctx.clearRect(0, 0, APP_W, APP_H);
    tctx.font = font; tctx.fillStyle = "#fff"; tctx.textBaseline = "alphabetic";
    tctx.fillText(s, x, y);
    const d = tctx.getImageData(0, 0, APP_W, APP_H).data;
    for (let yy = 0; yy < APP_H; yy++) for (let xx = 0; xx < APP_W; xx++) {
      if (d[(yy * APP_W + xx) * 4] > 127) {
        const i = (yy >> 3) * APP_W + xx, m = 1 << (yy & 7);
        if (color === 0) fb[i] &= ~m; else if (color === 2) fb[i] ^= m; else fb[i] |= m;
      }
    }
  };
  const env = {
    clear: () => fb.fill(0),
    show: () => drawFrameTo(ctx, fb),
    px,
    color: (m: number) => { if (m >= 0 && m <= 2) color = m | 0; },
    rect: (x: number, y: number, w: number, h: number, fill: number) => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (fill || i === 0 || j === 0 || i === w - 1 || j === h - 1) px(x + i, y + j);
    },
    line: (x1: number, y1: number, x2: number, y2: number) => { // Bresenham
      x1 |= 0; y1 |= 0; x2 |= 0; y2 |= 0;
      const dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
      const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        px(x1, y1);
        if (x1 === x2 && y1 === y2) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x1 += sx; }
        if (e2 <= dx) { err += dx; y1 += sy; }
      }
    },
    circle: (cx: number, cy: number, r: number, fill: number) => {
      cx |= 0; cy |= 0; r |= 0;
      if (r <= 0) return;
      if (fill) { for (let dy = -r; dy <= r; dy++) { const dx = Math.round(Math.sqrt(r * r - dy * dy)); for (let i = -dx; i <= dx; i++) px(cx + i, cy + dy); } return; }
      let x = r, y = 0, err = 1 - r;
      while (x >= y) {
        px(cx + x, cy + y); px(cx + y, cy + x); px(cx - y, cy + x); px(cx - x, cy + y);
        px(cx - x, cy - y); px(cx - y, cy - x); px(cx + y, cy - x); px(cx + x, cy - y);
        y++;
        if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
      }
    },
    ellipse: (cx: number, cy: number, rx: number, ry: number, fill: number) => {
      cx |= 0; cy |= 0; rx |= 0; ry |= 0;
      if (rx <= 0 || ry <= 0) return;
      if (fill) {
        for (let dy = -ry; dy <= ry; dy++) {
          const dx = Math.round(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
          for (let i = -dx; i <= dx; i++) px(cx + i, cy + dy);
        }
        return;
      }
      const steps = Math.max(64, Math.ceil(2 * Math.PI * Math.max(rx, ry)));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        px(cx + Math.round(rx * Math.cos(a)), cy + Math.round(ry * Math.sin(a)));
      }
    },
    rrect: (x: number, y: number, w: number, h: number, r: number, fill: number) => {
      x |= 0; y |= 0; w |= 0; h |= 0; r = Math.min(r | 0, (w - 1) >> 1, (h - 1) >> 1);
      if (w <= 0 || h <= 0) return;
      if (r <= 0) { env.rect(x, y, w, h, fill); return; }
      if (fill) { // 每行按圆角方程算横向范围
        for (let j = 0; j < h; j++) {
          const dy = Math.min(j, h - 1 - j); // 距最近顶/底边
          const inset = dy < r ? r - Math.round(Math.sqrt(r * r - (r - dy) * (r - dy))) : 0;
          for (let i = inset; i < w - inset; i++) px(x + i, y + j);
        }
        return;
      }
      for (let i = r; i < w - r; i++) { px(x + i, y); px(x + i, y + h - 1); }   // 顶/底横边
      for (let j = r; j < h - r; j++) { px(x, y + j); px(x + w - 1, y + j); }   // 左/右竖边
      const arc = (ax0: number, ay0: number, q: number) => {                  // 四分之一弧（中点圆）
        let ax = r, ay = 0, err = 1 - r;
        while (ax >= ay) {
          const sx = q === 1 || q === 2 ? 1 : -1, sy = q >= 2 ? 1 : -1;
          px(ax0 + sx * ax, ay0 + sy * ay); px(ax0 + sx * ay, ay0 + sy * ax);
          ay++;
          if (err < 0) err += 2 * ay + 1; else { ax--; err += 2 * (ay - ax) + 1; }
        }
      };
      arc(x + r, y + r, 0); arc(x + w - 1 - r, y + r, 1);
      arc(x + w - 1 - r, y + h - 1 - r, 2); arc(x + r, y + h - 1 - r, 3);
    },
    bitmap: (x: number, y: number, w: number, h: number, ptr: number) => { // XBM：行主序 LSB 先
      if (!mem) throw new Error("bitmap() 需要模块导出线性内存");
      if (w <= 0 || h <= 0 || w > APP_W || h > APP_H) return;
      const rowBytes = (w + 7) >> 3, data = new Uint8Array(mem.buffer, ptr, rowBytes * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
        if (data[j * rowBytes + (i >> 3)] & (1 << (i & 7))) px(x + i, y + j);
    },
    text: (x: number, y: number, ptr: number, len: number) => {
      if (!mem) throw new Error("text() 需要模块导出线性内存：把 (memory 1) 改成 (memory (export \"memory\") 1)");
      if (len <= 0 || len > 64) return;
      drawTextAt(x, y, readStr(ptr, len), FONTS[0]);                              // 近似固件 6x10 字体的基线语义
    },
    textC: (x: number, y: number, ptr: number, len: number) => {   // UTF-8 中文小字（wqy12）
      if (!mem) throw new Error("textC() 需要模块导出线性内存");
      if (len <= 0 || len > 64) return;
      drawTextAt(x, y, readStr(ptr, len), FONTS[1]);
    },
    bigText: (x: number, y: number, ptr: number, len: number) => { // UTF-8 中文大字（wqy16）
      if (!mem) throw new Error("bigText() 需要模块导出线性内存");
      if (len <= 0 || len > 64) return;
      drawTextAt(x, y, readStr(ptr, len), FONTS[2]);
    },
    textW: (ptr: number, len: number, f: number) => {              // 像素宽：居中/右对齐用
      if (!mem || len <= 0 || len > 64) return 0;
      tctx.font = fontOf(f);
      return tctx.measureText(readStr(ptr, len)).width | 0;
    },
    textA: (x: number, y: number, ptr: number, len: number, f: number, align: number) => { // 锚点文本：align 0..8 九宫格
      if (!mem) throw new Error("textA() 需要模块导出线性内存");
      if (len <= 0 || len > 64 || align < 0 || align > 8) return;
      const s = readStr(ptr, len);
      tctx.font = fontOf(f);
      const m = tctx.measureText(s);
      const asc = m.actualBoundingBoxAscent ?? parseInt(tctx.font) * 0.8;
      const desc = m.actualBoundingBoxDescent ?? parseInt(tctx.font) * 0.2;
      const w = m.width | 0, h9 = align % 3, v9 = (align / 3) | 0;
      const dx = h9 === 0 ? x : h9 === 1 ? x - w / 2 : x - w;
      const dy = v9 === 0 ? y + asc : v9 === 1 ? y + (asc - desc) / 2 : y - desc;
      drawTextAt(dx | 0, dy | 0, s, fontOf(f));
    },
    millis: () => performance.now() | 0,
    buttons: () => mask,
    status: () => status,
    clock: () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, // 与设备校时后同值；浏览器时钟即本地时间
    segSec: () => Math.max(0, ((Date.now() - segStart) / 1000) | 0),
    nodeMin: () => opts.nodeMin?.() ?? -1,
  };
  // 读线性内存里的 C 风格字符串：到首个 \0 为止（固件 drawUTF8 遇 \0 即停；不截断会把补齐的 NUL 画成豆腐块、量宽也会偏大）
  const readStr = (ptr: number, len: number) =>
    new TextDecoder().decode(new Uint8Array(mem!.buffer, ptr, len)).split("\0")[0];
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

/** 把 wasm 二进制 PUT 到设备某状态的存储槽；设备收齐落 flash，进入该状态自动执行。 */
export async function sendApp(api: DeviceApi, status: string, bytes: Uint8Array, onProgress?: (sent: number) => void) {
  if (!bytes.length) throw new Error("空的 wasm 模块");
  if (bytes.length > APP_MAX_BYTES) throw new Error(`wasm 超过 ${APP_MAX_BYTES / 1024}KB 上限（${bytes.length}B）`);
  await api.putApp(status, bytes, onProgress);
}

export const stopApp = (api: DeviceApi) => api.stopApp();
export const clearApp = (api: DeviceApi, status: string) => api.deleteApp(status);

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
