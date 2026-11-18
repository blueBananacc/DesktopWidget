/**
 * 浏览器侧应用打包器：不依赖任何外部库，手写 PNG / ustar / gzip（CompressionStream）。
 * 产物是一个可 POST 到固件 `/api/apps/stage` + `/api/apps/install` 的 .tgz 应用包，
 * 与 `scripts/status-apps.mjs` 离线生成的是同一套结构：
 *   <appId>/appmeta/manifest.json + icon_front_8x8.png + icon_back_11x11.png + scripts/main.js
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

async function compress(format: "deflate" | "gzip", data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream(format as CompressionFormat);
  const w = new Blob([data.buffer as ArrayBuffer]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(w).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 纯色底 + 白色圆角块标记的图标（8×8 前屏 / 11×11 背屏共用同一形状） */
export async function iconPng(size: number, hex: string): Promise<Uint8Array> {
  const [r, g, b] = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const raw = new Uint8Array((size * 4 + 1) * size);
  const c = Math.floor(size / 2);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * (size * 4 + 1) + 1 + x * 4;
    const mark = Math.abs(x - c) <= 1 && Math.abs(y - c) <= 1;
    raw[i] = mark ? 255 : r; raw[i + 1] = mark ? 255 : g; raw[i + 2] = mark ? 255 : b; raw[i + 3] = 255;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size);
  ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", await compress("deflate", raw)),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

function tarEntry(name: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(512);
  const enc = new TextEncoder();
  head.set(enc.encode(name).subarray(0, 99), 0);
  head.set(enc.encode("0000644\0"), 100);
  head.set(enc.encode("0000000\0"), 108);
  head.set(enc.encode("0000000\0"), 116);
  head.set(enc.encode(data.length.toString(8).padStart(11, "0") + "\0"), 124);
  head.set(enc.encode(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0"), 136);
  head[156] = 0x30;
  head.set(enc.encode("ustar\0"), 257);
  head.set(enc.encode("00"), 263);
  head.set(enc.encode("sgp"), 265);
  head.set(enc.encode("sgp"), 297);
  for (let i = 148; i < 156; i++) head[i] = 0x20;
  let sum = 0;
  for (const b of head) sum += b;
  head.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  const out = new Uint8Array(512 + Math.ceil(data.length / 512) * 512);
  out.set(head, 0); out.set(data, 512);
  return out;
}

export const enc = (s: string) => new TextEncoder().encode(s);

export interface PackageSpec {
  id: string;           // app.sgp.* 形式
  name: string;         // 应用列表里显示的名字（可中文）
  description?: string;
  version?: string;
  heapKib?: number;
  colorHex: string;     // 6 位 hex，无 #：图标底色
  mainJs: string;       // scripts/main.js 全文（ES5，固件 JerryScript 运行时）
}

/** 打成 .tgz 字节流，可直接喂给 /api/apps/stage */
export async function buildAppPackage(spec: PackageSpec): Promise<Uint8Array> {
  const manifest = enc(JSON.stringify({
    format_version: 1, id: spec.id, name: spec.name, version: spec.version ?? "0.1.0",
    api_version: "27.12.0", description: spec.description ?? spec.name,
    author: "sgp", heap_size_kib: spec.heapKib ?? 32,
  }, null, 2));
  const files: [string, Uint8Array][] = [
    [`${spec.id}/appmeta/manifest.json`, manifest],
    [`${spec.id}/appmeta/icon_front_8x8.png`, await iconPng(8, spec.colorHex)],
    [`${spec.id}/appmeta/icon_back_11x11.png`, await iconPng(11, spec.colorHex)],
    [`${spec.id}/scripts/main.js`, enc(spec.mainJs)],
  ];
  const tar = new Uint8Array(files.reduce((n, [, d]) => n + 512 + Math.ceil(d.length / 512) * 512, 0) + 1024);
  let off = 0;
  for (const [n, d] of files) { const e = tarEntry(n, d); tar.set(e, off); off += e.length; }
  return compress("gzip", tar);
}

const API = "/api"; // → 模拟器/真机的固件 HTTP API（vite 或 nginx 代理）

/** 安装并启动一个 .tgz：stage → install → launch。返回 {id} 或抛错。 */
export async function installPackage(pkg: Uint8Array, appId: string, { launch = true } = {}): Promise<void> {
  const staged = await (await fetch(`${API}/apps/stage`, { method: "POST", body: pkg.buffer as ArrayBuffer })).json();
  if (!staged?.install_key) throw new Error(staged?.error?.message ?? staged?.message ?? "设备拒绝了应用包");
  const res = await fetch(`${API}/apps/install?install_key=${encodeURIComponent(staged.install_key)}`, { method: "POST" });
  if (!res.ok) throw new Error(`安装失败（HTTP ${res.status}）`);
  if (launch) await fetch(`${API}/apps/launch?app_id=${encodeURIComponent(appId)}`, { method: "POST" });
}
