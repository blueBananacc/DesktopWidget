/**
 * SGP-HTTP 隧道的报文编解码（规范：doc/http-api/tunnel.md）。
 * HTTP/1.1 报文语法子集：只用 Content-Length 分帧，不支持 Transfer-Encoding；
 * 解析器容忍报文之间的杂散字节（串口与设备日志共用 UART），以行首起始行重新同步。
 */

export interface HttpMessage {
  /** 请求：方法；响应：undefined */
  method?: string;
  /** 请求：origin-form（含 query） */
  target?: string;
  /** 响应：状态码 */
  status?: number;
  reason?: string;
  /** 头部名统一小写 */
  headers: Record<string, string>;
  body: Uint8Array;
}

export const REASONS: Record<number, string> = {
  200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict",
  413: "Payload Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Entity", 500: "Internal Server Error",
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function encode(startLine: string, headers: Record<string, string>, body?: Uint8Array): Uint8Array {
  const b = body ?? new Uint8Array(0);
  let head = `${startLine}\r\n`;
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== "content-length") head += `${k}: ${v}\r\n`;
  head += `Content-Length: ${b.length}\r\n\r\n`;
  const h = enc.encode(head);
  const out = new Uint8Array(h.length + b.length);
  out.set(h);
  out.set(b, h.length);
  return out;
}

export const encodeRequest = (method: string, target: string, headers: Record<string, string>, body?: Uint8Array) =>
  encode(`${method} ${target} HTTP/1.1`, headers, body);

export const encodeResponse = (status: number, headers: Record<string, string>, body?: Uint8Array) =>
  encode(`HTTP/1.1 ${status} ${REASONS[status] ?? "Unknown"}`, headers, body);

const REQ_LINE = /^([A-Z]{3,7}) (\/\S*) HTTP\/1\.1$/;
const RES_LINE = /^HTTP\/1\.1 (\d{3})(?: (.*))?$/;
const LINE_MAX = 1024;

/** 增量解析器：按字节喂入，每解析出一条完整报文回调一次 */
export class MessageParser {
  private phase: "start" | "headers" | "body" = "start";
  private line: number[] = [];
  private cur?: HttpMessage;
  private need = 0;
  private got = 0;

  constructor(private readonly kind: "request" | "response", private readonly onMessage: (m: HttpMessage) => void) {}

  feed(bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i++) {
      if (this.phase === "body") {
        const take = Math.min(this.need - this.got, bytes.length - i);
        this.cur!.body.set(bytes.subarray(i, i + take), this.got);
        this.got += take;
        i += take - 1;
        if (this.got >= this.need) this.finish();
        continue;
      }
      const c = bytes[i];
      if (c === 0x0d) continue;                     // CRLF 与裸 LF 都接受
      if (c !== 0x0a) {
        if (this.line.length < LINE_MAX) this.line.push(c);
        continue;
      }
      const text = dec.decode(new Uint8Array(this.line));
      this.line = [];
      if (this.phase === "start") this.startLine(text);
      else if (text === "") this.headersDone();
      else {
        const k = text.indexOf(":");
        if (k > 0) this.cur!.headers[text.slice(0, k).trim().toLowerCase()] = text.slice(k + 1).trim();
      }
    }
  }

  private startLine(text: string) {
    if (this.kind === "response") {
      const m = RES_LINE.exec(text);
      if (!m) return;                               // 杂散字节（设备日志等）：丢弃，等下一个起始行
      this.cur = { status: Number(m[1]), reason: m[2] ?? "", headers: {}, body: new Uint8Array(0) };
    } else {
      const m = REQ_LINE.exec(text);
      if (!m) return;
      this.cur = { method: m[1], target: m[2], headers: {}, body: new Uint8Array(0) };
    }
    this.phase = "headers";
  }

  private headersDone() {
    const n = Number(this.cur!.headers["content-length"] ?? "0");
    this.need = Number.isFinite(n) && n > 0 ? n : 0;
    this.got = 0;
    if (!this.need) { this.finish(); return; }
    this.cur!.body = new Uint8Array(this.need);
    this.phase = "body";
  }

  private finish() {
    const m = this.cur!;
    this.cur = undefined;
    this.phase = "start";
    this.onMessage(m);
  }
}

/** 一个 SSE 事件（事件帧报文体，tunnel.md §6.3） */
export const encodeSse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export function parseSse(body: Uint8Array): { event: string; data: string }[] {
  const out: { event: string; data: string }[] = [];
  for (const block of dec.decode(body).split(/\n\n/)) {
    let event = "message";
    const data: string[] = [];
    for (const l of block.split("\n")) {
      if (l.startsWith("event:")) event = l.slice(6).trim();
      else if (l.startsWith("data:")) data.push(l.slice(5).replace(/^ /, ""));
    }
    if (data.length) out.push({ event, data: data.join("\n") });
  }
  return out;
}

export const textOf = (b: Uint8Array) => dec.decode(b);
export const bytesOf = (s: string) => enc.encode(s);
