import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AgentState, CurrentStatus, CustomStatusDef, DeviceInfo, KeyAction, KeyMap, Member, Reminder, Schedule, Settings, StatusId, StatusSegment, StatusSource,
} from "../domain/types";
import { allStatusIds, cacheStatusNames, loadStatusNameCache, setCustomStatusDefs, statusMeta, statusNameCache } from "../domain/statuses";
import { atToday, dateKey, hhmm, startOfDay, uid } from "../domain/time";
import { lastDays, totalsForSegments } from "../domain/review";
import { defaultSettings, seedMembers, seedReminders } from "./seed";
import type { AgentMessage, DevSched, DevStdef, DeviceTodo, DeviceTransport, InboundMessage, OutboundMessage } from "../device/protocol";
import { MockTransport } from "../device/mockTransport";
import { BleTransport } from "../device/bleTransport";
import { SerialTransport } from "../device/serialTransport";
import { b64ToU8, hashBytes, pendingClears, setDeployedHash, setPendingClears } from "../device/app";
import { callLlm, loadLlmCfg, llmErrText } from "../device/llm";

const STORAGE_KEY = "shougongpai.v1";
/** 本机保留的历史天数（含今天），超出的在跨天时清理 */
export const HISTORY_DAYS = 90;

/** 由 Provider 注册：向已连接设备发送一条消息（未连接时为空操作） */
let deviceSend: ((m: OutboundMessage) => void) | undefined;
let activeTransport: DeviceTransport | undefined;
/** 已连接传输的句柄：动效上传等需要按序 await 的场景使用（deviceSend 是 fire-and-forget） */
export const getTransport = () => activeTransport;
/** 已发出但设备尚未回执一致的休息提醒设置；发送可能撞上设备重启窗口而丢失，靠 breakState 回执重发收敛 */
let breakPending: { minutes?: number; enabled?: boolean; offToday?: boolean } | undefined;
/** 设备逐行推送的今日状态区间：begin 清空、seg 累积、end 一次性替换 */
let pendingSegs: { status: StatusId; start: number; end?: number }[] = [];
/** app dump 读回分片累积器 */
let appDumpAcc: { status: string; parts: string[] } = { status: "", parts: [] };
/** 最近一次收到设备上行消息的时刻：真实传输 15s 无消息即判死（串口假连接——设备断电但端口仍可打开） */
let lastInboundAt = 0;
/** 计划表/自定义状态：事实源在设备（网页仅镜像 + 下发 ops），快照整表替换 */
const schedSetMsg = (sc: Schedule): Extract<OutboundMessage, { type: "sched" }> => ({
  type: "sched", op: "set", id: sc.id, name: sc.name, kind: sc.kind,
  wd: sc.kind === "repeat" ? sc.weekdays : undefined,
  date: sc.kind === "date" ? sc.date : undefined,
  ns: sc.nodes.map((n) => ({ t: n.time, st: n.status, ...(n.note ? { n: n.note } : {}) })),
});
const schedToMirror = (x: DevSched): Schedule => ({
  id: x.id, name: x.name, kind: x.kind,
  weekdays: x.kind === "repeat" ? x.wd ?? [] : [],
  date: x.kind === "date" ? x.date : undefined,
  nodes: (x.ns ?? []).map((n) => ({ id: uid(), time: n.t, status: n.st, note: n.n })),
});
const stdefToMirror = (d: DevStdef): CustomStatusDef => ({
  id: d.id, name: d.zh, hint: d.hint,
  color: `#${(d.c ?? 0x8899aa).toString(16).padStart(6, "0")}`,
  workLike: !!d.work,
});
const sendBreak = (patch: { minutes?: number; enabled?: boolean; offToday?: boolean; accumMs?: number }, s: AppState) => {
  const { accumMs, ...persistent } = patch;
  if (Object.keys(persistent).length) breakPending = { ...breakPending, ...persistent };
  deviceSend?.({
    type: "break",
    minutes: patch.minutes ?? s.settings.breakMinutes,
    enabled: patch.enabled ?? s.settings.breakEnabled,
    offToday: patch.offToday ?? s.breakOffToday,
    ...(accumMs !== undefined ? { accumMs } : {}),
  });
};

/** 设备 agent 循环的 LLM 代理：设备发 agentReq（消息+工具 schema）→ 网页调已配置 LLM → agentRes 回设备。
 *  设备是循环主体（断连/超时它自己收尾）；网页只转发并记错误便于 UI 提示。 */
const proxyAgentReq = async (m: Extract<InboundMessage, { type: "agentReq" }>, setErr?: (msg: string) => void) => {
  const t = activeTransport;
  if (!t) return;
  try {
    const cfg = loadLlmCfg();
    if (!cfg.key.trim()) throw new Error("未配置 LLM Key（语音转文字页 → LLM 服务商）");
    const j = await callLlm(cfg, m.msgs, { tools: m.tools as never, maxTokens: 400 });
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error("模型返回为空");
    await t.send({ type: "agentRes", message: msg });
  } catch (e) {
    const txt = llmErrText(e);
    setErr?.(txt);
    // 给设备一个终止回复，让循环正常收尾并在 OLED 上显示原因
    await t.send({ type: "agentRes", message: { role: "assistant", content: `（LLM 调用失败：${txt}）` } }).catch(() => {});
  }
};

export interface TimerState {
  endsAt: number;
  minutes: number;
  status: StatusId;
  expired?: boolean;
}

/** 设备旋钮快速定时的镜像（事实源在设备；网页只展示，不参与计时） */
export interface KnobTimerState {
  mode: "select" | "run" | "expired";
  minutes: number;
  endsAt?: number; // run：由设备 remain 换算的预计截止
}

