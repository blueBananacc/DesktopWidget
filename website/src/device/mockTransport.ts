import type { DevSched, DevStdef, DeviceTodo, DeviceTransport, InboundMessage, OutboundMessage } from "./protocol";
import { b64ToU8, u8ToB64 } from "./app";
import { pcmToAdpcmFrame } from "./audio";

/** 没有硬件时使用的模拟设备：模拟连接延迟，并可在“我的设备”页手动触发设备端事件 */
export class MockTransport implements DeviceTransport {
  readonly kind = "mock" as const;
  private msgCb?: (m: InboundMessage) => void;
  private discCb?: () => void;
  lastState?: OutboundMessage;
  /** 模拟设备 LittleFS 里的自定义屏幕：与固件一样在 run/clear/list 后上报 apps */
  private apps = new Map<string, string>(); // status -> b64
  private upload?: { status: string; size: number; parts: string[] };
  private sttTimer?: ReturnType<typeof setInterval>;
  private sttStart = 0;
  private sttSeq = 0;
  private sttEnc = { pred: 0, idx: 0 };
  /** 模拟设备端 agent 循环与待办存储（与固件行为对齐：sttResult → agentReq ↔ agentRes → agentDone/todos） */
  private agentTodos: DeviceTodo[] = [];
  private agentMsgs: { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string }[] = [];
  private agentRound = 0;
  private agentNextId = 1;
  /** 模拟设备 /schedules.json：计划表清单事实源（与固件 v0.8 对齐） */
  private scheds: DevSched[] = [];
  private schedAct = "";
  private schedMode: "next" | "today" = "next";
  private schedPausedDay = "";   // dateKey：暂停只影响当天
  private schedHold = false;     // mode=next 手动干预挂起
  private schedNextId = 1;
  private schedLastMin = -1;
  private offDay = "";           // 进入 off 的日期：当天后续节点作废
  private segs: { status: string; start: number; end?: number }[] = [];
  /** 模拟设备 /stdefs.json：自定义状态注册表事实源（与固件 v0.9 对齐） */
  private stdefs: DevStdef[] = [];
  private stdefNextId = 1;
  /** 模拟设备 /keys.json + /led.json：按键映射与灯效设置事实源（v1.0 起） */
  private keyActs: [string, string, string, string, string] = ["offwork", "busy", "cycleL", "cycleR", "rest"];
  private ledMap: Record<string, "solid" | "breath" | "off"> = {};
  private ledBr = 40;
  private ledNight = false;
  /** 模拟设备 /knob.json + 快速定时（与固件对齐：计时本体在"设备"侧自治，网页只收镜像） */
  private knobStep = 5;
  private knobMax = 180;
  private timerTimeout?: ReturnType<typeof setTimeout>;
  /** 模拟设备 /share.json + ESP-NOW 成员表：一个假想的同区域同伴周期性广播状态（与固件网关转发对齐） */
  private shareEn = false;
  private shareName = "";
  private shareZone = "default";
  private peerStIdx = 0;
  private peerTimer?: ReturnType<typeof setInterval>;

