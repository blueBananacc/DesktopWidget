#!/usr/bin/env node
/**
 * 收工牌串口 → 本地 HTTP 桥（doc/http-api/tunnel.md §7 "电脑侧桥"）
 *
 * 用法:  node bridge.mjs [--port COM8] [--listen 8787] [--baud 460800]
 * 依赖:  npm i serialport
 *
 * 对外暴露真 HTTP：
 *   curl http://127.0.0.1:8787/api/version
 *   curl -X PATCH http://127.0.0.1:8787/api/led -H 'Content-Type: application/json' -d '{"br":60}'
 *   curl -N http://127.0.0.1:8787/api/events        # SSE 事件流
 *   GET /openapi.json  返回网站的接口定义副本（website/public/openapi.json，若存在）
 *
 * 桥内部：HTTP 请求 → 透传报文字节进串口（设备端隧道解析器处理）；
 * 设备回帧按 X-Request-Id 关联回对应请求；text/event-stream 帧转 SSE 长连接。
 * 同一时间串口只能被一个程序占用：桥运行期间网页串口连接不可用（反之亦然）。
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SerialPort } from "serialport";

// ---------- 参数 ----------
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = arg("port", process.env.SGP_PORT || "COM8");
const LISTEN = Number(arg("listen", 8787));
const BAUD = Number(arg("baud", 460800));
const HOST = "127.0.0.1";
const API_SEMVER = "1.0.0";

// ---------- HTTP 报文编解码（与 website/src/device/http/codec.ts 同规范） ----------
const REASONS = { 200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Entity", 500: "Internal Server Error" };
const enc = new TextEncoder(), dec = new TextDecoder();

function encodeRequest(method, target, headers, body) {
  const b = body ?? new Uint8Array(0);
  let head = `${method} ${target} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== "content-length") head += `${k}: ${v}\r\n`;
  head += `Content-Length: ${b.length}\r\n\r\n`;
  const h = enc.encode(head);
  const out = new Uint8Array(h.length + b.length);
  out.set(h); out.set(b, h.length);
  return out;
}

/** 增量解析器（response 模式）：容忍帧间杂散字节（设备日志共用 UART） */
class ResponseParser {
  constructor(onMessage) { this.onMessage = onMessage; this.phase = "start"; this.line = []; this.cur = null; this.need = 0; this.got = 0; }
  feed(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      if (this.phase === "body") {
        const take = Math.min(this.need - this.got, bytes.length - i);
        this.cur.body.set(bytes.subarray(i, i + take), this.got);
        this.got += take; i += take - 1;
        if (this.got >= this.need) this.finish();
        continue;
      }
      const c = bytes[i];
      if (c === 0x0d) continue;
      if (c !== 0x0a) { if (this.line.length < 1024) this.line.push(c); continue; }
      const text = dec.decode(new Uint8Array(this.line)); this.line = [];
      if (this.phase === "start") {
        const m = /^HTTP\/1\.1 (\d{3})(?: (.*))?$/.exec(text);
        if (m) { this.cur = { status: Number(m[1]), headers: {}, body: new Uint8Array(0) }; this.phase = "headers"; }
      } else if (text === "") {
        const n = Number(this.cur.headers["content-length"] ?? "0");
        this.need = Number.isFinite(n) && n > 0 ? n : 0; this.got = 0;
        if (!this.need) this.finish(); else { this.cur.body = new Uint8Array(this.need); this.phase = "body"; }
      } else {
        const k = text.indexOf(":");
        if (k > 0) this.cur.headers[text.slice(0, k).trim().toLowerCase()] = text.slice(k + 1).trim();
      }
    }
  }
  finish() { const m = this.cur; this.cur = null; this.phase = "start"; this.onMessage(m); }
}

// ---------- 串口 ----------
const port = new SerialPort({ path: PORT, baudRate: BAUD, autoOpen: false });
const pending = new Map();   // id -> {res, sse}
const streams = new Map();   // id -> res (SSE response)
let seq = 0;
let writeChain = Promise.resolve();

