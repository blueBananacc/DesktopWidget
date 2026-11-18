// 状态即应用：把收工牌的状态（工作/勿扰/专注/会议/休息/下班 + 自定义）各打包成一个
// 模拟器应用包 .tgz，网页静态托管后由浏览器经 /api 代理装进模拟器。
// 用法：node scripts/status-apps.mjs  →  website/public/emulator/status-apps/*.tgz + index.json
import { deflateSync, gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 注意：/emulator 前缀被 vite 代理到模拟器了，静态包必须放非代理路径
const OUT = path.join(ROOT, "public", "status-apps");
// 应用内设备 API 地址：固件把对 localhost 的请求路由到设备自身 API（与 busy-lib 打包产物一致；
// 127.0.0.1 是宿主环回被网络守卫拦下，10.0.4.20 在模拟器上无响应）
const ADDR = "http://localhost";

// status: 网页状态 id；app: 应用包 id；name: 应用列表里的中文名；screen/sub: 72×16 屏上的 ASCII 文字；
// color: 屏幕底色与图标色；glyph: 图标图案；timerMin: 屏上倒计时分钟数（专注）。
const STATUSES = [
  { status: "work",  app: "app.sgp.work",  name: "工作中", screen: "WORK",  sub: "COME ON IN",      color: "2F9E62", glyph: "ring",  timerMin: 0 },
  { status: "busy",  app: "app.sgp.busy",  name: "勿扰",   screen: "BUSY",  sub: "DO NOT DISTURB", color: "D93B3B", glyph: "solid", timerMin: 0 },
  { status: "focus", app: "app.sgp.focus", name: "专注中", screen: "FOCUS", sub: "",               color: "A61B1B", glyph: "half",  timerMin: 25 },
  { status: "meet",  app: "app.sgp.meet",  name: "会议中", screen: "MEET",  sub: "IN A MEETING",   color: "6D4FD8", glyph: "hatch", timerMin: 0 },
  { status: "rest",  app: "app.sgp.rest",  name: "休息中", screen: "REST",  sub: "BACK SOON",      color: "0E9BA8", glyph: "dots",  timerMin: 0 },
  { status: "off",   app: "app.sgp.off",   name: "已下班", screen: "OFF",   sub: "SEE YOU",        color: "3A3F4B", glyph: "moon",  timerMin: 0 },
  { status: "c1",    app: "app.sgp.docs",  name: "写文档", screen: "DOCS",  sub: "WRITING",        color: "5B8FF9", glyph: "lines", timerMin: 0 },
  { status: "c2",    app: "app.sgp.sync",  name: "联调中", screen: "SYNC",  sub: "INTEGRATING",    color: "F6BD16", glyph: "link",  timerMin: 0 },
];

// ---------------------------------------------------------------------------
// 最小 PNG（8-bit RGBA，无压缩库之外依赖）
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function png(width, height, px) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; px(y).copy(raw, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// 图标：状态底色满铺 + 白色小图形（按状态的 OLED 图案语义）
function iconPng(w, h, hex, glyph) {
  const [r, g, b] = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.alloc(w * 4));
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) { const i = x * 4; rows[y][i] = 255; rows[y][i + 1] = 255; rows[y][i + 2] = 255; rows[y][i + 3] = 255; } };
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = x * 4; rows[y][i] = r; rows[y][i + 1] = g; rows[y][i + 2] = b; rows[y][i + 3] = 255; }
  const ring = () => { const rad = Math.min(w, h) / 2 - 1.5; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d > rad - 1.2 && d < rad + 0.4) set(x, y); } };
  const solid = () => { for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) set(x, y); };
  const half = () => { for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx; x++) set(x, y); };
  const hatch = () => { for (let i = -h; i < h; i++) for (let t = 0; t < h; t++) { const x = t + i, y = t; if (Math.abs(i % 4) < 1.2) set(x, y); } };
  const dots = () => { for (const [dx, dy] of [[-3, -1], [0, -1], [3, -1]]) { set(cx + dx, cy + dy); set(cx + dx, cy + dy + 1); } };
  const moon = () => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); const d2 = Math.hypot(x + 0.5 - cx - 2, y + 0.5 - cy); if (d < 3 && d2 > 2.4) set(x, y); } };
  const lines = () => { for (const dy of [-2, 0, 2]) for (let x = cx - 3; x <= cx + 3; x++) set(x, cy + dy); };
  const link = () => { for (let i = -3; i <= 0; i++) { set(cx + i, cy - 1); set(cx + i, cy); } for (let i = 0; i <= 3; i++) { set(cx + i, cy); set(cx + i, cy + 1); } };
  ({ ring, solid, half, hatch, dots, moon, lines, link }[glyph] ?? solid)();
  return png(w, h, (y) => rows[y]);
}