  async connect() {
    await new Promise((r) => setTimeout(r, 600));
    try { this.agentTodos = JSON.parse(localStorage.getItem("sgp-mock-todos") || "[]"); } catch { this.agentTodos = []; } // 模拟设备持久化：刷新=新 MockTransport 实例，待办靠 localStorage 保持"设备事实源"语义
    try {
      const j = JSON.parse(localStorage.getItem("sgp-mock-scheds") || "null");
      if (j) { this.scheds = j.list ?? []; this.schedAct = j.act ?? ""; this.schedMode = j.mode ?? "next"; this.schedPausedDay = j.pday ?? ""; this.schedNextId = j.nextId ?? 1; }
    } catch { /* 空 */ }
    try {
      const j = JSON.parse(localStorage.getItem("sgp-mock-stdefs") || "null");
      if (j) { this.stdefs = j.list ?? []; this.stdefNextId = j.nextId ?? 1; }
    } catch { /* 空 */ }
    try {
      const j = JSON.parse(localStorage.getItem("sgp-mock-keys") || "null");
      if (j) this.keyActs = [j.k1 ?? "offwork", j.k2 ?? "busy", j.k3 ?? "cycleL", j.k4 ?? "cycleR", j.t ?? "rest"];
    } catch { /* 空 */ }
    try {
      const j = JSON.parse(localStorage.getItem("sgp-mock-led") || "null");
      if (j) { this.ledMap = j.map ?? {}; this.ledBr = j.br ?? 40; this.ledNight = !!j.night; }
      // j.map 已是 LedMode 字典（sgp-mock-led 由 reportLed 写入）
    } catch { /* 空 */ }
    try {
      const j = JSON.parse(localStorage.getItem("sgp-mock-knob") || "null");
      if (j) { this.knobStep = j.step ?? 5; this.knobMax = j.max ?? 180; }
    } catch { /* 空 */ }
    try {
      const j = JSON.parse(localStorage.getItem("sgp-mock-share") || "null");
      if (j) { this.shareEn = !!j.en; this.shareName = j.name ?? ""; this.shareZone = j.zone ?? "default"; }
    } catch { /* 空 */ }
    setTimeout(() => this.reportApps(), 700);
    setTimeout(() => this.reportTodos(), 750); // 与固件 hello→sendTodos 对齐：连接即同步设备待办
    setTimeout(() => this.reportSchedules(), 800); // hello→sendSchedules：计划表清单事实源
    setTimeout(() => this.reportStdefs(), 850);  // hello→sendStdefs：自定义状态注册表事实源
    setTimeout(() => this.reportKeys(), 880);    // hello→sendKeys：按键映射事实源
    setTimeout(() => this.reportLed(), 900);     // hello→sendLed：灯效设置事实源
    setTimeout(() => this.reportKnobCfg(), 920); // hello→sendTimerCfg/sendTimer：旋钮定时事实源
    setTimeout(() => { this.reportShare(); this.reportPeers(); }, 950); // hello→sendShare/sendPeers：分享设置+成员表事实源
    this.todoTimer = setInterval(() => { this.pollTodos(); this.pollSchedule(); }, 1000); // 模拟固件 pollTodos+pollSchedule
    this.peerTimer = setInterval(() => this.peerTick(), 8000);           // 模拟同区域同伴周期性 ESP-NOW 广播
    return "收工牌-A12（模拟）";
  }
  async disconnect() {
    if (this.sttTimer) clearInterval(this.sttTimer);
    if (this.todoTimer) clearInterval(this.todoTimer);
    if (this.peerTimer) clearInterval(this.peerTimer);
    this.discCb?.();
  }
  async send(msg: OutboundMessage) {
    await new Promise((r) => setTimeout(r, msg.type === "app" && msg.op === "chunk" ? 30 : 120));
    if (msg.type === "state") {
      const wasOff = this.lastState?.type === "state" && this.lastState.status === "off";
      this.lastState = msg;
      if (msg.status === "off" && !wasOff) this.fireOffworkTodos(); // 模拟固件 markStatus 的 off 沿
      if (!wasOff && msg.status !== "off") this.schedManual(msg.status); // 手动切状态 → mode 挂起/暂停
    }
    if (msg.type === "stt") { this.stt(msg.op === "start"); return; }
    if (msg.type === "sttResult") { this.agentStart(msg.text); return; }
    if (msg.type === "agentRes") { this.agentTurn(msg.message); return; }
    if (msg.type === "agent" && msg.op === "cancel") { this.agentMsgs = []; return; }
    if (msg.type === "todo") { this.todoOp(msg); return; }
    if (msg.type === "sched") { this.schedOp(msg); return; }
    if (msg.type === "stdef") { this.stdefOp(msg); return; }
    if (msg.type === "keys") {
      // 与固件一致：K1–K4 中必须含一个 offwork，否则拒绝写入
      const next: [string, string, string, string, string] = [msg.k1, msg.k2, msg.k3, msg.k4, msg.t ?? this.keyActs[4]];
      if (next.slice(0, 4).includes("offwork")) this.keyActs = next;
      this.reportKeys();
      return;
    }
    if (msg.type === "led") {
      if (msg.op === "set") {
        if (msg.map) this.ledMap = { ...this.ledMap, ...msg.map };
        if (msg.br !== undefined) this.ledBr = msg.br;
        if (msg.night !== undefined) this.ledNight = msg.night;
      }
      this.reportLed();
      return;
    }
    if (msg.type === "timerCfg") {
      this.knobStep = Math.min(30, Math.max(1, msg.step));
      this.knobMax = Math.min(600, Math.max(this.knobStep, msg.max));
      this.reportKnobCfg();
      return;
    }
    if (msg.type === "timer") {
      // 与固件一致：计时本体在"设备"侧自治——start 后由这里到点发 done，网页不参与计时
      if (msg.op === "start") {
        const minutes = Math.min(this.knobMax, Math.max(this.knobStep, msg.minutes));
        const remain = minutes * 60_000;
        this.msgCb?.({ type: "timer", st: "run", minutes, remain });
        if (this.timerTimeout) clearTimeout(this.timerTimeout);
        this.timerTimeout = setTimeout(() => this.msgCb?.({ type: "timer", st: "done", minutes }), remain);
      } else if (msg.op === "cancel") {
        if (this.timerTimeout) { clearTimeout(this.timerTimeout); this.timerTimeout = undefined; }
        this.msgCb?.({ type: "timer", st: "idle" });
      }
      return;
    }
    if (msg.type === "share") {
      // 与固件一致：en/name/zone 写入设备持久存储后回 share 快照
      if (msg.en !== undefined) this.shareEn = msg.en;
      if (msg.name !== undefined && msg.name.length) this.shareName = msg.name;
      if (msg.zone !== undefined && msg.zone.length) this.shareZone = msg.zone;
      this.reportShare();
      return;
    }
    if (msg.type !== "app") return;
    if (msg.op === "begin") this.upload = { status: msg.status, size: msg.size, parts: [] };
    else if (msg.op === "chunk") this.upload?.parts.push(msg.data);
    else if (msg.op === "run" && this.upload) { this.apps.set(this.upload.status, this.upload.parts.join("")); this.upload = undefined; this.reportApps(); }
    else if (msg.op === "clear") { this.apps.delete(msg.status); this.reportApps(); }
    else if (msg.op === "list") this.reportApps();
    else if (msg.op === "dump") {
      const b64 = this.apps.get(msg.status);
      this.msgCb?.(b64 === undefined
        ? { type: "appData", status: msg.status, last: true, missing: true }
        : { type: "appData", status: msg.status, seq: 0, last: true, data: b64 });
    }
  }
  /** 模拟设备录音：start 后按 ~67 帧/秒上行 2s 循环扫频音（与固件相同的 IMA-ADPCM 帧格式） */
  private stt(on: boolean) {
    if (on) {
      if (this.sttTimer) return;
      this.sttStart = Date.now(); this.sttSeq = 0; this.sttEnc = { pred: 0, idx: 0 };
      this.msgCb?.({ type: "sttState", state: "recording", rate: 16000, codec: "adpcm", ms: 0 });
      let off = 0;
      const CHUNK = 234, BATCH = 8, RATE = 16000;
      this.sttTimer = setInterval(() => {
        for (let k = 0; k < BATCH; k++) {
          const pcm = new Int16Array(CHUNK);
          for (let i = 0; i < CHUNK; i++) {
            const t = ((off + i) % (RATE * 2)) / RATE;                     // 2s 循环扫频 300→500Hz
            pcm[i] = Math.round(8000 * Math.sin(2 * Math.PI * (300 + 200 * t) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)));
          }
          off += CHUNK;
          this.msgCb?.({ type: "aud", seq: this.sttSeq++, data: u8ToB64(pcmToAdpcmFrame(pcm, this.sttEnc)) });
          if (Date.now() - this.sttStart > 60000) { this.stt(false); break; }
        }
      }, 120);
    } else {
      if (this.sttTimer) { clearInterval(this.sttTimer); this.sttTimer = undefined; }
      if (this.sttStart) this.msgCb?.({ type: "sttState", state: "idle", rate: 16000, codec: "adpcm", ms: Date.now() - this.sttStart });
      this.sttStart = 0;
    }
  }
  private reportApps() {
    this.msgCb?.({ type: "apps", list: [...this.apps].map(([status, b64]) => ({ status, size: b64ToU8(b64).length })) });
  }
  private reportTodos() {
    localStorage.setItem("sgp-mock-todos", JSON.stringify(this.agentTodos));
    this.msgCb?.({ type: "todos", list: this.agentTodos.map((t) => ({ ...t })) });
  }
  private todoTimer?: ReturnType<typeof setInterval>;
  private todoOp(msg: Extract<OutboundMessage, { type: "todo" }>) {
    if (msg.op === "add") this.agentTodos.push({ id: `t${this.agentNextId++}`, at: msg.at, trig: msg.trig, text: msg.text, show: msg.show, src: msg.src, created: Date.now(), done: false });
    else if (msg.op === "set") this.agentTodos = this.agentTodos.map((t) => (t.id === msg.id ? { ...t, ...(msg.text !== undefined && { text: msg.text }), ...(msg.at !== undefined && { at: msg.at < 0 ? undefined : msg.at }), ...(msg.trig !== undefined && { trig: msg.trig === "offwork" ? "offwork" : undefined }), ...(msg.show !== undefined && { show: msg.show }), ...(msg.done !== undefined && { done: msg.done }) } : t));
    else if (msg.op === "done") this.agentTodos = this.agentTodos.map((t) => (t.id === msg.id ? { ...t, done: msg.done ?? true } : t));
    else if (msg.op === "del") this.agentTodos = this.agentTodos.filter((t) => t.id !== msg.id);
    else if (msg.op === "clear") this.agentTodos = [];
    this.reportTodos();
  }
  /** 模拟固件 fireOffworkTodos：收工触发待办 → done + todoFired + todos 推送 */
  private fireOffworkTodos() {
    const fired = this.agentTodos.filter((t) => !t.done && t.trig === "offwork");
    if (!fired.length) return;
    fired.forEach((t) => { t.done = true; });
    this.msgCb?.({ type: "todoFired", ids: fired.map((t) => t.id), count: fired.length });
    this.reportTodos();
  }
  /** 模拟固件 pollTodos：定时待办到点 → done + todoFired + todos 推送 */
  private pollTodos() {
    const now = Date.now();
    const fired = this.agentTodos.filter((t) => !t.done && t.trig !== "offwork" && t.at !== undefined && t.at <= now);
    if (!fired.length) return;
    fired.forEach((t) => { t.done = true; });
    this.msgCb?.({ type: "todoFired", ids: fired.map((t) => t.id), count: fired.length });
    this.reportTodos();
  }
  // ---- 计划表（与固件 /schedules.json 对齐：清单+act+mode+暂停日，自治执行） ----
  private dayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  private reportSchedules() {
    localStorage.setItem("sgp-mock-scheds", JSON.stringify({ list: this.scheds, act: this.schedAct, mode: this.schedMode, pday: this.schedPausedDay, nextId: this.schedNextId }));
    this.msgCb?.({ type: "schedules", act: this.schedAct, paused: this.schedPausedDay === this.dayKey(), mode: this.schedMode, list: this.scheds.map((s) => ({ ...s, ns: s.ns.map((n) => ({ ...n })) })) });
  }
  private schedOp(msg: Extract<OutboundMessage, { type: "sched" }>) {
    if (msg.op === "set") {
      const id = msg.id ?? `s${this.schedNextId++}`;
      const sc: DevSched = { id, name: msg.name, kind: msg.kind, wd: msg.kind === "repeat" ? msg.wd : undefined, date: msg.kind === "date" ? msg.date : undefined, ns: [...(msg.ns ?? [])].sort((a, b) => a.t.localeCompare(b.t)) };
      const i = this.scheds.findIndex((x) => x.id === id);
      if (i >= 0) this.scheds[i] = sc; else this.scheds.push(sc);
      this.schedLastMin = -1;
    } else if (msg.op === "del") {
      const victim = this.scheds.find((x) => x.id === msg.id);
      if (victim && victim.id === this.schedAct) this.schedAct = "";
      this.scheds = this.scheds.filter((x) => x.id !== msg.id);
    } else if (msg.op === "use") {
      const sc = this.scheds.find((x) => x.id === msg.id && x.kind === "repeat");
      if (sc) { this.schedAct = msg.id; this.schedLastMin = -1; }
    } else if (msg.op === "pause") {
      this.schedPausedDay = msg.paused ? this.dayKey() : "";
      this.schedLastMin = -1;
    } else if (msg.op === "mode") {
      this.schedMode = msg.mode;
    }
    if (msg.op !== "list") this.schedLastMin = -1;
    this.reportSchedules();
  }
  /** 固件 effSched：date==今天优先，其次启用表按星期位 */
  private effSched(): DevSched | undefined {
    const today = this.dayKey(), wd = new Date().getDay();
    return this.scheds.find((s) => s.kind === "date" && s.date === today && s.ns.length)
      ?? this.scheds.find((s) => s.kind === "repeat" && s.id === this.schedAct && (s.wd ?? []).includes(wd));
  }
  /** 固件 registerManualOverride：手动切状态与应处不同 → mode=today 暂停 / mode=next 挂起 */
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
  // ---- 自定义状态注册表（与固件 /stdefs.json 对齐） ----
  private reportStdefs() {
    localStorage.setItem("sgp-mock-stdefs", JSON.stringify({ list: this.stdefs, nextId: this.stdefNextId }));
    this.msgCb?.({ type: "stdefs", list: this.stdefs.map((d) => ({ ...d })) });
  }
  private stdefOp(msg: Extract<OutboundMessage, { type: "stdef" }>) {
    if (msg.op === "set") {
      const id = msg.id ?? `c${this.stdefNextId++}`;
      const d: DevStdef = { id, zh: msg.zh, hint: msg.hint, c: msg.c, work: msg.work };
      const i = this.stdefs.findIndex((x) => x.id === id);
      if (i >= 0) this.stdefs[i] = d;
      else if (this.stdefs.length < 8) this.stdefs.push(d);
      else { this.msgCb?.({ type: "stdefErr", msg: "full" }); return; }
    } else if (msg.op === "del") {
      this.stdefs = this.stdefs.filter((x) => x.id !== msg.id);
      this.apps.delete(msg.id);            // 与固件一致：连带删除该状态的自定义屏幕
      this.reportApps();
    }
    this.reportStdefs();
  }
  // ---- 按键映射 / 灯效（与固件 /keys.json /led.json 对齐） ----
  private reportKeys() {
    const [k1, k2, k3, k4, t] = this.keyActs;
    localStorage.setItem("sgp-mock-keys", JSON.stringify({ k1, k2, k3, k4, t }));
    this.msgCb?.({ type: "keys", k1, k2, k3, k4, t });
  }
  private reportLed() {
    localStorage.setItem("sgp-mock-led", JSON.stringify({ map: this.ledMap, br: this.ledBr, night: this.ledNight }));
    this.msgCb?.({ type: "led", map: { ...this.ledMap }, br: this.ledBr, night: this.ledNight });
  }
  private reportKnobCfg() {
    localStorage.setItem("sgp-mock-knob", JSON.stringify({ step: this.knobStep, max: this.knobMax }));
    this.msgCb?.({ type: "timerCfg", step: this.knobStep, max: this.knobMax });
    this.msgCb?.({ type: "timer", st: "idle" });
  }
  // ---- 共享看板（与固件 /share.json + ESP-NOW 成员表对齐） ----
  private reportShare() {
    localStorage.setItem("sgp-mock-share", JSON.stringify({ en: this.shareEn, name: this.shareName, zone: this.shareZone }));
    this.msgCb?.({ type: "share", en: this.shareEn, name: this.shareName, zone: this.shareZone });
  }
  /** 模拟 ESP-NOW 收到的同伴广播 → 网关转发 peers 快照（同伴状态每 8s 轮换一次） */
  private peerTick() {
    const sts = ["work", "focus", "meet", "busy", "rest"] as const;
    this.peerStIdx = (this.peerStIdx + 1) % sts.length;
    this.reportPeers();
  }
  private reportPeers() {
    const sts = ["work", "focus", "meet", "busy", "rest"] as const;
    this.msgCb?.({ type: "peers", list: [{ i: "34:B7", n: "工位旁的小王", st: sts[this.peerStIdx], at: Date.now() }] });
  }
  /** 固件 markStatus→sendSegments：模拟设备端状态切换（自治触发）→ 区间推送 */
  private markStatus(status: string) {
    const now = Date.now();
    const last = this.segs[this.segs.length - 1];
    if (last && !last.end) last.end = now;
    this.segs.push({ status, start: now });
    if (this.segs.length > 96) this.segs.shift();
    if (status === "off") { this.offDay = this.dayKey(); this.fireOffworkTodos(); }
    this.msgCb?.({ type: "segments", phase: "begin" });
    for (const s of this.segs) this.msgCb?.({ type: "seg", status: s.status as never, start: s.start, end: s.end });
    this.msgCb?.({ type: "segments", phase: "end" });
  }
  /** 固件 pollSchedule：每分钟评估应处节点 → 暂停/挂起/已收工则跳过 */
  private pollSchedule() {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    if (nowMin === this.schedLastMin) return;
    const sc = this.effSched();
    if (!sc) return;
    const prevMin = this.schedLastMin; this.schedLastMin = nowMin;
    if (prevMin >= 0 && this.schedHold)
      for (const n of sc.ns) { const m = +n.t.slice(0, 2) * 60 + +n.t.slice(3); if (m > prevMin && m <= nowMin) { this.schedHold = false; break; } }
    if (this.schedPausedDay === this.dayKey() || this.schedHold) return;
    if (this.offDay === this.dayKey()) return;                 // 今天已收工：节点作废
    const exp = [...sc.ns].reverse().find((n) => +n.t.slice(0, 2) * 60 + +n.t.slice(3) <= nowMin);
    if (!exp) return;
    const cur = this.segs.length ? this.segs[this.segs.length - 1].status : (this.lastState?.type === "state" ? this.lastState.status : "work");
    if (exp.st !== cur) this.markStatus(exp.st);
  }

  /** 模拟固件的 agent 循环：sttResult 进 → agentReq 出（含伪 system+user 消息与设备工具 schema） */
  private agentStart(text: string) {
    this.agentMsgs = [
      { role: "system", content: "你是桌面状态牌「收工牌」上的语音助手。当前本地时间 15:26，当前状态「工作中」。" },
      { role: "user", content: text },
    ];
    this.agentRound = 0;
    this.emitAgentReq();
  }
  private emitAgentReq() {
    this.msgCb?.({
      type: "agentReq",
      round: this.agentRound,
      msgs: this.agentMsgs as never,
      tools: [{ type: "function", function: { name: "reminder_add", description: "创建设备上的到点提醒", parameters: { type: "object", properties: { text: { type: "string" }, at_time: { type: "string" } }, required: ["text"] } } }],
    });
  }
  /** assistant 消息回：有 tool_calls → 模拟执行并再来一轮；纯文本 → agentDone 收尾 */
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
            const m = /^(\d{1,2}):(\d{2})$/.exec(String(a.at_time || a.time || ""));
            if (typeof a.in_minutes === "number") at = Date.now() + a.in_minutes * 60000;
            else if (m) { // 与固件一致：HH:MM → 今日该时刻，已过则顺延到明天
              const d = new Date(); d.setHours(+m[1], +m[2], 0, 0);
              if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
              at = d.getTime();
            }
            this.agentTodos.push({ id: `t${this.agentNextId++}`, at, text: String(a.text || "提醒"), show: true, src: "voice", created: Date.now(), done: false });
            res = `{"ok":true,"id":"t${this.agentNextId - 1}"${at ? `,"at":${at}` : ""}}`;
          } catch { res = `{"ok":false,"err":"bad_args"}`; }
        } else res = `{"ok":false,"err":"unknown_tool"}`;
        this.agentMsgs.push({ role: "tool", tool_call_id: tc.id, content: res });
      }
      this.reportTodos();
      if (++this.agentRound < 4) this.emitAgentReq();
      else this.msgCb?.({ type: "agentDone", text: "（步骤较多，已执行完最后一轮工具）" });
      return;
    }
    const reply = message.content || "";
    this.msgCb?.({ type: "agentDone", text: reply });
    this.agentMsgs = [];
  }
  onMessage(cb: (m: InboundMessage) => void) {
    this.msgCb = cb;
  }
  onDisconnect(cb: () => void) {
    this.discCb = cb;
  }
  /** 模拟设备端操作 */
  emit(msg: InboundMessage) {
    this.msgCb?.(msg);
  }
  /** 模拟信号中断 */
  drop() {
    this.discCb?.();
  }
}