port.open((e) => {
  if (e) { console.error(`[bridge] 打不开 ${PORT}: ${e.message}`); process.exit(1); }
  console.log(`[bridge] 串口 ${PORT} @${BAUD} 已开`);
});

const parser = new ResponseParser((m) => {
  const id = m.headers["x-request-id"] ?? "";
  const sse = streams.get(id);
  if (sse) {
    if (m.body.length) sse.write(m.body);            // 事件帧报文体本身就是一段 SSE
    return;
  }
  const p = pending.get(id);
  if (p) { pending.delete(id); p(m); }
});
port.on("data", (b) => parser.feed(b));
port.on("close", () => { console.log("[bridge] 串口关闭"); });
port.on("error", (e) => console.error("[bridge] 串口错误:", e.message));

const tunnelWrite = (frame) =>
  (writeChain = writeChain.then(() => new Promise((res, rej) => {
    port.write(Buffer.from(frame), (e) => (e ? rej(e) : port.drain(() => res())));
  })));

// ---------- 本地 HTTP ----------
const openapiPath = join(dirname(fileURLToPath(import.meta.url)), "..", "website", "public", "openapi.json");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${LISTEN}`);
  if (url.pathname === "/openapi.json") {
    if (existsSync(openapiPath)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(readFileSync(openapiPath));
    } else res.writeHead(404).end("openapi.json not found (run website/scripts/openapi-bundle.mjs)");
    return;
  }
  if (!url.pathname.startsWith("/api/")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("收工牌 HTTP 桥：转发 /api/* 到串口隧道；/openapi.json 为接口定义。\n");
    return;
  }

  const body = await new Promise((r) => { const parts = []; req.on("data", (c) => parts.push(c)); req.on("end", () => r(Buffer.concat(parts))); });
  const id = `b${++seq}`;
  const headers = { "X-Request-Id": id, "X-Api-Sem-Ver": API_SEMVER };
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (lk !== "content-length" && lk !== "host" && lk !== "connection" && lk !== "x-request-id" && lk !== "x-api-sem-ver")
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  const target = url.pathname + url.search;
  const isEvents = req.method === "GET" && url.pathname === "/api/events";
  if (isEvents) headers.Accept = "text/event-stream";

  const frame = encodeRequest(req.method, target, headers, body.length ? new Uint8Array(body) : undefined);
  console.log(`[bridge] → ${req.method} ${target} (${body.length}B) id=${id}`);

  const response = new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ status: 0 }); }, isEvents ? 10000 : 8000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  });
  try {
    await tunnelWrite(frame);
  } catch (e) {
    pending.delete(id);
    res.writeHead(502).end(`serial write failed: ${e.message}`);
    return;
  }
  const m = await response;
  if (!m.status) { res.writeHead(504).end("device timeout"); return; }

  const ct = m.headers["content-type"] ?? "application/octet-stream";
  if (isEvents && ct.startsWith("text/event-stream")) {
    // 开流帧已消费；后续同 id 的事件帧持续写入本响应（SSE 长连接）
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    if (m.body.length) res.write(m.body);
    streams.set(id, res);
    req.on("close", () => streams.delete(id));
    return;
  }
  const outHeaders = { "Content-Type": ct };
  for (const [k, v] of Object.entries(m.headers)) if (k !== "content-length" && k !== "content-type" && k !== "x-request-id") outHeaders[k] = v;
  res.writeHead(m.status, outHeaders);
  res.end(Buffer.from(m.body));
});

server.listen(LISTEN, HOST, () => {
  console.log(`[bridge] HTTP 桥就绪：http://${HOST}:${LISTEN}/api/* → ${PORT}`);
  console.log(`[bridge] 例：curl http://${HOST}:${LISTEN}/api/version`);
});
