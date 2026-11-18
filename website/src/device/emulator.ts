/**
 * 状态即应用：把网页状态映射成模拟器里的应用。
 *  - 六个内置状态 + 种子自定义状态的包由 scripts/status-apps.mjs 预生成，托管在 /emulator/status-apps/
 *  - 用户在设置里增删改的自定义状态，由本模块在浏览器里现打包（PNG/tar/gzip 全部手写，无依赖）
 *  - 全部请求走 vite 代理：/_emu（模拟器管理口）、/api（模拟器上跑的固件设备 API）
 *  - 模拟器没开时一切调用静默返回：这是工作台集成，不是必须链路
 */
import type { DevStdef } from "./protocol";
import { buildAppPackage, installPackage } from "./appPackage";

const API = "/api"; // → 127.0.0.1:8640 固件 API
// /emulator 前缀被代理到模拟器，静态包要放非代理路径（public/ 在站点 base 下）
const PKG_DIR = `${import.meta.env.BASE_URL}status-apps/`;
const INDEX_URL = `${PKG_DIR}index.json`;
const HASH_KEY = "sgp-emu-stapp-hashes"; // 已动态打包过的自定义状态指纹：变了才重装

type IndexEntry = { id: string; status: string; name: string; file: string };

let ready: Promise<Map<string, string> | null> | null = null; // statusId → appId（静态包清单）

const req = (method: string, url: string, body?: BodyInit) => fetch(url, { method, body });

