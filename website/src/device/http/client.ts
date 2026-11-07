import { MessageParser, encodeRequest, parseSse, textOf, type HttpMessage } from "./codec";
import type { ByteLink } from "./link";

/** 与 doc/http-api/openapi/openapi.yaml info.version 同步 */
export const API_SEMVER = "1.0.0";

const DEFAULT_TIMEOUT_MS = 5000;
const WRITE_SLICE = 1024;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  /** 往返耗时（ms），调试页展示 */
  ms: number;
}

export interface RequestOptions {
  json?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  timeoutMs?: number;
  /** 写出进度 0–1（大报文体，如屏幕程序上传） */
  onProgress?: (ratio: number) => void;
}

export type EventHandler = (name: string, data: unknown) => void;

interface Pending { resolve: (r: HttpResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; t0: number }

/**
 * 隧道客户端：在任意 ByteLink 上收发 HTTP/1.1 报文。
 * - 每个请求带唯一 X-Request-Id，响应按 id 匹配（允许乱序、与事件帧交错）
 * - 写出串行化：两个请求的字节绝不交错（BLE 分片写尤其需要）
 * - 事件流：订阅请求的后续同 id 帧按 SSE 解析后分发
 */
export class TunnelClient {
  private parser: MessageParser;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private streams = new Map<string, EventHandler>();
  private writeChain: Promise<void> = Promise.resolve();
  private frameTaps = new Set<(m: HttpMessage) => void>();
  private closed = false;

  constructor(private readonly link: ByteLink) {
    this.parser = new MessageParser("response", (m) => this.handleFrame(m));
    link.onData((b) => this.parser.feed(b));
  }

  /** 每收到一个完整帧回调（链路活性判断 / 调试页抓包）；返回退订函数 */
  onFrame(cb: (m: HttpMessage) => void): () => void {
    this.frameTaps.add(cb);
    return () => { this.frameTaps.delete(cb); };
  }

  private handleFrame(m: HttpMessage) {
    for (const tap of this.frameTaps) tap(m);
    const id = m.headers["x-request-id"] ?? "";
    const stream = this.streams.get(id);
    if (stream && (m.headers["content-type"] ?? "").startsWith("text/event-stream")) {
      const p = this.pending.get(id);
      if (p) this.settle(id, p, m);                 // 开流帧
      for (const ev of parseSse(m.body)) {
        let data: unknown = ev.data;
        try { data = JSON.parse(ev.data); } catch { /* 非 JSON 事件原样交出 */ }
        stream(ev.event, data);
      }
      return;
    }
    const p = this.pending.get(id);
    if (p) this.settle(id, p, m);
  }

  private settle(id: string, p: Pending, m: HttpMessage) {
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve({ status: m.status ?? 0, headers: m.headers, body: m.body, ms: Date.now() - p.t0 });
  }

  /** 发请求，返回原始结果（不因 4xx/5xx 抛错）——调试页使用 */
  raw(method: string, path: string, opts: RequestOptions = {}, id = `${++this.seq}`): Promise<HttpResult> {
    if (this.closed) return Promise.reject(new Error("设备未连接"));
    const headers: Record<string, string> = { "X-Request-Id": id, "X-Api-Sem-Ver": API_SEMVER };
    let body: Uint8Array | undefined;
    if (opts.bytes) { body = opts.bytes; headers["Content-Type"] = opts.contentType ?? "application/octet-stream"; }
    else if (opts.json !== undefined) { body = new TextEncoder().encode(JSON.stringify(opts.json)); headers["Content-Type"] = "application/json"; }
    if (path === "/api/events" && method === "GET") headers.Accept = "text/event-stream";
    const frame = encodeRequest(method, path, headers, body);
    return new Promise<HttpResult>((resolve, reject) => {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} ${path} 超时（${timeoutMs} ms 无响应）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, t0: Date.now() });
      this.writeChain = this.writeChain.then(async () => {
        for (let off = 0; off < frame.length; off += WRITE_SLICE) {
          await this.link.write(frame.subarray(off, off + WRITE_SLICE));
          opts.onProgress?.(Math.min(1, (off + WRITE_SLICE) / frame.length));
        }
      }).catch((e: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /** 发请求；状态码 ≥400 时按错误体抛 ApiError */
  async request(method: string, path: string, opts: RequestOptions = {}): Promise<HttpResult> {
    const r = await this.raw(method, path, opts);
    if (r.status >= 400) {
      let code = "unknown", msg = `HTTP ${r.status}`;
      try { const j = JSON.parse(textOf(r.body)); code = j.error_code ?? code; msg = j.error ?? msg; } catch { /* 非 JSON 错误体 */ }
      throw new ApiError(r.status, code, msg);
    }
    return r;
  }

  async json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const r = await this.request(method, path, opts);
    return (r.body.length ? JSON.parse(textOf(r.body)) : {}) as T;
  }

  /** 订阅事件流（tunnel.md §6）：开流帧到达即 resolve；之后的事件帧交给 handler */
  async subscribe(path: string, handler: EventHandler): Promise<string> {
    const id = `ev${++this.seq}`;
    for (const old of this.streams.keys()) this.streams.delete(old);   // 每通道一个订阅：新订阅替换旧订阅
    this.streams.set(id, handler);
    const r = await this.raw("GET", path, {}, id);
    if (r.status !== 200) { this.streams.delete(id); throw new ApiError(r.status, "subscribe_failed", `订阅 ${path} 失败：HTTP ${r.status}`); }
    return id;
  }

  close() {
    this.closed = true;
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("设备已断开")); this.pending.delete(id); }
    this.streams.clear();
  }
}
