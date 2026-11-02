import type { DeviceTransport } from "./protocol";

/**
 * 自定义动效管线：用户/Agent 写的 JS 在 Web Worker 里求值（断网 API 全部置空，
 * device.draw 只捕获元素树），每帧在 OffscreenCanvas 光栅化成 128×64 单色位图，
 * 打包成 u8g2 页序 1bpp（1024B/帧）后经 transport 按序上传到设备。
 * 设备只当播放器，不执行代码——断电丢帧，重连可重传。
 */

export interface AnimResult {
  frames: Uint8Array[]; // u8g2 页序 1bpp，每帧 1024B
  fps: number;
  loop: boolean;
  name: string;
}

export const ANIM_W = 128;
export const ANIM_H = 64;
export const ANIM_MAX_FRAMES = 16;
export const ANIM_MAX_FPS = 20;

// ---------- Worker 端：求值 + 光栅化 + 打包 ----------

const WORKER_SRC = `
const W = 128, H = 64;
const elsRef = { cur: [] };

// 颜色 → 开/关：alpha < 0.5 不画；亮度 >= 128 为亮
function onColor(c) {
  if (c === undefined || c === null) return true;
  if (typeof c !== "string") return true;
  if (c === "none" || c === "None" || c === "transparent") return false;
  const h = c.replace("#", "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(h)) return true;
  let r, g, b, a = 255;
  if (h.length === 3 || h.length === 4) {
    r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16);
    if (h.length === 4) a = parseInt(h[3] + h[3], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
    if (h.length >= 8) a = parseInt(h.slice(6, 8), 16);
  }
  return a >= 128 && 0.299 * r + 0.587 * g + 0.114 * b >= 128;
}

// 元素构造辅助（用户/Agent 代码可直接用，也可手写对象字面量）
const rect = (o) => ({ type: "rect", ...o });
const text = (o) => ({ type: "text", ...o });
const bitmap = (o) => ({ type: "bitmap", ...o });
const line = (o) => ({ type: "line", ...o });
const pixel = (o) => ({ type: "pixel", ...o });
// 行/列排布：x,y 起点 + gap 间距，子元素 dx/dy 为自身偏移；stack 只做串联
const row = (o, kids) => { let x = o.x || 0; return kids.flatMap((k) => { const r = { ...k, x: (k.x || 0) + x, y: (k.y || 0) + (o.y || 0) }; x += (k.w || 8) + (o.gap || 0); return [r]; }); };
const column = (o, kids) => { let y = o.y || 0; return kids.flatMap((k) => { const r = { ...k, x: (k.x || 0) + (o.x || 0), y: (k.y || 0) + y }; y += (k.h || 8) + (o.gap || 0); return [r]; }); };
const stack = (o, kids) => kids.map((k) => ({ ...k, x: (k.x || 0) + (o.x || 0), y: (k.y || 0) + (o.y || 0) }));

const device = { W, H, draw: (f) => { elsRef.cur = (f && f.elements) || []; } };

function rasterize(ctx, els) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
  for (const e of els) {
    if (!e || !e.type) continue;
    switch (e.type) {
      case "rect": {
        const x = e.x || 0, y = e.y || 0, w = e.w || e.width || 0, h = e.h || e.height || 0;
        if (e.fill !== undefined && onColor(e.fill)) { try { ctx.beginPath(); ctx.roundRect(x, y, w, h, e.radius || 0); ctx.fill(); } catch { ctx.fillRect(x, y, w, h); } }
        if (e.stroke !== undefined && onColor(e.stroke)) ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        break;
      }
      case "text": {
        if (!onColor(e.color)) break;
        const size = e.size || 12;
        ctx.font = size + "px sans-serif";
        ctx.textBaseline = "top";
        const x = e.x || 0, y = e.y || 0;
        const align = e.align || "left";
        let tx = x;
        if (align !== "left") { const m = ctx.measureText(String(e.text || "")); tx = align === "center" ? x - m.width / 2 : x - m.width; }
        ctx.fillText(String(e.text || ""), tx, y);
        break;
      }
      case "bitmap": {
        if (!onColor(e.color)) break;
        const x0 = e.x || 0, y0 = e.y || 0;
        if (Array.isArray(e.rows)) {
          for (let ry = 0; ry < e.rows.length; ry++) { const rowStr = String(e.rows[ry]); for (let rx = 0; rx < rowStr.length; rx++) { const ch = rowStr[rx]; if (ch !== "." && ch !== " " && ch !== "0") ctx.fillRect(x0 + rx, y0 + ry, 1, 1); } }
        } else if (e.data && e.w && e.h) {
          const hex = String(e.data).replace(/\\s+/g, "");
          for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) { const bit = y * e.w + x; const byte = parseInt(hex[(bit >> 3) * 2] + hex[(bit >> 3) * 2 + 1], 16); if (byte & (0x80 >> (bit & 7))) ctx.fillRect(x0 + x, y0 + y, 1, 1); }
        }
        break;
      }
      case "line": {
        if (!onColor(e.color)) break;
        ctx.beginPath(); ctx.moveTo((e.x1 || 0) + 0.5, (e.y1 || 0) + 0.5); ctx.lineTo((e.x2 || 0) + 0.5, (e.y2 || 0) + 0.5); ctx.stroke();
        break;
      }
      case "pixel": if (onColor(e.color)) ctx.fillRect(e.x || 0, e.y || 0, 1, 1); break;
    }
  }
}

// u8g2 页序打包：buffer[p*128+x] 的 bit b = 像素 (x, p*8+b)，LSB 是该页最上一行
function pack(ctx) {
  const img = ctx.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(1024);
  for (let p = 0; p < 8; p++) for (let x = 0; x < 128; x++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) { const y = p * 8 + b; if (img[(y * W + x) * 4] > 127) byte |= 1 << b; }
    out[p * 128 + x] = byte;
  }
  return out;
}

self.onmessage = (e) => {
  const { code } = e.data;
  try {
    // 断网/危险 API 全部遮蔽；user code 通过参数注入的白名单环境执行
    const scope = { device, rect, text, bitmap, line, pixel, row, column, stack, Math, JSON, Object, Array, String, Number, Boolean, console: { log() {} },
      fetch: undefined, XMLHttpRequest: undefined, importScripts: undefined, WebSocket: undefined, indexedDB: undefined, self: undefined };
    const fn = new Function(...Object.keys(scope), "'use strict';\\n" + code + "\\n;return { draw: typeof draw === 'function' ? draw : undefined, meta: typeof meta === 'object' && meta ? meta : {} };");
    const r = fn(...Object.values(scope));
    if (!r.draw) throw new Error("代码需要定义 draw(t) 函数；见 display-app-spec.md");
    const meta = r.meta || {};
    const n = Math.min(Math.max(1, meta.frames | 0 || 8), ${ANIM_MAX_FRAMES});
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const frames = [];
    for (let t = 0; t < n; t++) { elsRef.cur = []; r.draw(t); rasterize(ctx, elsRef.cur); frames.push(pack(ctx)); }
    self.postMessage({ ok: true, frames, fps: Math.min(Math.max(1, meta.fps | 0 || 5), ${ANIM_MAX_FPS}), loop: meta.loop !== false, name: meta.name || "" }, frames.map((f) => f.buffer));
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
`;