async function probe(): Promise<boolean> {
  try {
    return (await fetch("/_emu/status", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

async function installedIds(): Promise<Set<string>> {
  const r = await fetch(`${API}/apps/list`);
  return new Set(((await r.json()).apps ?? []).map((a: { id: string }) => a.id));
}

/** 装静态清单里缺的包；返回 statusId → appId 映射（模拟器不可达为 null） */
async function ensureIndex(): Promise<Map<string, string> | null> {
  if (!(await probe())) return null;
  const idx: IndexEntry[] = (await (await fetch(INDEX_URL)).json()).apps ?? [];
  const installed = await installedIds();
  for (const e of idx) {
    if (installed.has(e.id)) continue;
    const pkg = new Uint8Array(await (await fetch(PKG_DIR + e.file)).arrayBuffer());
    await installPackage(pkg, e.id, { launch: false });
  }
  return new Map(idx.map((e) => [e.status, e.id]));
}

// 失败不缓存：模拟器后开/网络抖动时，下次状态切换自动重试
const indexMap = () => (ready ??= ensureIndex().then((m) => { if (!m) ready = null; return m; }).catch(() => { ready = null; return null; }));

/** 网页状态变化 → 模拟器启动对应应用（setStatus/设备采纳/计划表等所有路径都汇入这里） */
export function syncStatusToEmulator(statusId: string) {
  void indexMap().then(async (map) => {
    if (!map) return;
    const appId = map.get(statusId) ?? `app.sgp.${statusId}`; // 动态自定义态按惯例命名
    await req("POST", `${API}/apps/launch?app_id=${encodeURIComponent(appId)}`).catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// 浏览器侧打包：公共打包器在 ./appPackage，这里只保留状态屏的 main.js 模板
// ---------------------------------------------------------------------------
const mainJs = (app: string, colorHex: string, label: string, sub: string) => `// 收工牌自定义状态屏 (${app}) — 由网页按当前注册表动态打包
var APP = ${JSON.stringify(app)};
var BASE = "http://localhost"; // 固件把对 localhost 的请求路由到设备自身 API
var COLOR = "#${colorHex}FF";
var LABEL = ${JSON.stringify(label)};
var SUB = ${JSON.stringify(sub)};

function draw() {
  var els = [
    { id: "bg", type: "rectangle", x: 0, y: 0, width: 72, height: 16, fill: "solid", fill_colors: [COLOR], z_index: 0 },
    { id: "lbl", type: "text", text: LABEL, font: "extra_large", color: "#FFFFFFFF", x: 36, y: 8, align: "center", z_index: 1 },
  ];
  if (SUB) els.push({ id: "sub", type: "text", text: SUB, font: "tiny", color: "#FFFFFFCC", x: 36, y: 15, align: "bottom_mid", z_index: 1 });
  fetch(BASE + "/api/display/draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ application_name: APP, priority: 50, elements: els }),
  }).then(function (r) { if (!r.ok) console.error(APP + ": draw " + r.status); })
    .catch(function (e) { console.error(APP + ": " + e); });
}

draw();
var unbind = listen("input", function (ev) {
  if (ev.key !== "back" || ev.action !== "short") return;
  setTimeout(unbind, 0); // 最后一个句柄要回调返回后再解绑
});
`;

/** 自定义状态 → .tgz 包。屏上只能画 ASCII：用状态 id 大写做标签，中文名进应用列表。 */
const buildPkg = (appId: string, name: string, colorHex: string, label: string) =>
  buildAppPackage({ id: appId, name, description: `收工牌状态屏：${name}`, colorHex, mainJs: mainJs(appId, colorHex, label, "CUSTOM STATUS") });

// ---------------------------------------------------------------------------
// 自定义状态注册表 ↔ 应用集合的对账：stdefs 快照到达时调用
// ---------------------------------------------------------------------------
const hashes = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(HASH_KEY) ?? "{}"); } catch { return {}; }
};
const saveHashes = (h: Record<string, string>) => localStorage.setItem(HASH_KEY, JSON.stringify(h));
const hex6 = (c: number) => (c & 0xffffff).toString(16).padStart(6, "0");
const defHash = (d: DevStdef) => `${d.zh}|${hex6(d.c)}|${d.work ? 1 : 0}`;

async function reconcile(prevIds: string[], defs: DevStdef[]) {
  if (!(await probe())) return;
  const map = (await indexMap()) ?? new Map<string, string>(); // 静态清单优先（c1→docs、c2→sync）
  const installed = await installedIds();
  const h = hashes();
  const nextIds = defs.map((d) => d.id);

  for (const d of defs) {
    const appId = map.get(d.id) ?? `app.sgp.${d.id}`;
    const hash = defHash(d);
    // 静态清单覆盖的状态（c1/c2）首次只见快照不重打：预生成包更好，记下指纹等编辑再重建
    if (h[d.id] === undefined && map.has(d.id) && installed.has(appId)) { h[d.id] = hash; continue; }
    if (installed.has(appId) && h[d.id] === hash) continue; // 没变就不重打
    try {
      const pkg = await buildPkg(appId, d.zh, hex6(d.c), d.id.toUpperCase());
      await installPackage(pkg, appId, { launch: false });
      h[d.id] = hash; installed.add(appId);
    } catch { /* 打包/安装失败跳过，下次快照再试 */ }
  }
  for (const id of prevIds.filter((x) => !nextIds.includes(x))) {
    const appId = map.get(id) ?? `app.sgp.${id}`;
    await req("DELETE", `${API}/apps?app_id=${encodeURIComponent(appId)}`).catch(() => {});
    delete h[id];
  }
  // 顺带清理不属于任何现有状态的 app.sgp.*（早期错误兜底/手动删包后的残影）
  const wanted = new Set([...defs.map((d) => map.get(d.id) ?? `app.sgp.${d.id}`), ...map.values()]);
  for (const appId of [...installed].filter((x) => x.startsWith("app.sgp.") && !wanted.has(x))) {
    await req("DELETE", `${API}/apps?app_id=${encodeURIComponent(appId)}`).catch(() => {});
  }
  saveHashes(h);
}

let stdefSync: Promise<void> | null = null;
/** stdefs 快照驱动对账：新建/编辑的状态得到同名应用，删掉的状态连应用一起撤 */
export function syncCustomStatusApps(prevIds: string[], next: DevStdef[]) {
  stdefSync = (stdefSync ?? Promise.resolve()).then(() => reconcile(prevIds, next)).catch(() => {});
}