export interface AppState {
  current: CurrentStatus;
  segments: StatusSegment[];
  history: Record<string, Partial<Record<StatusId, number>>>;
  /** 已归档日期的状态区间（今天的在 segments），用于回顾页查看某天详情 */
  historySegments: Record<string, StatusSegment[]>;
  /** 计划表镜像：事实源在设备 /schedules.json（schedules 快照整表替换）；断连只读、刷新清空等重推 */
  schedules: Schedule[];
  /** 当前生效的重复计划 id：设备执行态（schedules 快照 act 采纳） */
  activeScheduleId: string;
  day: string;
  pausedToday: boolean;
  offworkToday: boolean;
  lastAppliedNode?: string;
  reminders: Reminder[];
  /** 最近一次触发的提醒（UI 据此弹 toast） */
  reminderFlash?: { text: string; at: number; ids: string[] };
  /** "昨天遗留"演示数据是否已注入；持久化标记，删除后不再注入 */
  seededLeftover?: boolean;
  seededLeftover2?: boolean;
  members: Member[];
  /** 收到过真实 peers 快照后置真：看板不再显示演示成员 */
  membersLive?: boolean;
  settings: Settings;
  timer?: TimerState;
  /** 设备旋钮快速定时镜像：由 timer/timerCfg 上行消息驱动；断连显示为未知（不虚构剩余时间） */
  knobTimer?: KnobTimerState;
  breakAccumMs: number;   // 已同步时 = 设备上次上报的累计值；显示时按 breakSyncedAt 外推
  breakSyncedAt: number;  // 上次收到设备 breakState 的时刻；0 = 从未同步（离线模式，本地累计）
  breakDue: boolean;
  breakOffToday: boolean;
  agent: { state: AgentState; task: string; updatedAt: number };
  user: { name: string; team: string; zone: string };
  /** 待办事实源（设备 LittleFS 的 todos 推送）：agent/网页 todo 消息写入设备，网页只是视图 */
  deviceTodos: DeviceTodo[];
  /** 自定义状态镜像：事实源在设备 /stdefs.json（stdefs 快照整表替换）；断连只读、刷新清空等重推 */
  customStatuses: CustomStatusDef[];
  /** 见过的状态名/色缓存：定义删除后，历史回顾仍按原名字展示（历史是记录不随定义删除） */
  statusNameCache: Record<string, { name: string; color: string }>;
  /** 设备端 agent 循环状态（设备是循环主体，网页只是 LLM 代理） */
  deviceAgent: { busy: boolean; reply?: string; err?: string; at: number; startedAt?: number; round?: number; trace?: AgentMessage[] };
}

type Snapshot = Pick<AppState, "current" | "segments" | "offworkToday" | "timer">;

const createInitial = (now: number): AppState => {
  return {
    current: { id: "work", source: "manual", since: now, until: undefined },
    segments: [], // 今天的区间是设备事实：连接后由 seg 推送填充，网页不虚构记录
    history: {},
    historySegments: {},
    schedules: [],
    activeScheduleId: "",
    day: dateKey(now),
    pausedToday: false,
    offworkToday: false,
    lastAppliedNode: undefined,
    reminders: seedReminders(now),
    members: seedMembers(now),
    settings: defaultSettings,
    breakAccumMs: 13 * 60_000,
    breakSyncedAt: 0,
    breakDue: false,
    breakOffToday: false,
    agent: { state: "needsInput", task: "重构登录模块", updatedAt: now - 3 * 60_000 },
    user: { name: "阿杰", team: "3 楼设计组", zone: "3 楼设计组" },
    deviceTodos: [],
    customStatuses: [],
    statusNameCache: {},
    deviceAgent: { busy: false, at: 0 },
  };
};

const load = (now: number): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as AppState;
      // 旧版本字段迁移：touchLeft/touchRight/shortcut → keys.k3/k4/k2
      const legacy = saved.settings as Settings & { touchLeft?: StatusId; touchRight?: StatusId; shortcut?: KeyAction };
      const savedKeys = saved.settings.keys as Partial<KeyMap> | undefined;
      const keys: KeyMap = savedKeys
        ? { k1: "offwork", k2: "busy", k3: "cycleL", k4: "cycleR", t: "rest", ...savedKeys }
        : { k1: "offwork", k2: legacy.shortcut ?? "busy", k3: legacy.touchLeft ?? "cycleL", k4: legacy.touchRight ?? "cycleR", t: "rest" };
      // 名字缓存灌注册表：已删状态的历史仍能显示原名；自定义状态注册表只在连接后由设备 stdefs 快照填充
      loadStatusNameCache(saved.statusNameCache ?? {});
      setCustomStatusDefs([]);
      return {
        ...createInitial(now), ...saved, breakSyncedAt: 0, settings: { ...defaultSettings, ...saved.settings, keys,
          // 旧布局取值（large/withTime/minimal）固件从未实现：统一迁回固件真实支持的"完整"
          screenLayout: "full", // 布局选项已收敛为"状态+时间+说明"，旧存档里的 clock/status 归一化
          // customScreens 迁移：旧的 JS 帧动画源码（string）已废弃，只保留 ScreenDef 对象
          customScreens: Object.fromEntries(Object.entries(saved.settings?.customScreens ?? {}).filter(([, v]) => v && typeof v === "object" && ("src" in v || "b64" in v))),
          screenPresets: saved.settings?.screenPresets ?? [] },
        // 旧版本提醒没有归属日字段：按今天迁移；并一次性注入两条"昨天遗留"演示数据（标记持久化在状态里，幂等、删除后不再注入）
        reminders: [
          ...(saved.seededLeftover2
            ? []
            : [
                { id: "seed-leftover2-1", title: "给客户回电话", trigger: "time" as const, at: "14:20", day: dateKey(startOfDay(now) - 1), showOnDevice: false, createdBy: "manual" as const, done: false },
                { id: "seed-leftover2-2", title: "整理周报附件", trigger: "time" as const, at: "11:00", day: dateKey(startOfDay(now) - 1), showOnDevice: true, createdBy: "manual" as const, done: false },
              ]),
          ...(saved.reminders ?? []).map((r) => ({ ...r, day: r.day ?? dateKey(now) })),
        ],
        seededLeftover2: true,
        reminderFlash: undefined, // 只用于本次会话弹 toast，重新打开页面不重弹旧提醒
        // 设备镜像态不持久化：事实源在设备（连接后由 todos/schedules/stdefs/keys/led/agent* 消息重推），存档里的旧值是幽灵
        deviceTodos: [],
        deviceAgent: { busy: false, at: 0 },
        schedules: [],
        activeScheduleId: "",
        pausedToday: false,
        customStatuses: [],
      };
    }
  } catch {
    /* 数据损坏时回到初始数据 */
  }
  return createInitial(now);
};

