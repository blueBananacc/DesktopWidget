// 共享看板的"云端 broker"——对应固件里 MQTT 的角色（busy_timer/device_name 都是 mqtt_publish 上云）。
// 成员把当前状态发布到自己的区域（zone），同区成员拉取彼此；90 秒心跳 TTL 替代 MQTT retained+遗嘱：
// 客户端掉线不清场，broker 自动把它的条目标过期。
//
//   POST /pub   {zone, id, name, st, until?}  → 登记/心跳，返回 {ok, peers}
//   GET  /peers?zone=<z>[&self=<id>]          → {peers:[{id,name,st,until,at}]}
//   GET  /ping                               → {ok:true, members:<n>}
import { createServer } from "node:http";

const TTL_MS = 90_000;
const zones = new Map(); // zone → Map<id, {name, st, until, at}>

const peersOf = (zone, self = null) => {
  const now = Date.now();
  const out = [];
  for (const [id, m] of zones.get(zone) ?? []) {
    if (now - m.at > TTL_MS) continue;
    if (id === self) continue;
    out.push({ id, name: m.name, st: m.st, until: m.until ?? null, at: m.at });
  }
  return out;
};

const json = (res, code, value) => {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(value));
};

const readBody = (req) => new Promise((resolve) => {
  let text = "";
  req.on("data", (c) => { text += c; if (text.length > 64 * 1024) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch { resolve(null); } });
  req.on("error", () => resolve(null));
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (url.pathname === "/ping") return json(res, 200, { ok: true, members: [...zones.values()].reduce((n, z) => n + z.size, 0) });

  if (url.pathname === "/peers" && req.method === "GET") {
    const zone = url.searchParams.get("zone") ?? "";
    return json(res, 200, { peers: zone ? peersOf(zone, url.searchParams.get("self")) : [] });
  }

  if (url.pathname === "/pub" && req.method === "POST") {
    const b = await readBody(req);
    const zone = String(b?.zone ?? "").slice(0, 64);
    const id = String(b?.id ?? "").slice(0, 64);
    if (!zone || !id) return json(res, 400, { ok: false, error: "zone and id required" });
    if (!zones.has(zone)) zones.set(zone, new Map());
    zones.get(zone).set(id, {
      name: String(b?.name ?? "").slice(0, 32) || id,
      st: String(b?.st ?? "").slice(0, 32) || null,
      until: typeof b?.until === "string" ? b.until.slice(0, 16) : null,
      at: Date.now(),
    });
    return json(res, 200, { ok: true, peers: peersOf(zone, id) });
  }

  json(res, 404, { ok: false, error: "not found" });
}).listen(Number(process.env.SGP_PRESENCE_PORT ?? 8643), process.env.SGP_PRESENCE_HOST ?? "0.0.0.0", function () {
  const a = this.address();
  console.log(`presence: http://${a.address}:${a.port} (ttl ${TTL_MS / 1000}s)`);
});
