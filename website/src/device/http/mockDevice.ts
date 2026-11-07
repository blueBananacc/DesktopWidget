import type { DevSched, DevStdef, DeviceTodo } from "../protocol";
import { u8ToB64 } from "../app";
import { pcmToAdpcmFrame } from "../audio";
import { MessageParser, bytesOf, encodeResponse, encodeSse, textOf, type HttpMessage } from "./codec";

type Json = Record<string, unknown>;

/** 与固件 statusIdOk 一致：内建状态 id + 自定义 c + 1-6 位小写字母数字 */
const STATUS_IDS = ["work", "focus", "meet", "rest", "busy", "off"];
const statusIdOk = (s: string) => STATUS_IDS.includes(s) || /^c[a-z0-9]{1,6}$/.test(s);

/**
 * 模拟设备本体：在字节层实现 doc/http-api 的全部路由（与固件同一套规范）。
 * 只做协议模拟——收到 HTTP 请求帧 → 跑与固件对齐的状态机 → 回响应帧；
 * 自治行为（计划表/待办/定时/ESP-NOW 同伴）以事件帧推到已订阅的事件流。
 */
export class MockDevice {
  private parser = new MessageParser("request", (m) => this.route(m));
  private streamId = "";
  private cur = { status: "work", screen: "工作中", sub: "", layout: "full", led: "solid", brightness: 60 };
  private tzOffsetMin = 480;
  private timeSynced = false;
  private apps = new Map<string, Uint8Array>();
  private sttTimer?: ReturnType<typeof setInterval>;
  private sttStart = 0;
  private sttSeq = 0;
  private sttEnc = { pred: 0, idx: 0 };
  private agentMsgs: { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string }[] = [];
  private agentRound = 0;
  private todos: DeviceTodo[] = [];
  private nextId = 1;
  private scheds: DevSched[] = [];
  private schedAct = "";
  private schedMode: "next" | "today" = "next";
  private schedPausedDay = "";
  private schedHold = false;
  private schedNextId = 1;
  private schedLastMin = -1;
  private offDay = "";
  private segs: { status: string; start: number; end?: number }[] = [];
  private segDirty = false;
  private segDirtyAt = 0;
  private stdefs: DevStdef[] = [];
  private stdefNextId = 1;
  private keyActs: [string, string, string, string, string] = ["offwork", "busy", "cycleL", "cycleR", "rest"];
  private ledMap: Record<string, "solid" | "breath" | "off"> = {};
  private ledBr = 40;
  private ledNight = false;
  private knobStep = 5;
  private knobMax = 180;
  private timerTimeout?: ReturnType<typeof setTimeout>;
  private timerUntil = 0;
  private timerMinutes = 0;
  private shareEn = false;
  private shareName = "";
  private shareZone = "default";
  private peerStIdx = 0;
  private breakMin = 45;
  private breakEnabled = true;
  private breakOffToday = false;
  private breakAccumMs = 0;
  private breakLastMs = 0;
  private breakDueSent = false;
  private pollTimer?: ReturnType<typeof setInterval>;
  private beatTimer?: ReturnType<typeof setInterval>;
  private peerTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly out: (bytes: Uint8Array) => void) {}

  feed(bytes: Uint8Array) { this.parser.feed(bytes); }

  /** 设备端动作注入（模拟页测试按钮）：直接以事件帧上送，等效于实体键触发等 */
  inject(payload: Json & { type: string }) { this.emit(payload); }
  /** 模拟旋钮选定并启动快速定时（与 POST /api/timer/start 同语义，但是从"旋钮"发起） */
  knobStart(minutes: number) {
    this.timerMinutes = Math.min(this.knobMax, Math.max(this.knobStep, minutes));
    this.timerUntil = Date.now() + this.timerMinutes * 60_000;
    if (this.timerTimeout) clearTimeout(this.timerTimeout);
    this.timerTimeout = setTimeout(() => { this.timerUntil = 0; this.emit({ type: "timer", st: "done", minutes: this.timerMinutes }); }, this.timerMinutes * 60_000);
    this.emit(this.timerSnap());
  }
  /** 最近一次写入的设备状态（模拟页展示"设备看到的状态"） */
  get lastState() { return { type: "state", ...this.cur }; }

  start() {
    const load = <T,>(key: string, f: (j: T) => void) => { try { const j = JSON.parse(localStorage.getItem(key) || "null"); if (j) f(j as T); } catch { /* 空 */ } };
    load<DeviceTodo[]>("sgp-mock-todos", (j) => { this.todos = j; });
    load<Json>("sgp-mock-scheds", (j) => { this.scheds = (j.list as DevSched[]) ?? []; this.schedAct = (j.act as string) ?? ""; this.schedMode = (j.mode as "next" | "today") ?? "next"; this.schedPausedDay = (j.pday as string) ?? ""; this.schedNextId = (j.nextId as number) ?? 1; });
    load<Json>("sgp-mock-stdefs", (j) => { this.stdefs = (j.list as DevStdef[]) ?? []; this.stdefNextId = (j.nextId as number) ?? 1; });
    load<Json>("sgp-mock-keys", (j) => { this.keyActs = [(j.k1 as string) ?? "offwork", (j.k2 as string) ?? "busy", (j.k3 as string) ?? "cycleL", (j.k4 as string) ?? "cycleR", (j.t as string) ?? "rest"]; });
    load<Json>("sgp-mock-led", (j) => { this.ledMap = (j.map as Record<string, "solid" | "breath" | "off">) ?? {}; this.ledBr = (j.br as number) ?? 40; this.ledNight = !!j.night; });
    load<Json>("sgp-mock-knob", (j) => { this.knobStep = (j.step as number) ?? 5; this.knobMax = (j.max as number) ?? 180; });
    load<Json>("sgp-mock-share", (j) => { this.shareEn = !!j.en; this.shareName = (j.name as string) ?? ""; this.shareZone = (j.zone as string) ?? "default"; });
    this.segs = [{ status: "work", start: Date.now() }];
    this.breakLastMs = Date.now();
    this.pollTimer = setInterval(() => this.poll(), 1000);
    this.beatTimer = setInterval(() => this.beat(), 10000);    // breakState 心跳 + wantTime + peers 兜底
    this.peerTimer = setInterval(() => this.peerTick(), 8000);
  }

  stop() {
    for (const t of [this.sttTimer, this.pollTimer, this.beatTimer, this.peerTimer, this.timerTimeout]) if (t) clearInterval(t);
    this.sttTimer = this.pollTimer = this.beatTimer = this.peerTimer = this.timerTimeout = undefined;
    this.streamId = "";
  }

  // ---- 帧输出 ----
  private respond(req: HttpMessage, status: number, contentType: string, body?: Uint8Array) {
    this.out(encodeResponse(status, { "X-Request-Id": req.headers["x-request-id"] ?? "", "Content-Type": contentType }, body));
  }
  private json(req: HttpMessage, status: number, obj: unknown) { this.respond(req, status, "application/json", bytesOf(JSON.stringify(obj))); }
  private ok(req: HttpMessage, extra?: Json) { this.json(req, 200, { result: "OK", ...extra }); }
  private err(req: HttpMessage, status: number, code: string, msg: string) { this.json(req, status, { error: msg, error_code: code }); }
  private bad(req: HttpMessage, msg: string) { this.err(req, 400, "bad_field", msg); }
  /** 事件帧：仅已订阅事件流时发出（tunnel.md §6.3） */
  private emit(payload: Json & { type: string }) {
    if (!this.streamId) return;
    this.out(encodeResponse(200, { "X-Request-Id": this.streamId, "Content-Type": "text/event-stream" }, encodeSse(payload.type, payload)));
  }
  private bodyJson(req: HttpMessage): Json | undefined {
    if (!req.body.length) { this.err(req, 400, "bad_request", "request body required"); return undefined; }
    try { return JSON.parse(textOf(req.body)) as Json; } catch { this.err(req, 400, "bad_request", "body is not valid JSON"); return undefined; }
  }

  // ---- 路由（镜像固件 HTTP_ROUTES 表） ----
  private route(m: HttpMessage) {
    const semver = m.headers["x-api-sem-ver"];
    if (semver && parseInt(semver, 10) !== 1) { this.err(m, 400, "incompatible_api_version", "device API version is 1.0.0"); return; }
    const path = m.target?.split("?")[0].replace(/\/$/, "") ?? "";
    const method = m.method ?? "";
    const seg = (pattern: string): string[] | null => {
      const pp = pattern.split("/"), pa = path.split("/");
      if (pp.length !== pa.length) return null;
      const params: string[] = [];
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith("{") && pp[i].endsWith("}")) { if (!pa[i]) return null; params.push(decodeURIComponent(pa[i])); }
        else if (pp[i] !== pa[i]) return null;
      }
      return params;
    };
    const R = (pattern: string): { params: string[] } | null => {
      const p = seg(pattern);
      return p ? { params: p } : null;
    };
    let matchedPath = false;
    const handle = (pattern: string, methods: Record<string, (p: string[]) => void>): boolean => {
      const r = R(pattern);
      if (!r) return false;
      matchedPath = true;
      const fn = methods[method];
      if (!fn) return false;
      fn(r.params);
      return true;
    };
    const done =
      handle("/api/version", { GET: () => this.json(m, 200, { api_semver: "1.0.0", firmware: "v1.6-mock", name: "收工牌-A12（模拟）" }) }) ||
      handle("/api/events", {
        GET: () => { this.respond(m, 200, "text/event-stream"); this.streamId = m.headers["x-request-id"] ?? ""; setTimeout(() => this.pushSnapshots(), 60); },
        DELETE: () => { this.streamId = ""; this.ok(m); },
      }) ||
      handle("/api/state", {
        GET: () => this.json(m, 200, { type: "state", ...this.cur }),
        PUT: () => { const d = this.bodyJson(m); if (!d) return; if (typeof d.status !== "string" || !d.status) return this.bad(m, "status is required"); this.putState(d); this.ok(m); },
      }) ||
      handle("/api/time", {
        GET: () => this.json(m, 200, { type: "time", synced: this.timeSynced, epoch: this.timeSynced ? Date.now() : -1, tzOffsetMin: this.tzOffsetMin }),
        PUT: () => { const d = this.bodyJson(m); if (!d) return; if (typeof d.epoch !== "number") return this.bad(m, "epoch is required"); this.tzOffsetMin = (d.tzOffsetMin as number) ?? 480; this.timeSynced = true; this.segDirty = true; this.ok(m); },
      }) ||
      handle("/api/segments", { GET: () => this.json(m, 200, { type: "segments", list: this.segs.map((s) => ({ type: "seg", status: s.status, start: s.start, ...(s.end !== undefined && { end: s.end }) })) }) }) ||
      handle("/api/break", {
        GET: () => this.json(m, 200, this.breakSnap(false)),
        PATCH: () => { const d = this.bodyJson(m); if (!d) return; if (d.minutes !== undefined && typeof d.minutes !== "number") return this.bad(m, "minutes must be an integer"); if (typeof d.minutes === "number") this.breakMin = Math.max(1, d.minutes); if (typeof d.enabled === "boolean") this.breakEnabled = d.enabled; if (typeof d.offToday === "boolean") this.breakOffToday = d.offToday; if (typeof d.accumMs === "number") this.breakAccumMs = d.accumMs; this.emit(this.breakSnap(false)); this.ok(m); },
      }) ||
      handle("/api/schedules", {
        GET: () => this.json(m, 200, this.schedSnap()),
        POST: () => { const d = this.bodyJson(m); if (!d || this.schedBodyBad(m, d)) return; if (this.scheds.length >= 8) return this.err(m, 409, "full", "schedule list is full"); const id = `s${this.schedNextId++}`; this.schedSet(id, d); this.reportSchedules(); this.json(m, 200, { result: "OK", id }); },
        DELETE: () => { this.scheds = []; this.schedAct = ""; this.reportSchedules(); this.ok(m); },
      }) ||
      handle("/api/schedules/control", {
        PATCH: () => {
          const d = this.bodyJson(m); if (!d) return;
          const hasP = d.paused !== undefined, hasM = d.mode !== undefined;
          if (hasP && typeof d.paused !== "boolean") return this.bad(m, "paused must be a boolean");
          if (hasM && d.mode !== "next" && d.mode !== "today") return this.bad(m, "mode must be next or today");
          if (!hasP && !hasM) return this.bad(m, "paused or mode is required");
          if (hasP) this.schedPausedDay = (d.paused as boolean) ? this.dayKey() : "";
          if (hasM) this.schedMode = d.mode as "next" | "today";
          this.schedLastMin = -1; this.reportSchedules(); this.ok(m);
        },
      }) ||
      handle("/api/schedules/{id}", {
        PUT: (p) => { const d = this.bodyJson(m); if (!d || this.schedBodyBad(m, d)) return; if (p[0].length > 11) return this.bad(m, "id too long"); this.schedSet(p[0], d); this.reportSchedules(); this.ok(m); },
        DELETE: (p) => { if (!this.scheds.some((s) => s.id === p[0])) return this.err(m, 404, "not_found", "schedule not found"); if (this.schedAct === p[0]) this.schedAct = ""; this.scheds = this.scheds.filter((s) => s.id !== p[0]); this.reportSchedules(); this.ok(m); },
      }) ||
      handle("/api/schedules/{id}/activate", {
        POST: (p) => { const sc = this.scheds.find((s) => s.id === p[0]); if (!sc) return this.err(m, 404, "not_found", "schedule not found"); if (sc.kind !== "repeat") return this.err(m, 422, "not_repeat", "only repeat schedules can be activated"); this.schedAct = p[0]; this.schedLastMin = -1; this.reportSchedules(); this.ok(m); },
      }) ||
      handle("/api/stdefs", {
        GET: () => this.json(m, 200, this.stdefSnap()),
        POST: () => { const d = this.bodyJson(m); if (!d) return; if (typeof d.zh !== "string") return this.bad(m, "zh is required"); if (this.stdefs.length >= 8) return this.err(m, 409, "full", "custom status list is full"); const id = `c${this.stdefNextId++}`; this.stdefs.push({ id, zh: d.zh, hint: d.hint as string | undefined, c: (d.c as number) ?? 0, work: d.work as boolean | undefined }); this.reportStdefs(); this.json(m, 200, { result: "OK", id }); },
      }) ||
      handle("/api/stdefs/{id}", {
        PUT: (p) => { const d = this.bodyJson(m); if (!d) return; if (!/^c[a-z0-9]{1,6}$/.test(p[0])) return this.bad(m, "custom status id must be c + 1-6 lowercase alphanumerics"); if (typeof d.zh !== "string") return this.bad(m, "zh is required"); const i = this.stdefs.findIndex((x) => x.id === p[0]); const def = { id: p[0], zh: d.zh, hint: d.hint as string | undefined, c: (d.c as number) ?? 0, work: d.work as boolean | undefined }; if (i >= 0) this.stdefs[i] = def; else this.stdefs.push(def); this.reportStdefs(); this.ok(m); },
        DELETE: (p) => { if (!this.stdefs.some((x) => x.id === p[0])) return this.err(m, 404, "not_found", "custom status not found"); this.stdefs = this.stdefs.filter((x) => x.id !== p[0]); this.apps.delete(p[0]); this.reportStdefs(); this.emit(this.appsSnap()); if (this.cur.status === p[0]) { this.markStatus("work"); this.cur = { ...this.cur, status: "work", screen: "工作中", sub: "" }; this.emit({ type: "state", ...this.cur }); } this.ok(m); },
      }) ||
      handle("/api/todos", {
        GET: () => this.json(m, 200, this.todoSnap()),
        POST: () => {
          const d = this.bodyJson(m); if (!d) return;
          if (typeof d.text !== "string" || !d.text) return this.bad(m, "text is required");
          if (d.at !== undefined && typeof d.at !== "number") return this.bad(m, "at must be epoch milliseconds");
          if (this.todos.length >= 32) return this.err(m, 409, "full", "todo list is full");
          const id = `t${this.nextId++}`;
          this.todos.push({ id, at: d.at as number | undefined, trig: d.trig === "offwork" ? "offwork" : undefined, text: d.text, show: (d.show as boolean | undefined) ?? true, src: (d.src as string) ?? "web", created: Date.now(), done: false });
          this.reportTodos(); this.json(m, 200, { result: "OK", id });
        },
        DELETE: () => { this.todos = []; this.reportTodos(); this.ok(m); },
      }) ||
      handle("/api/todos/{id}", {
        PATCH: (p) => {
          const t = this.todos.find((x) => x.id === p[0]);
          if (!t) return this.err(m, 404, "not_found", "todo not found");
          const d = this.bodyJson(m); if (!d) return;
          if (d.text !== undefined) t.text = String(d.text);
          if (d.at !== undefined) t.at = (d.at as number) < 0 ? undefined : (d.at as number);
          if (d.trig !== undefined) t.trig = d.trig === "offwork" ? "offwork" : undefined;
          if (d.show !== undefined) t.show = !!d.show;
          if (d.done !== undefined) t.done = !!d.done;
          this.reportTodos(); this.ok(m);
        },
        DELETE: (p) => { if (!this.todos.some((x) => x.id === p[0])) return this.err(m, 404, "not_found", "todo not found"); this.todos = this.todos.filter((x) => x.id !== p[0]); this.reportTodos(); this.ok(m); },
      }) ||
      handle("/api/reminders", { POST: () => { const d = this.bodyJson(m); if (!d) return; this.ok(m); } }) ||
      handle("/api/keys", {
        GET: () => this.json(m, 200, this.keysSnap()),
        PUT: () => {
          const d = this.bodyJson(m); if (!d) return;
          for (const k of ["k1", "k2", "k3", "k4"]) if (typeof d[k] !== "string" || !d[k]) return this.bad(m, "k1-k4 are required");
          const next: [string, string, string, string, string] = [d.k1 as string, d.k2 as string, d.k3 as string, d.k4 as string, (d.t as string) ?? this.keyActs[4]];
          if (!next.slice(0, 4).includes("offwork")) return this.err(m, 422, "need_offwork", "one of k1-k4 must be offwork");
          this.keyActs = next; this.reportKeys(); this.ok(m);
        },
      }) ||
      handle("/api/led", {
        GET: () => this.json(m, 200, this.ledSnap()),
        PATCH: () => {
          const d = this.bodyJson(m); if (!d) return;
          if (d.map !== undefined) {
            if (typeof d.map !== "object" || d.map === null) return this.bad(m, "map must be an object");
            for (const v of Object.values(d.map)) if (v !== "solid" && v !== "breath" && v !== "off") return this.bad(m, "map values must be solid, breath or off");
            this.ledMap = { ...this.ledMap, ...(d.map as Record<string, "solid" | "breath" | "off">) };
          }
          if (d.br !== undefined) { if (typeof d.br !== "number" || d.br < 0 || d.br > 100) return this.bad(m, "br must be 0-100"); this.ledBr = d.br; this.cur.brightness = d.br; }
          if (d.night !== undefined) this.ledNight = !!d.night;
          this.cur.led = this.ledMap[this.cur.status] ?? this.cur.led;
          this.reportLed(); this.emit({ type: "state", ...this.cur }); this.ok(m);
        },
      }) ||
      handle("/api/timer", {
        GET: () => this.json(m, 200, this.timerSnap()),
      }) ||
      handle("/api/timer/start", {
        POST: () => {
          const d = this.bodyJson(m); if (!d) return;
          if (typeof d.minutes !== "number" || d.minutes < 1) return this.bad(m, "minutes must be a positive integer");
          this.timerMinutes = Math.min(this.knobMax, Math.max(this.knobStep, d.minutes));
          this.timerUntil = Date.now() + this.timerMinutes * 60_000;
          if (this.timerTimeout) clearTimeout(this.timerTimeout);
          this.timerTimeout = setTimeout(() => { this.timerUntil = 0; this.emit({ type: "timer", st: "done", minutes: this.timerMinutes }); }, this.timerMinutes * 60_000);
          this.emit(this.timerSnap()); this.ok(m);
        },
      }) ||
      handle("/api/timer/cancel", {
        POST: () => { if (this.timerTimeout) { clearTimeout(this.timerTimeout); this.timerTimeout = undefined; } this.timerUntil = 0; this.emit(this.timerSnap()); this.ok(m); },
      }) ||
      handle("/api/timer/config", {
        GET: () => this.json(m, 200, this.knobSnap()),
        PATCH: () => {
          const d = this.bodyJson(m); if (!d) return;
          if ((d.step !== undefined && typeof d.step !== "number") || (d.max !== undefined && typeof d.max !== "number")) return this.bad(m, "step and max must be integers");
          if (typeof d.step === "number") this.knobStep = Math.min(30, Math.max(1, d.step));
          if (typeof d.max === "number") this.knobMax = Math.min(600, Math.max(this.knobStep, d.max));
          this.reportKnob(); this.ok(m);
        },
      }) ||
      handle("/api/share", {
        GET: () => this.json(m, 200, this.shareSnap()),
        PATCH: () => {
          const d = this.bodyJson(m); if (!d) return;
          if (d.en !== undefined && typeof d.en !== "boolean") return this.bad(m, "en must be a boolean");
          if (d.name !== undefined && bytesOf(String(d.name)).length >= 16) return this.bad(m, "name exceeds 16 bytes");
          if (d.zone !== undefined && bytesOf(String(d.zone)).length >= 8) return this.bad(m, "zone exceeds 8 bytes");
          if (d.en !== undefined) this.shareEn = d.en;
          if (typeof d.name === "string" && d.name) this.shareName = d.name;
          if (typeof d.zone === "string" && d.zone) this.shareZone = d.zone;
          this.reportShare(); this.ok(m);
        },
      }) ||
      handle("/api/peers", { GET: () => this.json(m, 200, this.peersSnap()) }) ||
      handle("/api/apps", { GET: () => this.json(m, 200, this.appsSnap()) }) ||
      handle("/api/apps/stop", { POST: () => this.ok(m) }) ||
      handle("/api/apps/{status}", {
        GET: (p) => { if (!statusIdOk(p[0])) return this.bad(m, "invalid status id"); const a = this.apps.get(p[0]); if (!a) return this.err(m, 404, "not_found", "no screen program for this status"); this.respond(m, 200, "application/octet-stream", a); },
        PUT: (p) => {
          if (!statusIdOk(p[0])) return this.bad(m, "invalid status id");
          if (!(m.headers["content-type"] ?? "").startsWith("application/octet-stream")) return this.err(m, 415, "unsupported_media_type", "expected application/octet-stream");
          if (m.body.length < 8 || !(m.body[0] === 0 && m.body[1] === 0x61 && m.body[2] === 0x73 && m.body[3] === 0x6d)) return this.err(m, 422, "invalid_wasm", "body is not a wasm module");
          this.apps.set(p[0], m.body.slice());
          this.emit(this.appsSnap()); this.ok(m, { size: m.body.length });
        },
        DELETE: (p) => { if (!statusIdOk(p[0])) return this.bad(m, "invalid status id"); this.apps.delete(p[0]); this.emit(this.appsSnap()); this.ok(m); },
      }) ||
      handle("/api/stt/start", { POST: () => { this.stt(true); this.ok(m); } }) ||
      handle("/api/stt/stop", { POST: () => { this.stt(false); this.ok(m); } }) ||
      handle("/api/stt/result", {
        POST: () => { const d = this.bodyJson(m); if (!d) return; const t = (d.text as string) ?? ""; if (!t) return this.bad(m, "text is required"); if (this.agentMsgs.length) return this.err(m, 409, "busy", "an agent loop is already running"); this.agentStart(t); this.ok(m); },
      }) ||
      handle("/api/agent/response", {
        POST: () => { const d = this.bodyJson(m); if (!d) return; if (typeof d.message !== "object" || d.message === null) return this.bad(m, "message is required"); if (!this.agentMsgs.length) return this.err(m, 409, "not_waiting", "device is not waiting for an LLM response"); this.agentTurn(d.message as { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }); this.ok(m); },
      }) ||
      handle("/api/agent/cancel", { POST: () => { this.agentMsgs = []; this.ok(m); } });

    if (!done) {
      if (matchedPath) this.err(m, 405, "method_not_allowed", "method not allowed on this path");
      else this.err(m, 404, "not_found", "no such endpoint");
    }
  }

  // ---- 订阅快照序列（events.md §2） ----
  private pushSnapshots() {
    this.emit({ type: "hello", name: "收工牌-A12（模拟）", firmware: "v1.6-mock" });
    this.emit({ type: "state", ...this.cur });
    this.emit(this.breakSnap(false));
    this.emit(this.appsSnap());
    this.emit(this.todoSnap());
    this.emit(this.schedSnap());
    this.emit(this.stdefSnap());
    this.emit(this.keysSnap());
    this.emit(this.ledSnap());
    this.emit(this.knobSnap());
    this.emit(this.timerSnap());
    this.emit(this.shareSnap());
    this.emit(this.peersSnap());
    if (this.timeSynced) this.pushSegments();
    else this.emit({ type: "wantTime" });
  }

  // ---- 快照构造 ----
  private breakSnap = (due: boolean) => ({ type: "breakState", minutes: this.breakMin, accumMs: this.breakAccumMs, enabled: this.breakEnabled, offToday: this.breakOffToday, due });
  private todoSnap = () => ({ type: "todos", list: this.todos.map((t) => ({ ...t })) });
  private schedSnap = () => ({ type: "schedules", act: this.schedAct, paused: this.schedPausedDay === this.dayKey(), mode: this.schedMode, list: this.scheds.map((s) => ({ ...s, ns: s.ns.map((n) => ({ ...n })) })) });
  private stdefSnap = () => ({ type: "stdefs", list: this.stdefs.map((d) => ({ ...d })) });
  private keysSnap = () => { const [k1, k2, k3, k4, t] = this.keyActs; return { type: "keys", k1, k2, k3, k4, t }; };
  private ledSnap = () => ({ type: "led", map: { ...this.ledMap }, br: this.ledBr, night: this.ledNight });
  private knobSnap = () => ({ type: "timerCfg", step: this.knobStep, max: this.knobMax });
  private timerSnap = () => this.timerUntil ? { type: "timer", st: "run", minutes: this.timerMinutes, remain: this.timerUntil - Date.now() } : { type: "timer", st: "idle" };
  private shareSnap = () => ({ type: "share", en: this.shareEn, name: this.shareName, zone: this.shareZone });
  private peersSnap = () => ({ type: "peers", list: this.shareEn ? [{ i: "34:B7", n: "工位旁的小王", st: ["work", "focus", "meet", "busy", "rest"][this.peerStIdx], at: Date.now() }] : [] });
  private appsSnap = () => ({ type: "apps", list: [...this.apps].map(([status, b]) => ({ status, size: b.length })) });

  private reportTodos() { localStorage.setItem("sgp-mock-todos", JSON.stringify(this.todos)); this.emit(this.todoSnap()); }
  private reportSchedules() { localStorage.setItem("sgp-mock-scheds", JSON.stringify({ list: this.scheds, act: this.schedAct, mode: this.schedMode, pday: this.schedPausedDay, nextId: this.schedNextId })); this.emit(this.schedSnap()); }
  private reportStdefs() { localStorage.setItem("sgp-mock-stdefs", JSON.stringify({ list: this.stdefs, nextId: this.stdefNextId })); this.emit(this.stdefSnap()); }
  private reportKeys() { const [k1, k2, k3, k4, t] = this.keyActs; localStorage.setItem("sgp-mock-keys", JSON.stringify({ k1, k2, k3, k4, t })); this.emit(this.keysSnap()); }
  private reportLed() { localStorage.setItem("sgp-mock-led", JSON.stringify({ map: this.ledMap, br: this.ledBr, night: this.ledNight })); this.emit(this.ledSnap()); }
  private reportKnob() { localStorage.setItem("sgp-mock-knob", JSON.stringify({ step: this.knobStep, max: this.knobMax })); this.emit(this.knobSnap()); }
  private reportShare() { localStorage.setItem("sgp-mock-share", JSON.stringify({ en: this.shareEn, name: this.shareName, zone: this.shareZone })); this.emit(this.shareSnap()); }

  // ---- 业务 ----
  private putState(d: Json) {
    const st = String(d.status);
    const nId = st, nm = (d.screen as string) ?? this.statusZh(st), ns = (d.sub as string) ?? "";
    const nl = d.layout === "clock" ? "clock" : d.layout === "status" ? "status" : d.layout === "full" ? "full" : this.cur.layout;
    const lm = (d.led as typeof this.cur.led) ?? this.cur.led;
    const br = (d.brightness as number) ?? this.cur.brightness;
    const changed = nId !== this.cur.status || nm !== this.cur.screen || ns !== this.cur.sub || nl !== this.cur.layout || lm !== this.cur.led || br !== this.cur.brightness;
    if (nId !== this.cur.status) {
      const wasOff = this.cur.status === "off";
      this.markStatus(st);
      if (st === "off" && !wasOff) this.fireOffworkTodos();
      if (!wasOff && st !== "off") this.schedManual(st);
    }
    this.cur = { status: nId, screen: nm, sub: ns, layout: nl, led: lm, brightness: br };
    if (changed) this.emit({ type: "state", ...this.cur });
  }
  private statusZh(id: string) { return this.stdefs.find((d) => d.id === id)?.zh ?? { work: "工作中", focus: "专注", meet: "会议中", rest: "休息", busy: "忙碌", off: "已收工" }[id] ?? id; }
  private markStatus(status: string) {
    const now = Date.now();
    const last = this.segs[this.segs.length - 1];
    if (last && !last.end) last.end = now;
    this.segs.push({ status, start: now });
    if (this.segs.length > 96) this.segs.shift();
    if (status === "off") this.offDay = this.dayKey();
    this.segDirty = true; this.segDirtyAt = now;
  }
  private pushSegments() {
    this.segDirty = false;
    this.emit({ type: "segments", phase: "begin" });
    for (const s of this.segs) this.emit({ type: "seg", status: s.status, start: s.start, ...(s.end !== undefined && { end: s.end }) });
    this.emit({ type: "segments", phase: "end" });
  }
  private fireOffworkTodos() {
    const fired = this.todos.filter((t) => !t.done && t.trig === "offwork");
    if (!fired.length) return;
    fired.forEach((t) => { t.done = true; });
    this.emit({ type: "todoFired", ids: fired.map((t) => t.id), count: fired.length });
    this.reportTodos();
  }
  private dayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  private schedBodyBad(m: HttpMessage, d: Json): boolean {
    const k = d.kind;
    if (k !== "repeat" && k !== "date") { this.bad(m, "kind must be repeat or date"); return true; }
    if (!Array.isArray(d.ns)) { this.bad(m, "ns must be an array"); return true; }
    if (typeof d.name !== "string") { this.bad(m, "name is required"); return true; }
    if (k === "date" && typeof d.date !== "string") { this.bad(m, "date is required for kind=date"); return true; }
    return false;
  }
  private schedSet(id: string, d: Json) {
    const sc: DevSched = { id, name: d.name as string, kind: d.kind as "repeat" | "date", wd: d.kind === "repeat" ? (d.wd as number[] | undefined) : undefined, date: d.kind === "date" ? (d.date as string | undefined) : undefined, ns: [...((d.ns as DevSched["ns"]) ?? [])].sort((a, b) => a.t.localeCompare(b.t)) };
    const i = this.scheds.findIndex((x) => x.id === id);
    if (i >= 0) this.scheds[i] = sc; else this.scheds.push(sc);
    this.schedLastMin = -1;
  }
  private effSched(): DevSched | undefined {
    const today = this.dayKey(), wd = new Date().getDay();
    return this.scheds.find((s) => s.kind === "date" && s.date === today && s.ns.length)
      ?? this.scheds.find((s) => s.kind === "repeat" && s.id === this.schedAct && (s.wd ?? []).includes(wd));
  }
  private schedManual(status: string) {
    const sc = this.effSched();
    if (!sc) return;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const exp = [...sc.ns].reverse().find((n) => +n.t.slice(0, 2) * 60 + +n.t.slice(3) <= nowMin);
    if (exp && exp.st === status) return;
    if (this.schedMode === "today") this.schedPausedDay = this.dayKey();
    else this.schedHold = true;
    this.reportSchedules();
  }

  // ---- 周期任务（pollSchedule + pollTodos + breakAccum + segDirty 推送） ----
  private poll() {
    const now = Date.now();
    // 待办到点
    const fired = this.todos.filter((t) => !t.done && t.trig !== "offwork" && t.at !== undefined && t.at <= now);
    if (fired.length) { fired.forEach((t) => { t.done = true; }); this.emit({ type: "todoFired", ids: fired.map((t) => t.id), count: fired.length }); this.reportTodos(); }
    // 休息提醒累计（工作类状态才计）
    const dt = now - this.breakLastMs; this.breakLastMs = now;
    const workLike = this.cur.status === "work" || this.cur.status === "focus" || this.cur.status === "meet" || !!this.stdefs.find((d) => d.id === this.cur.status)?.work;
    if (this.breakEnabled && !this.breakOffToday && workLike) {
      this.breakAccumMs += dt;
      if (!this.breakDueSent && this.breakAccumMs >= this.breakMin * 60_000) { this.breakDueSent = true; this.emit(this.breakSnap(true)); }
    }
    // 计划表节点
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    if (this.timeSynced && nowMin !== this.schedLastMin) {
      const sc = this.effSched();
      if (sc) {
        const prevMin = this.schedLastMin; this.schedLastMin = nowMin;
        if (prevMin >= 0 && this.schedHold)
          for (const n of sc.ns) { const m = +n.t.slice(0, 2) * 60 + +n.t.slice(3); if (m > prevMin && m <= nowMin) { this.schedHold = false; break; } }
        if (this.schedPausedDay !== this.dayKey() && !this.schedHold && this.offDay !== this.dayKey()) {
          const exp = [...sc.ns].reverse().find((n) => +n.t.slice(0, 2) * 60 + +n.t.slice(3) <= nowMin);
          if (exp && exp.st !== this.cur.status) { this.markStatus(exp.st); this.cur = { ...this.cur, status: exp.st }; this.emit({ type: "state", ...this.cur }); }
        }
      }
    }
    // 区间合并推送（变化 ~2s 内合并一次）
    if (this.segDirty && this.timeSynced && now - this.segDirtyAt > 1500) this.pushSegments();
  }
  private beat() {
    this.emit(this.breakSnap(false));                                  // 10s 心跳兼链路活性
    this.emit({ type: "wantTime" });
    if (this.shareEn) this.emit(this.peersSnap());
  }
  private peerTick() {
    this.peerStIdx = (this.peerStIdx + 1) % 5;
    if (this.shareEn) this.emit(this.peersSnap());
  }

  // ---- 录音（与固件相同的 IMA-ADPCM 帧流） ----
  private stt(on: boolean) {
    if (on) {
      if (this.sttTimer) return;
      this.sttStart = Date.now(); this.sttSeq = 0; this.sttEnc = { pred: 0, idx: 0 };
      this.emit({ type: "sttState", state: "recording", rate: 16000, codec: "adpcm", ms: 0 });
      let off = 0;
      const CHUNK = 234, BATCH = 8, RATE = 16000;
      this.sttTimer = setInterval(() => {
        for (let k = 0; k < BATCH; k++) {
          const pcm = new Int16Array(CHUNK);
          for (let i = 0; i < CHUNK; i++) {
            const t = ((off + i) % (RATE * 2)) / RATE;
            pcm[i] = Math.round(8000 * Math.sin(2 * Math.PI * (300 + 200 * t) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)));
          }
          off += CHUNK;
          this.emit({ type: "aud", seq: this.sttSeq++, data: u8ToB64(pcmToAdpcmFrame(pcm, this.sttEnc)) });
          if (Date.now() - this.sttStart > 60000) { this.stt(false); break; }
        }
      }, 120);
    } else {
      if (this.sttTimer) { clearInterval(this.sttTimer); this.sttTimer = undefined; }
      if (this.sttStart) this.emit({ type: "sttState", state: "idle", rate: 16000, codec: "adpcm", ms: Date.now() - this.sttStart });
      this.sttStart = 0;
    }
  }

  // ---- agent 循环 ----
  private agentStart(text: string) {
    this.agentMsgs = [
      { role: "system", content: "你是桌面状态牌「收工牌」上的语音助手。当前本地时间 15:26，当前状态「工作中」。" },
      { role: "user", content: text },
    ];
    this.agentRound = 0;
    this.emitAgentReq();
  }
  private emitAgentReq() {
    this.emit({
      type: "agentReq",
      round: this.agentRound,
      msgs: this.agentMsgs,
      tools: [{ type: "function", function: { name: "reminder_add", description: "创建设备上的到点提醒", parameters: { type: "object", properties: { text: { type: "string" }, at_time: { type: "string" } }, required: ["text"] } } }],
    });
  }
  private agentTurn(message: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }) {
    this.agentMsgs.push(message as never);
    const tcs = message.tool_calls;
    if (tcs?.length) {
      for (const tc of tcs) {
        let res = "{}";
        if (tc.function.name === "reminder_add") {
          try {
            const a = JSON.parse(tc.function.arguments || "{}");
            let at: number | undefined;
            const mm = /^(\d{1,2}):(\d{2})$/.exec(String(a.at_time || a.time || ""));
            if (typeof a.in_minutes === "number") at = Date.now() + a.in_minutes * 60000;
            else if (mm) {
              const d = new Date(); d.setHours(+mm[1], +mm[2], 0, 0);
              if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
              at = d.getTime();
            }
            this.todos.push({ id: `t${this.nextId++}`, at, text: String(a.text || "提醒"), show: true, src: "voice", created: Date.now(), done: false });
            res = `{"ok":true,"id":"t${this.nextId - 1}"${at ? `,"at":${at}` : ""}}`;
          } catch { res = `{"ok":false,"err":"bad_args"}`; }
        } else res = `{"ok":false,"err":"unknown_tool"}`;
        this.agentMsgs.push({ role: "tool", tool_call_id: tc.id, content: res });
      }
      this.reportTodos();
      if (++this.agentRound < 4) this.emitAgentReq();
      else { this.emit({ type: "agentDone", text: "（步骤较多，已执行完最后一轮工具）" }); this.agentMsgs = []; }
      return;
    }
    this.emit({ type: "agentDone", text: message.content || "" });
    this.agentMsgs = [];
  }
}