/** 切换状态：关闭上一个区间，开启新区间并记录来源 */
const applyStatus = (s: AppState, id: StatusId, source: StatusSource, now: number, until?: number, note?: string): AppState => {
  const segments = s.segments.map((seg, i) => (i === s.segments.length - 1 && !seg.end ? { ...seg, end: now } : seg));
  segments.push({ status: id, source, start: now });
  return {
    ...s,
    current: { id, source, since: now, until, note },
    segments,
    timer: source === "timer" ? s.timer : undefined,
  };
};


const tick = (s: AppState, now: number): AppState => {
  let next = s;
  const today = dateKey(now);
  if (next.day !== today) {
    // 开放区间在午夜截断归档，新的一天从午夜续上当前状态
    const midnight = startOfDay(now);
    const closed = next.segments.map((seg) => (seg.end ? seg : { ...seg, end: Math.max(seg.start, midnight) }));
    const keep = new Set(lastDays(now, HISTORY_DAYS).map((d) => d.key));
    const prune = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k)));
    next = {
      ...next,
      history: prune({ ...next.history, [next.day]: totalsForSegments(closed, midnight) }),
      historySegments: prune({ ...next.historySegments, [next.day]: closed }),
      segments: [{ status: next.current.id, source: next.current.source, start: midnight }],
      day: today,
      pausedToday: false,
      offworkToday: false,
      breakOffToday: false,
      breakAccumMs: 0,
      breakSyncedAt: 0,
      breakDue: false,
      // 已完成的提醒跨天即清；待处理的留下，界面归入“昨天遗留”
      reminders: next.reminders.filter((r) => !r.done),
    };
  }

  // 计划节点由设备自治执行（网页不再做调度）：到点后设备切状态并推 segments，网页采纳
  // s.schedules 只是设备清单镜像（scheduleForDay 仅供页面显示"今天生效哪张"）

  // 待办提醒由设备自治触发（网页不再做调度）：到点/收工触发后设备推 todoFired + todos，AppShell 负责弹 toast

  if (next.timer && !next.timer.expired && now >= next.timer.endsAt) next = { ...next, timer: { ...next.timer, expired: true } };
  // 旋钮倒计时：到点消息丢了也能靠 endsAt 补一记过期镜像（不代替设备 done 消息，只兜底显示）
  if (next.knobTimer?.mode === "run" && next.knobTimer.endsAt && now >= next.knobTimer.endsAt)
    next = { ...next, knobTimer: { ...next.knobTimer, mode: "expired" } };

  const { settings } = next;
  // 本地累计只在从未同步过设备时启用（离线/模拟设备）；连接后设备是计时权威，网页只存快照外推
  if (settings.breakEnabled && !next.breakOffToday && statusMeta(next.current.id).workLike && !next.breakSyncedAt) {
    const acc = next.breakAccumMs + 1000;
    next = acc >= settings.breakMinutes * 60_000 ? { ...next, breakAccumMs: 0, breakDue: true } : { ...next, breakAccumMs: acc };
  }
  return next;
};

/* ---------------- Context ---------------- */