let workerUrl: string | undefined;

/** 在 Worker 中求值用户代码并光栅化。失败抛出 Error（message 为可展示文案）。 */
export function runAnimation(code: string): Promise<AnimResult> {
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl!);
    const timer = setTimeout(() => { w.terminate(); reject(new Error("执行超时（10s）：代码里可能有死循环")); }, 10000);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      const d = e.data;
      if (d.ok) resolve({ frames: d.frames.map((b: ArrayBuffer) => new Uint8Array(b)), fps: d.fps, loop: d.loop, name: d.name });
      else reject(new Error(d.error));
    };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || "代码执行失败")); };
    w.postMessage({ code });
  });
}

// ---------- 上传 ----------

const b64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 256) s += String.fromCharCode(...u8.subarray(i, i + 256));
  return btoa(s);
};

/** 按序上传动效并播放；设备收齐帧后才开始。onProgress 回调已传帧数。 */
export async function sendAnim(t: DeviceTransport, r: AnimResult, onProgress?: (sent: number, total: number) => void) {
  await t.send({ type: "anim", op: "begin", frames: r.frames.length, fps: r.fps, loop: r.loop });
  for (let i = 0; i < r.frames.length; i++) {
    await t.send({ type: "anim", op: "frame", i, data: b64(r.frames[i]) });
    onProgress?.(i + 1, r.frames.length);
  }
  await t.send({ type: "anim", op: "play" });
}

export const stopAnim = (t: DeviceTransport) => t.send({ type: "anim", op: "stop" });

// ---------- 预览 ----------

/** 把 u8g2 页序 1bpp 帧画到 canvas（亮=白）；scale 用于放大预览。 */
export function drawFrameTo(ctx: CanvasRenderingContext2D, frame: Uint8Array, scale = 1) {
  const img = ctx.createImageData(ANIM_W, ANIM_H);
  for (let p = 0; p < 8; p++) for (let x = 0; x < ANIM_W; x++) {
    const byte = frame[p * ANIM_W + x];
    for (let b = 0; b < 8; b++) {
      const on = byte & (1 << b);
      const o = ((p * 8 + b) * ANIM_W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = on ? 255 : 17;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (scale !== 1) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ctx.canvas, 0, 0, ANIM_W, ANIM_H, 0, 0, ANIM_W * scale, ANIM_H * scale);
  }
}