// ---------------------------------------------------------------------------
// ustar + gzip
// ---------------------------------------------------------------------------
function tarEntry(name, data) {
  const head = Buffer.alloc(512);
  head.write(name, 0, Math.min(name.length, 99), "utf8");
  head.write("0000644\0", 100); head.write("0000000\0", 108); head.write("0000000\0", 116);
  head.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
  head.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136);
  head[156] = 0x30; head.write("ustar\0", 257); head.write("00", 263);
  head.write("sgp", 265); head.write("sgp", 297);
  let sum = 0; for (let i = 148; i < 156; i++) head[i] = 0x20;
  for (const b of head) sum += b;
  head.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([head, data, pad]);
}
const tarGz = (files) => gzipSync(Buffer.concat([...files.map(([n, d]) => tarEntry(n, d)), Buffer.alloc(1024)]));

// ---------------------------------------------------------------------------
// 应用脚本：纯色底 + 大号状态字 + 小字（专注为倒计时）。fetch 直连设备 API，无打包依赖。
// ---------------------------------------------------------------------------
const mainJs = (s) => `// ${s.name} — a ShouGongPai status screen app (${s.app})
var APP = ${JSON.stringify(s.app)};
var BASE = ${JSON.stringify(ADDR)};
var COLOR = "#${s.color}FF";
var LABEL = ${JSON.stringify(s.screen)};
var SUB = ${JSON.stringify(s.sub)};
var TIMER_MIN = ${s.timerMin};
var t0 = Date.now();

function draw() {
  var sub = SUB;
  if (TIMER_MIN > 0) {
    var left = TIMER_MIN * 60 - Math.floor((Date.now() - t0) / 1000);
    if (left <= 0) { sub = "TIME UP"; } else { sub = Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2) + " LEFT"; }
  }
  var els = [
    { id: "bg", type: "rectangle", x: 0, y: 0, width: 72, height: 16, fill: "solid", fill_colors: [COLOR], z_index: 0 },
    { id: "lbl", type: "text", text: LABEL, font: "extra_large", color: "#FFFFFFFF", x: 36, y: 8, align: "center", z_index: 1 },
  ];
  if (sub) els.push({ id: "sub", type: "text", text: sub, font: "tiny", color: "#FFFFFFCC", x: 36, y: 15, align: "bottom_mid", z_index: 1 });
  fetch(BASE + "/api/display/draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application_name: APP, priority: 50, elements: els }),
  }).then(function (r) { if (!r.ok) console.error(APP + ": draw " + r.status); })
    .catch(function (e) { console.error(APP + ": " + e); });
}

var timer = TIMER_MIN > 0 ? setInterval(draw, 1000) : null;
draw();

var unbind = listen("input", function (ev) {
  if (ev.key !== "back" || ev.action !== "short") return;
  if (timer) clearInterval(timer);
  setTimeout(unbind, 0); // 回调返回后再解绑：这是最后一个句柄，脚本随之退出
});
`;

mkdirSync(OUT, { recursive: true });
const index = [];
for (const s of STATUSES) {
  const manifest = Buffer.from(JSON.stringify({
    format_version: 1, id: s.app, name: s.name, version: "0.1.0", api_version: "27.12.0",
    description: `收工牌状态屏：${s.name}`, author: "sgp", heap_size_kib: 32,
  }, null, 2), "utf8");
  const tgz = tarGz([
    [`${s.app}/appmeta/manifest.json`, manifest],
    [`${s.app}/appmeta/icon_front_8x8.png`, iconPng(8, 8, s.color, s.glyph)],
    [`${s.app}/appmeta/icon_back_11x11.png`, iconPng(11, 11, s.color, s.glyph)],
    [`${s.app}/scripts/main.js`, Buffer.from(mainJs(s), "utf8")],
  ]);
  const file = `${s.app}.tgz`;
  writeFileSync(path.join(OUT, file), tgz);
  index.push({ id: s.app, status: s.status, name: s.name, file });
  console.log(`${file}  ${tgz.length} B  ${s.name}`);
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ apps: index }, null, 2));
console.log(`index.json  ${index.length} apps`);