interface Store {
  s: AppState;
  now: number;
  device: DeviceInfo;
  transport?: DeviceTransport;
  actions: ReturnType<typeof makeActions>;
  connect: (kind: "mock" | "ble" | "serial", grantedOnly?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  /** 订阅所有入站设备消息（音频帧等页面级消费）；返回退订函数 */
  onDeviceMessage: (cb: (m: InboundMessage) => void) => () => void;
}

const Ctx = createContext<Store | null>(null);

const makeActions = (set: (fn: (s: AppState) => AppState) => void, get: () => AppState) => ({
  setStatus(id: StatusId, source: StatusSource = "manual", opts: { minutes?: number; note?: string } = {}) {
    set((s) => {
      const now = Date.now();
      const until = opts.minutes ? now + opts.minutes * 60_000 : undefined;
      let next = applyStatus(s, id, source, now, until, opts.note);
      // 手动干预后的暂停/挂起由设备按 mode 处理（pausedToday 是设备镜像，网页不本地置位）
      if (id === "rest") next = { ...next, breakAccumMs: 0, breakDue: false };
      return next;
    });
  },
  extendStatus(minutes: number) {
    set((s) => ({ ...s, current: { ...s.current, until: Math.max(Date.now(), s.current.until ?? Date.now()) + minutes * 60_000 } }));
  },
  offwork(source: StatusSource = "offwork"): Snapshot {
    const cur = get();
    const snap: Snapshot = { current: cur.current, segments: cur.segments, offworkToday: cur.offworkToday, timer: cur.timer };
    set((s) => ({ ...applyStatus(s, "off", source, Date.now()), offworkToday: true, breakDue: false }));
    return snap;
  },
  restore(snap: Snapshot) {
    set((s) => ({ ...s, ...snap }));
  },
  pauseToday(paused: boolean) {
    deviceSend?.({ type: "sched", op: "pause", paused });   // 设备置暂停日并回 schedules 快照，网页等推送
  },
  startTimer(minutes: number, status: StatusId = "focus") {
    set((s) => {
      const now = Date.now();
      const endsAt = now + minutes * 60_000;
      return { ...applyStatus({ ...s, timer: { endsAt, minutes, status } }, status, "timer", now, endsAt), timer: { endsAt, minutes, status } };
    });
  },
  extendTimer(minutes: number) {
    set((s) => {
      if (!s.timer) return s;
      const endsAt = Math.max(Date.now(), s.timer.endsAt) + minutes * 60_000;
      return { ...s, timer: { ...s.timer, endsAt, expired: false }, current: { ...s.current, until: endsAt } };
    });
  },
  finishTimer(nextStatus?: StatusId) {
    set((s) => (nextStatus ? applyStatus({ ...s, timer: undefined }, nextStatus, "manual", Date.now()) : { ...s, timer: undefined, current: { ...s.current, until: undefined } }));
  },
  setBreakInterval(minutes: number) {
    set((s) => {
      if (s.settings.breakMinutes === minutes) return s;
      sendBreak({ minutes, accumMs: 0 }, s); // 换间隔即重新开始当前轮
      return { ...s, settings: { ...s.settings, breakMinutes: minutes }, breakAccumMs: 0, breakSyncedAt: Date.now(), breakDue: false };
    });
  },
  remindBreakIn(minutes: number) {
    set((s) => {
      sendBreak({ accumMs: (s.settings.breakMinutes - minutes) * 60_000 }, s);
      return { ...s, breakDue: false, breakAccumMs: (s.settings.breakMinutes - minutes) * 60_000, breakSyncedAt: Date.now() };
    });
  },
  dismissBreak() {
    set((s) => ({ ...s, breakDue: false })); // 设备已自动进入下一轮，只关横幅
  },
  skipBreakToday() {
    set((s) => {
      sendBreak({ offToday: true }, s);
      return { ...s, breakDue: false, breakOffToday: true };
    });
  },
  resumeBreakToday() {
    set((s) => {
      sendBreak({ offToday: false, accumMs: 0 }, s);
      return { ...s, breakOffToday: false, breakAccumMs: 0, breakSyncedAt: Date.now() };
    });
  },
  resetBreak() {
    set((s) => {
      sendBreak({ accumMs: 0 }, s);
      return { ...s, breakDue: false, breakAccumMs: 0, breakSyncedAt: Date.now() };
    });
  },
  /** 切换当前计划：设备执行态操作，必须连接（sched use → schedules 快照回推 act） */
  setActiveSchedule(id: string) {
    deviceSend?.({ type: "sched", op: "use", id });
  },
  /** 保存计划表：事实源在设备，下发 sched set；镜像等设备回 schedules 快照再更新 */
  saveSchedule(schedule: Schedule) {
    deviceSend?.(schedSetMsg(schedule));
  },
  /** 删除计划表：下发 sched del；镜像等快照更新 */
  deleteSchedule(id: string) {
    deviceSend?.({ type: "sched", op: "del", id });
  },
  duplicateSchedule(id: string) {
    const src = get().schedules.find((x) => x.id === id);
    if (!src) return;
    deviceSend?.(schedSetMsg({ ...src, id: uid(), name: `${src.name}（副本）`, nodes: src.nodes.map((n) => ({ ...n, id: uid() })) }));
  },
  addReminder(r: Omit<Reminder, "id" | "done" | "day">) {
    set((s) => ({ ...s, reminders: [{ ...r, id: uid(), day: dateKey(Date.now()), done: false }, ...s.reminders] }));
  },
  toggleReminder(id: string) {
    set((s) => ({ ...s, reminders: s.reminders.map((r) => (r.id === id ? { ...r, done: !r.done } : r)) }));
  },
  /** 修改待办；改了触发方式或时间则清除已触发标记，以便按新时间重新提醒 */
  updateReminder(id: string, patch: Partial<Omit<Reminder, "id">>) {
    set((s) => ({
      ...s,
      reminders: s.reminders.map((r) => {
        if (r.id !== id) return r;
        const retime = (patch.at !== undefined && patch.at !== r.at) || (patch.trigger !== undefined && patch.trigger !== r.trigger);
        return { ...r, ...patch, ...(retime ? { firedAt: undefined } : {}) };
      }),
    }));
  },
  /** 遗留待办移到今天：归属日改为今天；定时提醒必须先选新时间（at），清除已触发标记重新参与到点提醒 */
  moveRemindersToToday(ids: string[], at?: string) {
    const today = dateKey(Date.now());
    set((s) => ({
      ...s,
      reminders: s.reminders.map((r) => (ids.includes(r.id) ? { ...r, day: today, ...(r.trigger === "time" && at ? { at } : {}), firedAt: undefined } : r)),
    }));
  },
  completeReminders(ids: string[]) {
    set((s) => ({ ...s, reminders: s.reminders.map((r) => (ids.includes(r.id) ? { ...r, done: true } : r)) }));
  },
  /** 删除并返回被删的条目（供撤销恢复） */
  deleteReminders(ids: string[]): Reminder[] {
    const removed = get().reminders.filter((r) => ids.includes(r.id));
    set((s) => ({ ...s, reminders: s.reminders.filter((r) => !ids.includes(r.id)) }));
    return removed;
  },
  restoreReminders(rs: Reminder[]) {
    set((s) => ({ ...s, reminders: [...rs.filter((r) => !s.reminders.some((x) => x.id === r.id)), ...s.reminders] }));
  },
  /** 待办（事实源在设备）：网页发操作消息，设备改完回 todos 全量同步 */
  deviceTodoAdd(t: { text: string; at?: number; trig?: "offwork"; show?: boolean; src?: string }) { deviceSend?.({ type: "todo", op: "add", ...t }); },
  deviceTodoSet(id: string, patch: { text?: string; at?: number; trig?: "offwork" | "at"; show?: boolean; done?: boolean }) { deviceSend?.({ type: "todo", op: "set", id, ...patch }); },
  deviceTodoDone(id: string, done = true) { deviceSend?.({ type: "todo", op: "done", id, done }); },
  deviceTodoDel(id: string) { deviceSend?.({ type: "todo", op: "del", id }); },
  /** 旋钮快速定时：网页只是触发入口，计时本体在设备自治（设备回 timer 消息更新镜像） */
  knobTimerStart(minutes: number) {
    deviceSend?.({ type: "timer", op: "start", minutes });
  },
  knobTimerCancel() {
    deviceSend?.({ type: "timer", op: "cancel" });
    set((s) => (s.knobTimer ? { ...s, knobTimer: undefined } : s));
  },
  /** 自定义状态：事实源在设备注册表，下发 stdef set；镜像等 stdefs 快照更新（需连接） */
  stdefSet(d: { id?: string; zh: string; hint?: string; c: number; work?: boolean }) {
    deviceSend?.({ type: "stdef", op: "set", id: d.id ?? `c${Math.random().toString(36).slice(2, 6)}`, zh: d.zh, hint: d.hint, c: d.c, work: d.work });
  },
  /** 删除自定义状态：下发 stdef del；镜像等快照更新（需连接） */
  stdefDel(id: string) {
    deviceSend?.({ type: "stdef", op: "del", id });
  },
  setUserName(name: string) {
    set((s) => ({ ...s, user: { ...s.user, name } })); // 共享场景展示的是用户姓名，不是设备名
    deviceSend?.({ type: "share", op: "set", name }); // 广播用名的事实源在设备：改名同步下发
  },
  updateSettings(patch: Partial<Settings>) {
    set((s) => {
      if (patch.breakEnabled !== undefined || patch.breakMinutes !== undefined) sendBreak({ minutes: patch.breakMinutes, enabled: patch.breakEnabled }, s);
      if (patch.overrideMode !== undefined) deviceSend?.({ type: "sched", op: "mode", mode: patch.overrideMode === "pauseToday" ? "today" : "next" });
      const next = { ...s.settings, ...patch };
      // 按键/灯效：事实源在设备 /keys.json /led.json，需连接才写；设备回快照后镜像再校准
      if (activeTransport) {
        if (patch.keys) deviceSend?.({ type: "keys", k1: next.keys.k1, k2: next.keys.k2, k3: next.keys.k3, k4: next.keys.k4, t: next.keys.t, ts: Date.now() });
        if (patch.led !== undefined || patch.ledBrightness !== undefined || patch.ledNightOff !== undefined)
          deviceSend?.({ type: "led", op: "set", map: next.led, br: next.ledBrightness, night: next.ledNightOff });
        // 旋钮定时配置：事实源在设备 /knob.json，设备回 timerCfg 快照后镜像校准
        if (patch.knobStep !== undefined || patch.knobMax !== undefined)
          deviceSend?.({ type: "timerCfg", step: next.knobStep, max: next.knobMax });
        // 分享开关：事实源在设备 /share.json（ESP-NOW 广播由设备执行）
        if (patch.shareEnabled !== undefined) deviceSend?.({ type: "share", op: "set", en: next.shareEnabled });
      } else {
        next.keys = s.settings.keys;                 // 断连时设备真值不可写，本地镜像回滚
        next.led = s.settings.led;
        next.ledBrightness = s.settings.ledBrightness;
        next.ledNightOff = s.settings.ledNightOff;
        next.knobStep = s.settings.knobStep;
        next.knobMax = s.settings.knobMax;
        next.shareEnabled = s.settings.shareEnabled;
      }
      return { ...s, settings: next };
    });
  },
  setAgent(state: AgentState, task?: string) {
    set((s) => ({ ...s, agent: { state, task: task ?? s.agent.task, updatedAt: Date.now() } }));
  },
  /** 修正某天某个区间的状态；day 缺省或为今天时改今日区间 */
  editSegment(index: number, status: StatusId, day?: string) {
    set((s) => {
      const edit = (segs: StatusSegment[]) => segs.map((seg, i) => (i === index ? { ...seg, status } : seg));
      if (!day || day === s.day) return { ...s, segments: edit(s.segments) };
      const segs = edit(s.historySegments[day] ?? []);
      return { ...s, historySegments: { ...s.historySegments, [day]: segs }, history: { ...s.history, [day]: totalsForSegments(segs, Date.now()) } };
    });
  },
  /** 删除某个已归档日期的全部记录（今天的以设备为准，不能在网页删除） */
  deleteDay(day: string) {
    set((s) => {
      if (day === s.day) return s;
      const { [day]: _h, ...history } = s.history;
      const { [day]: _g, ...historySegments } = s.historySegments;
      return { ...s, history, historySegments };
    });
  },
  resetDemo() {
    set(() => createInitial(Date.now()));
  },
});

export const toOutbound = (s: AppState): Extract<OutboundMessage, { type: "state" }> => {
  const meta = statusMeta(s.current.id);
  const until = s.current.until;
  return {
    type: "state",
    status: s.current.id,
    screen: meta.screen,
    sub: s.timer ? `剩余计时` : until ? `${hhmm(until)} 后有空` : meta.hint,
    until,
    layout: s.settings.screenLayout,
    ts: s.current.since,
  };
};

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<AppState>(() => load(Date.now()));
  const [now, setNow] = useState(Date.now());
  const [device, setDevice] = useState<DeviceInfo>({ name: "", kind: "none", state: "disconnected", pending: 0 });
  const transportRef = useRef<DeviceTransport | undefined>(undefined);
  const stateRef = useRef(s);
  stateRef.current = s;
  // 真机连接后等待设备推送区间（segments）采纳完毕前，不向设备下发 state —— 设备是当前状态的权威，网页跟着设备走
  const awaitAdoptionRef = useRef(false);

  const set = useCallback((fn: (s: AppState) => AppState) => setS(fn), []);

  useEffect(() => {
    deviceSend = (m) => transportRef.current?.send(m).catch(() => {});
    return () => { deviceSend = undefined; };
  }, []);
  // HMR 自愈：模块热替换会重置模块级 activeTransport，但 transportRef 随组件状态保留——每次渲染重新对齐，
  // 否则会出现"UI 显示已连接但 updateSettings 走离线回滚、设置点了没反应"的偏航
  useEffect(() => { activeTransport = transportRef.current; });
  const actions = useMemo(() => makeActions(set, () => stateRef.current), [set]);

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setS((prev) => tick(prev, t));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }, [s]);

  const sendSnapshot = useCallback(async () => {
    const t = transportRef.current;
    if (!t) return;
    const st = stateRef.current;
    // 等待设备区间采纳期间不下发 state，避免网页旧状态覆盖设备当前状态
    if (!awaitAdoptionRef.current) await t.send(toOutbound(st));
    await t.send({ type: "time", epoch: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset() });
    // 设备真值不下发：schedules/stdefs/keys/led/mode/break 都由设备上行采纳（hello 后设备主动推）
    setDevice((d) => ({ ...d, lastSyncAt: Date.now(), pending: 0 }));
  }, []);

  useEffect(() => {
    if (device.kind === "none") return;
    if (device.state !== "connected") {
      setDevice((d) => ({ ...d, pending: d.pending + 1 }));
      return;
    }
    sendSnapshot().catch(() => setDevice((d) => ({ ...d, pending: d.pending + 1 })));
  }, [s.current, s.settings.led, s.settings.ledBrightness, s.settings.screenLayout, s.settings.keys]);

  const tapsRef = useRef(new Set<(m: InboundMessage) => void>());
  const onDeviceMessage = useCallback((cb: (m: InboundMessage) => void) => {
    tapsRef.current.add(cb);
    return () => { tapsRef.current.delete(cb); };
  }, []);

  const handleInbound = useCallback(
    (m: InboundMessage) => {
      lastInboundAt = Date.now();           // 活性心跳：任何上行消息都证明链路活着
      for (const fn of tapsRef.current) fn(m);   // 页面级订阅先跑（音频帧等实时数据）
      const cur = stateRef.current;
      const runKey = (a: KeyAction, src: StatusSource) => {
        if (a === "offwork") actions.offwork("offwork");
        else if (a === "focus25") actions.startTimer(25);
        else if (a === "pauseToday") actions.pauseToday(!cur.pausedToday);
        else if (a === "cycleL" || a === "cycleR") {
          const ids = allStatusIds().filter((id) => id !== "off"); // 循环不含 off，与固件一致
          const i = Math.max(0, ids.indexOf(cur.current.id));
          actions.setStatus(ids[(i + (a === "cycleL" ? ids.length - 1 : 1)) % ids.length], src);
        }
        else if (a !== cur.current.id) actions.setStatus(a, src); // 同状态重按不产生新区间，也不重发设备
      };
      switch (m.type) {
        case "touch":
          runKey(cur.settings.keys.t, "touch");
          break;
        case "key":
          runKey(cur.settings.keys[`k${m.k}` as "k1" | "k2" | "k3" | "k4"], m.k === 1 ? "offwork" : "shortcut");
          break;
        case "shortcut":
          runKey(cur.settings.keys.k2, "shortcut");
          break;
        case "offworkKey":
          runKey(cur.settings.keys.k1, "offwork");
          break;
        case "knob":
          // 旧协议兼容：等同一个已运行的设备倒计时镜像（不再转成网页侧专注计时）
          set((s) => ({ ...s, knobTimer: { mode: "run", minutes: m.minutes, endsAt: Date.now() + m.minutes * 60_000 } }));
          break;
        case "timer": {
          // 设备旋钮快速定时镜像：计时本体在设备，网页只展示
          const now = Date.now();
          if (m.st === "idle") set((s) => (s.knobTimer ? { ...s, knobTimer: undefined } : s));
          else if (m.st === "select") set((s) => ({ ...s, knobTimer: { mode: "select", minutes: m.minutes ?? s.knobTimer?.minutes ?? cur.settings.knobStep } }));
          else if (m.st === "run") set((s) => ({ ...s, knobTimer: { mode: "run", minutes: m.minutes ?? s.knobTimer?.minutes ?? 0, endsAt: now + (m.remain ?? 0) } }));
          else if (m.st === "done") set((s) => ({ ...s, knobTimer: { mode: "expired", minutes: m.minutes ?? s.knobTimer?.minutes ?? 0 } }));
          break;
        }
        case "timerCfg":
          // 旋钮配置事实源在设备：快照直接校准镜像（不改写设备值）
          set((s) => (s.settings.knobStep === m.step && s.settings.knobMax === m.max ? s : { ...s, settings: { ...s.settings, knobStep: m.step, knobMax: m.max } }));
          break;
        case "breakState": {
          // 设备是唯一事实来源；但有未回执的网页设置（breakPending）时，该字段暂不采纳、并重发到一致为止
          const p = breakPending;
          const settled = (k: "minutes" | "enabled" | "offToday") => !p || p[k] === undefined || p[k] === m[k];
          set((s) => {
            const nMin = settled("minutes") ? m.minutes : s.settings.breakMinutes;
            const nEn = settled("enabled") ? m.enabled : s.settings.breakEnabled;
            const nOff = settled("offToday") ? m.offToday : s.breakOffToday;
            const nDue = s.breakDue || m.due;
            if (nMin === s.settings.breakMinutes && nEn === s.settings.breakEnabled && nOff === s.breakOffToday && nDue === s.breakDue && s.breakAccumMs === m.accumMs) return s;
            return { ...s, breakAccumMs: m.accumMs, breakSyncedAt: Date.now(), breakDue: nDue, breakOffToday: nOff, settings: { ...s.settings, breakMinutes: nMin, breakEnabled: nEn } };
          });
          if (p) {
            for (const k of ["minutes", "enabled", "offToday"] as const) if (p[k] === undefined || p[k] === m[k]) delete p[k];
            if (Object.keys(p).length) deviceSend?.({ type: "break", minutes: p.minutes ?? m.minutes, enabled: p.enabled ?? m.enabled, offToday: p.offToday ?? m.offToday });
            else breakPending = undefined;
          }
          break;
        }
        case "segments":
          if (m.phase === "begin") {
            pendingSegs = [];
          } else {
            awaitAdoptionRef.current = false; // 收到设备区间 → 后续快照可正常携带 state（已采纳设备为准）
            const list: StatusSegment[] = pendingSegs.map((x) => ({ status: x.status, source: "device", start: x.start, end: x.end }));
            pendingSegs = [];
            // 设备是时长记录权威：整表替换今日区间与当前状态，网页断连期间的改动被设备值覆盖。
            // 同步写 stateRef：紧随其后的 sendSnapshot 回显必须携带已采纳的设备状态，否则又把网页旧状态推回去
            if (list.length) {
              const last = list[list.length - 1];
              const s = stateRef.current;
              // 内容没变就不替换：time 重校 → 设备 segDirty → 推回相同区间 → 若新建 current 对象会触发快照效应再次下发 time，形成约 2s 一圈的回显环
              const same =
                list.length === s.segments.length &&
                list.every((x, i) => x.status === s.segments[i].status && x.start === s.segments[i].start && x.end === s.segments[i].end) &&
                s.current.id === last.status && s.current.since === last.start;
              if (!same) {
                const next: AppState = {
                  ...s,
                  segments: list,
                  current: { id: last.status, source: "device", since: last.start }, // 丢弃旧 until/note，避免过期"预计结束"横幅
                  offworkToday: s.offworkToday || last.status === "off",
                };
                stateRef.current = next;
                set(() => next);
              }
            }
          }
          break;
        case "seg":
          pendingSegs.push({ status: m.status, start: m.start, end: m.end });
          break;
        case "wantTime":
          deviceSend?.({ type: "time", epoch: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset() });
          break;
        case "hello":
          setDevice((d) => ({ ...d, name: m.name }));
          break;
        case "apps": {
          setDevice((d) => ({ ...d, apps: Object.fromEntries(m.list.map((a) => [a.status, { size: a.size, bad: a.bad }])) }));
          // 断连时点的"恢复默认"：连上后真正清掉设备上的程序
          const pending = pendingClears();
          for (const st of pending) deviceSend?.({ type: "app", op: "clear", status: st });
          if (pending.length) setPendingClears([]);
          // 设备上有程序但本机没有源码：取回二进制，页面渲染设备上的真实画面
          const cs = stateRef.current.settings.customScreens;
          for (const a of m.list) if (!a.bad && !cs[a.status]) deviceSend?.({ type: "app", op: "dump", status: a.status });
          break;
        }
        case "appData": {
          if (m.seq === 0 || appDumpAcc.status !== m.status) appDumpAcc = { status: m.status, parts: [] };
          if (m.data) appDumpAcc.parts.push(m.data);
          if (m.last && appDumpAcc.parts.length) {
            const b64 = appDumpAcc.parts.join("");
            appDumpAcc = { status: "", parts: [] };
            // 采纳设备上的真实程序为本机草稿：缩略图/编辑器跑的就是设备二进制本身
            if (!stateRef.current.settings.customScreens[m.status]) {
              setDeployedHash(m.status, hashBytes(b64ToU8(b64)));
              set((x) => ({ ...x, settings: { ...x.settings, customScreens: { ...x.settings.customScreens, [m.status]: { kind: "wasm" as const, b64, name: `app_${m.status}.wasm` } } } }));
            }
          } else if (m.last) {
            appDumpAcc = { status: "", parts: [] };
          }
          break;
        }
        case "appErr":
          setDevice((d) => ({ ...d, appErr: { status: m.status, msg: m.msg, at: Date.now() } }));
          break;
        case "todos":
          set((s) => ({ ...s, deviceTodos: m.list }));
          break;
        case "todoFired": {
          // 设备到点/收工触发的待办：映射正文，AppShell 弹 toast（action=恢复 → todo done:false）
          const texts = m.ids.map((id) => stateRef.current.deviceTodos.find((t) => t.id === id)?.text ?? "待办");
          set((s) => ({ ...s, reminderFlash: { text: texts.join("、"), at: Date.now(), ids: m.ids } }));
          break;
        }
        case "schedules":
          // 事实源在设备：整表替换镜像 + 执行态（act/paused/mode）采纳
          set((s) => ({
            ...s,
            schedules: m.list.map(schedToMirror),
            activeScheduleId: m.act,
            pausedToday: m.paused,
            settings: { ...s.settings, overrideMode: m.mode === "today" ? "pauseToday" : "untilNextNode" },
          }));
          break;
        case "schedErr":
          set((s) => ({ ...s, reminderFlash: { text: m.msg === "full" ? "计划表已满（设备最多存 8 张）" : m.msg === "badStatus" ? "该表包含已删除的状态，请先修正节点" : `计划表同步失败：${m.msg}`, at: Date.now(), ids: [] } }));
          break;
        case "agentReq":
          set((s) => ({ ...s, deviceAgent: { busy: true, at: Date.now(), round: m.round, startedAt: m.round === 0 || !s.deviceAgent.startedAt ? Date.now() : s.deviceAgent.startedAt, trace: m.msgs.filter((x) => x.role !== "system") } }));
          proxyAgentReq(m, (err) => set((s) => ({ ...s, deviceAgent: { ...s.deviceAgent, err } })));  // 设备是循环主体；网页只做 LLM 转发
          break;
        case "agentDone":
          set((s) => ({ ...s, deviceAgent: { ...s.deviceAgent, busy: false, reply: m.text || undefined, err: undefined, at: Date.now() } }));
          break;
        case "agentErr":
          set((s) => ({ ...s, deviceAgent: { ...s.deviceAgent, busy: false, err: m.msg, at: Date.now() } }));
          break;
        case "stdefs": {
          // 事实源在设备：整表替换镜像；名字入缓存（删除后历史仍显示原名）
          const customStatuses = m.list.map(stdefToMirror);
          setCustomStatusDefs(customStatuses);
          cacheStatusNames(customStatuses);
          set((s) => ({ ...s, customStatuses, statusNameCache: statusNameCache() }));
          break;
        }
        case "keys":
          // 事实源在设备 /keys.json：整组采纳（K1–K4 实体键 + t 触摸键）
          set((s) => ({ ...s, settings: { ...s.settings, keys: { k1: m.k1 as KeyAction, k2: m.k2 as KeyAction, k3: m.k3 as KeyAction, k4: m.k4 as KeyAction, t: (m.t ?? s.settings.keys.t) as KeyAction } } }));
          break;
        case "led":
          // 事实源在设备 /led.json：每状态灯效 + 亮度 + 夜间自动关
          set((s) => ({ ...s, settings: { ...s.settings, led: m.map, ledBrightness: m.br, ledNightOff: m.night } }));
          break;
        case "share":
          // 事实源在设备 /share.json：广播开关 + 共享昵称 + 区域码
          set((s) => ({ ...s, settings: { ...s.settings, shareEnabled: m.en }, user: { ...s.user, name: m.name || s.user.name, zone: m.zone || s.user.zone } }));
          break;
        case "peers":
          // 事实源在网关设备：成员表整表替换（设备只转发 ESP-NOW 听到的广播）
          set((s) => ({
            ...s,
            membersLive: true,
            members: m.list.map((p) => ({ id: p.i, name: p.n || `设备 ${p.i}`, status: p.st as StatusId, via: "espnow" as const, updatedAt: p.at ?? Date.now() })),
          }));
          break;
        case "stdefErr":
          set((s) => ({ ...s, reminderFlash: { text: m.msg === "full" ? "自定义状态已满（最多 8 个），请先删除一个" : `状态设置失败：${m.msg}`, at: Date.now(), ids: [] } }));
          break;
      }
    },
    [actions],
  );

  const connectSeqRef = useRef(0); // 连接代际：断开/新连接会让在途的旧连接作废（防"断开瞬间连上又把 key 写回"竞态）

  const connect = useCallback(
    async (kind: "mock" | "ble" | "serial", grantedOnly = false) => {
      const t: DeviceTransport & { connectGranted?: () => Promise<string> } = kind === "mock" ? new MockTransport() : kind === "ble" ? new BleTransport() : new SerialTransport();
      const seq = ++connectSeqRef.current;
      setDevice((d) => ({ ...d, kind, state: "connecting", apps: undefined, appErr: undefined })); // 安装清单以新连接的设备上报为准
      try {
        // 真机：等设备推送区间并采纳后才恢复下发 state（模拟设备无此流程，立即下发）
        awaitAdoptionRef.current = kind !== "mock";
        const name = grantedOnly && t.connectGranted ? await t.connectGranted() : await t.connect();
        if (connectSeqRef.current !== seq) { // 握手期间被断开：孤立连接自行拆掉，不写状态不记通道
          await t.disconnect().catch(() => {});
          return;
        }
        transportRef.current = t; // 先就位：onMessage 会冲刷握手期间排队的消息，其中的回调需要 deviceSend 可用
        activeTransport = t;
        lastInboundAt = Date.now(); // 连接成功即视为活着，随后靠上行消息续命
        t.onMessage(handleInbound);
        t.onDisconnect(() => setDevice((d) => ({ ...d, state: "disconnected" })));
        setDevice((d) => ({ ...d, name, kind, state: "connected" }));
        localStorage.setItem("sgp-last-transport", kind); // 记住通道：刷新后用已授权设备/端口静默重连
        await sendSnapshot();
        if (connectSeqRef.current !== seq) return; // 快照期间被断开：断开方已清理 UI/引用，直接收工
      } catch (e) {
        awaitAdoptionRef.current = false;
        setDevice((d) => ({ ...d, kind: transportRef.current ? d.kind : "none", state: "disconnected" }));
        throw e;
      }
    },
    [handleInbound, sendSnapshot],
  );

  // 旧版网页待办 → 设备待办：设备成为唯一事实源，存档里遗留的网页待办在首次连上设备时推给设备、清空本地
  const remindersMigrated = useRef(false);
  useEffect(() => {
    if (remindersMigrated.current || device.state !== "connected" || !s.reminders.length) return;
    remindersMigrated.current = true;
    for (const r of s.reminders.filter((x) => !x.done)) {
      const at = r.trigger === "time" && r.at ? atToday(r.at, new Date(`${r.day}T00:00:00`).getTime() || Date.now()) : undefined;
      deviceSend?.({ type: "todo", op: "add", text: r.title, at, trig: r.trigger === "afterOffwork" ? "offwork" : undefined, show: r.showOnDevice, src: r.createdBy === "voice" ? "voice" : "web" });
    }
    set((st) => ({ ...st, reminders: [] }));
  }, [device.state, s.reminders]);

  // 活性看门狗：真实传输 15s 无任何上行消息 → 判定链路死（串口假连接：设备断电/拔线后端口仍可打开；
  // 固件有 10s 心跳 breakState/wantTime，活设备必到）。mock 无心跳不检查。
  useEffect(() => {
    const iv = setInterval(() => {
      if (device.state !== "connected" || device.kind === "mock" || device.kind === "none") return;
      if (Date.now() - lastInboundAt > 15000) {
        const t = transportRef.current;
        transportRef.current = undefined;
        activeTransport = undefined;
        t?.disconnect().catch(() => {});       // discCb 会把 device.state 置 disconnected
        setDevice((d) => ({ ...d, state: "disconnected" }));
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [device.state, device.kind]);

  // 页面刷新后静默重连：GATT/串口随页面销毁属正常，但授权关系还在——用上次的通道免弹框直连
  const autoReconnectDone = useRef(false);
  useEffect(() => {
    if (autoReconnectDone.current) return;
    autoReconnectDone.current = true;
    const last = localStorage.getItem("sgp-last-transport");
    if (last === "ble" || last === "serial" || last === "mock") connect(last, true).catch(() => {});
  }, [connect]);

  const disconnect = useCallback(async () => {
    connectSeqRef.current++; // 让在途连接作废
    localStorage.removeItem("sgp-last-transport"); // 用户主动断开：刷新不再自动重连
    await transportRef.current?.disconnect();
    transportRef.current = undefined;
    activeTransport = undefined;
    awaitAdoptionRef.current = false;
    setDevice({ name: "", kind: "none", state: "disconnected", pending: 0 });
  }, []);

  const value = useMemo<Store>(
    () => ({ s, now, device, transport: transportRef.current, actions, connect, disconnect, onDeviceMessage }),
    [s, now, device, actions, connect, disconnect, onDeviceMessage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside AppStoreProvider");
  return v;
};

