import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AgentState, CurrentStatus, DeviceInfo, KeyAction, Member, Reminder, Schedule, Settings, StatusId, StatusSegment, StatusSource,
} from "../domain/types";
import { STATUSES } from "../domain/statuses";
import { atToday, dateKey, hhmm, startOfDay, uid } from "../domain/time";
import { currentNode, nextNode, scheduleForDay, sortedNodes } from "../domain/schedule";
import { lastDays, totalsForSegments } from "../domain/review";
import { defaultSettings, initialStatus, seedMembers, seedPast, seedReminders, seedSchedules, seedSegments } from "./seed";
import type { DeviceTransport, InboundMessage, OutboundMessage } from "../device/protocol";
import { MockTransport } from "../device/mockTransport";
import { BleTransport } from "../device/bleTransport";
import { SerialTransport } from "../device/serialTransport";

const STORAGE_KEY = "shougongpai.v1";
/** 本机保留的历史天数（含今天），超出的在跨天时清理 */
export const HISTORY_DAYS = 90;

/** 由 Provider 注册：向已连接设备发送一条消息（未连接时为空操作） */
let deviceSend: ((m: OutboundMessage) => void) | undefined;
/** 已发出但设备尚未回执一致的休息提醒设置；发送可能撞上设备重启窗口而丢失，靠 breakState 回执重发收敛 */
let breakPending: { minutes?: number; enabled?: boolean; offToday?: boolean } | undefined;
/** 设备逐行推送的今日状态区间：begin 清空、seg 累积、end 一次性替换 */
let pendingSegs: { status: StatusId; start: number; end?: number }[] = [];
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

export interface TimerState {
  endsAt: number;
  minutes: number;
  status: StatusId;
  expired?: boolean;
}

export interface AppState {
  current: CurrentStatus;
  segments: StatusSegment[];
  history: Record<string, Partial<Record<StatusId, number>>>;
  /** 已归档日期的状态区间（今天的在 segments），用于回顾页查看某天详情 */
  historySegments: Record<string, StatusSegment[]>;
  schedules: Schedule[];
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
  settings: Settings;
  timer?: TimerState;
  breakAccumMs: number;   // 已同步时 = 设备上次上报的累计值；显示时按 breakSyncedAt 外推
  breakSyncedAt: number;  // 上次收到设备 breakState 的时刻；0 = 从未同步（离线模式，本地累计）
  breakDue: boolean;
  breakOffToday: boolean;
  agent: { state: AgentState; task: string; updatedAt: number };
  user: { name: string; team: string; zone: string };
}

type Snapshot = Pick<AppState, "current" | "segments" | "offworkToday" | "timer">;

const createInitial = (now: number): AppState => {
  const schedules = seedSchedules();
  const sched = scheduleForDay(schedules, "weekday", now);
  const node = currentNode(sched, now);
  const segments = sched ? seedSegments(sched, now) : [];
  const status = initialStatus(sched, now);
  const next = nextNode(sched, now);
  const past = seedPast(now);
  return {
    current: { id: status, source: node ? "schedule" : "manual", since: segments.at(-1)?.start ?? now, until: next ? atToday(next.time, now) : undefined },
    segments: segments.length ? segments : [{ status, source: "manual", start: now }],
    history: past.history,
    historySegments: past.segments,
    schedules,
    activeScheduleId: "weekday",
    day: dateKey(now),
    pausedToday: false,
    offworkToday: status === "off",
    lastAppliedNode: node ? `${dateKey(now)}:${node.id}` : undefined,
    reminders: seedReminders(now),
    members: seedMembers(now),
    settings: defaultSettings,
    breakAccumMs: 13 * 60_000,
    breakSyncedAt: 0,
    breakDue: false,
    breakOffToday: false,
    agent: { state: "needsInput", task: "重构登录模块", updatedAt: now - 3 * 60_000 },
    user: { name: "阿杰", team: "3 楼设计组", zone: "3 楼设计组" },
  };
};

const load = (now: number): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as AppState;
      // 旧版本字段迁移：touchLeft/touchRight/shortcut → keys.k3/k4/k2
      const legacy = saved.settings as Settings & { touchLeft?: StatusId; touchRight?: StatusId; shortcut?: KeyAction };
      const keys = saved.settings.keys ?? { k1: "offwork" as const, k2: legacy.shortcut ?? "busy", k3: legacy.touchLeft ?? "work", k4: legacy.touchRight ?? "busy" };
      // 旧版本只存了每日汇总，没有区间：换成可查看详情的演示历史
      const past = saved.historySegments ? undefined : seedPast(now);
      return {
        ...createInitial(now), ...saved, breakSyncedAt: 0, settings: { ...defaultSettings, ...saved.settings, keys },
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
        ...(past ? { history: past.history, historySegments: past.segments } : {}),
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

const scheduleUntil = (s: AppState, now: number) => {
  const n = nextNode(scheduleForDay(s.schedules, s.activeScheduleId, now), now);
  return n ? atToday(n.time, now) : undefined;
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

  const sched = scheduleForDay(next.schedules, next.activeScheduleId, now);
  const node = currentNode(sched, now);
  const key = node ? `${today}:${node.id}` : undefined;
  if (node && key !== next.lastAppliedNode) {
    const blockedByOffwork = next.offworkToday; // 收工 = 今日计划完成，所有节点作废（手动切回工作不受影响）
    next = { ...next, lastAppliedNode: key };
    if (!next.pausedToday && !blockedByOffwork && next.current.id !== node.status) {
      next = applyStatus(next, node.status, "schedule", now, scheduleUntil(next, now), node.note);
      if (node.status === "off") next = { ...next, offworkToday: true };
    } else if (!next.pausedToday && !blockedByOffwork && next.current.source === "schedule") {
      next = { ...next, current: { ...next.current, until: scheduleUntil(next, now), note: node.note } };
    }
  }

  // 提醒触发：定时提醒到点触发（只归属今天的）；收工后提醒在收工后触发（含遗留未处理的）
  const willFire = (r: Reminder) =>
    !r.done && !r.firedAt &&
    ((r.trigger === "time" && r.day === today && !!r.at && atToday(r.at, now) <= now) ||
     (r.trigger === "afterOffwork" && r.day <= today && next.offworkToday));
  const firing = next.reminders.filter(willFire);
  if (firing.length) {
    next = {
      ...next,
      reminders: next.reminders.map((r) => (willFire(r) ? { ...r, firedAt: now } : r)),
      reminderFlash: { text: firing.map((r) => r.title).join("、"), at: now, ids: firing.map((r) => r.id) },
    };
    for (const r of firing) deviceSend?.({ type: "reminder", text: r.showOnDevice ? r.deviceText?.trim() || r.title : undefined, count: firing.length, ts: now });
  }

  if (next.timer && !next.timer.expired && now >= next.timer.endsAt) next = { ...next, timer: { ...next.timer, expired: true } };

  const { settings } = next;
  // 本地累计只在从未同步过设备时启用（离线/模拟设备）；连接后设备是计时权威，网页只存快照外推
  if (settings.breakEnabled && !next.breakOffToday && STATUSES[next.current.id].workLike && !next.breakSyncedAt) {
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
  connect: (kind: "mock" | "ble" | "serial") => Promise<void>;
  disconnect: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

const makeActions = (set: (fn: (s: AppState) => AppState) => void, get: () => AppState) => ({
  setStatus(id: StatusId, source: StatusSource = "manual", opts: { minutes?: number; note?: string } = {}) {
    set((s) => {
      const now = Date.now();
      const until = opts.minutes ? now + opts.minutes * 60_000 : undefined;
      let next = applyStatus(s, id, source, now, until, opts.note);
      if (source !== "schedule" && s.settings.overrideMode === "pauseToday") next = { ...next, pausedToday: true };
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
    set((s) => {
      if (paused) return { ...s, pausedToday: true };
      const now = Date.now();
      const node = currentNode(scheduleForDay(s.schedules, s.activeScheduleId, now), now);
      const resumed = { ...s, pausedToday: false };
      return node && node.status !== s.current.id ? applyStatus(resumed, node.status, "schedule", now, scheduleUntil(resumed, now), node.note) : resumed;
    });
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
  setActiveSchedule(id: string) {
    set((s) => ({ ...s, activeScheduleId: id, lastAppliedNode: undefined }));
  },
  saveSchedule(schedule: Schedule) {
    set((s) => {
      const exists = s.schedules.some((x) => x.id === schedule.id);
      return { ...s, schedules: exists ? s.schedules.map((x) => (x.id === schedule.id ? schedule : x)) : [...s.schedules, schedule], lastAppliedNode: undefined };
    });
  },
  deleteSchedule(id: string) {
    set((s) => {
      const schedules = s.schedules.filter((x) => x.id !== id);
      // 删除生效中的重复计划 → 不再启用任何表，设备上这份计划随之清空（不静默换另一张）
      const activeScheduleId = s.activeScheduleId === id ? "" : s.activeScheduleId;
      return { ...s, schedules, activeScheduleId };
    });
  },
  duplicateSchedule(id: string) {
    set((s) => {
      const src = s.schedules.find((x) => x.id === id);
      if (!src) return s;
      return { ...s, schedules: [...s.schedules, { ...src, id: uid(), name: `${src.name}（副本）`, nodes: src.nodes.map((n) => ({ ...n, id: uid() })) }] };
    });
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
  setUserName(name: string) {
    set((s) => ({ ...s, user: { ...s.user, name } })); // 共享场景展示的是用户姓名，不是设备名
  },
  updateSettings(patch: Partial<Settings>) {
    set((s) => {
      if (patch.breakEnabled !== undefined || patch.breakMinutes !== undefined) sendBreak({ minutes: patch.breakMinutes, enabled: patch.breakEnabled }, s);
      return { ...s, settings: { ...s.settings, ...patch } };
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

export const toOutbound = (s: AppState): OutboundMessage => {
  const meta = STATUSES[s.current.id];
  const until = s.current.until;
  return {
    type: "state",
    status: s.current.id,
    screen: meta.screen,
    sub: s.timer ? `剩余计时` : until ? `${hhmm(until)} 后有空` : meta.hint,
    until,
    led: s.settings.led[s.current.id],
    brightness: s.settings.ledBrightness,
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
    const main = st.schedules.find((x) => x.id === st.activeScheduleId && x.kind === "repeat");
    const eff = scheduleForDay(st.schedules, st.activeScheduleId, Date.now());
    const nodesOf = (sc: typeof eff) => (sc ? sortedNodes(sc).map(({ time, status }) => ({ time, status })) : []);
    // 等待设备区间采纳期间不下发 state，避免网页旧状态覆盖设备当前状态
    if (!awaitAdoptionRef.current) await t.send(toOutbound(st));
    await t.send({ type: "time", epoch: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset() });
    // 生效计划表下发设备自治执行：主表=选中的重复计划；今天的单日计划作 override 优先执行、跨天自动失效
    await t.send({
      type: "schedule",
      kind: "repeat",
      weekdays: main?.weekdays ?? [],
      nodes: nodesOf(main),
      override: eff && eff.kind === "date" && eff.date ? { date: eff.date, nodes: nodesOf(eff) } : undefined,
      paused: st.pausedToday,
      mode: st.settings.overrideMode === "pauseToday" ? "today" : "next",
      ts: Date.now(),
    });
    // 按键映射下发：设备离线时按用户配置执行（含暂停/恢复今日计划）
    await t.send({ type: "keys", k1: st.settings.keys.k1, k2: st.settings.keys.k2, k3: st.settings.keys.k3, k4: st.settings.keys.k4, ts: Date.now() });
    // 休息提醒不再随快照下发：间隔/开关/计时均以设备为准，连接后由 breakState 对齐网页
    setDevice((d) => ({ ...d, lastSyncAt: Date.now(), pending: 0 }));
  }, []);

  useEffect(() => {
    if (device.kind === "none") return;
    if (device.state !== "connected") {
      setDevice((d) => ({ ...d, pending: d.pending + 1 }));
      return;
    }
    sendSnapshot().catch(() => setDevice((d) => ({ ...d, pending: d.pending + 1 })));
  }, [s.current, s.settings.led, s.settings.ledBrightness, s.settings.overrideMode, s.settings.keys, s.schedules, s.activeScheduleId, s.pausedToday]);

  const handleInbound = useCallback(
    (m: InboundMessage) => {
      const cur = stateRef.current;
      const runKey = (a: KeyAction, src: StatusSource) => {
        if (a === "offwork") actions.offwork("offwork");
        else if (a === "focus25") actions.startTimer(25);
        else if (a === "pauseToday") actions.pauseToday(!cur.pausedToday);
        else if (a !== cur.current.id) actions.setStatus(a, src); // 同状态重按不产生新区间，也不重发设备
      };
      switch (m.type) {
        case "touch":
          runKey(m.zone === "left" ? cur.settings.keys.k3 : cur.settings.keys.k4, "touch");
          break;
        case "shortcut":
          runKey(cur.settings.keys.k2, "shortcut");
          break;
        case "offworkKey":
          runKey(cur.settings.keys.k1, "offwork");
          break;
        case "knob":
          actions.startTimer(m.minutes);
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
      }
    },
    [actions],
  );

  const connect = useCallback(
    async (kind: "mock" | "ble" | "serial") => {
      const t: DeviceTransport = kind === "mock" ? new MockTransport() : kind === "ble" ? new BleTransport() : new SerialTransport();
      setDevice((d) => ({ ...d, kind, state: "connecting" }));
      try {
        // 真机：等设备推送区间并采纳后才恢复下发 state（模拟设备无此流程，立即下发）
        awaitAdoptionRef.current = kind !== "mock";
        const name = await t.connect();
        transportRef.current = t; // 先就位：onMessage 会冲刷握手期间排队的消息，其中的回调需要 deviceSend 可用
        t.onMessage(handleInbound);
        t.onDisconnect(() => setDevice((d) => ({ ...d, state: "disconnected" })));
        setDevice((d) => ({ ...d, name, kind, state: "connected" }));
        await sendSnapshot();
      } catch (e) {
        awaitAdoptionRef.current = false;
        setDevice((d) => ({ ...d, kind: transportRef.current ? d.kind : "none", state: "disconnected" }));
        throw e;
      }
    },
    [handleInbound, sendSnapshot],
  );

  const disconnect = useCallback(async () => {
    await transportRef.current?.disconnect();
    transportRef.current = undefined;
    awaitAdoptionRef.current = false;
    setDevice({ name: "", kind: "none", state: "disconnected", pending: 0 });
  }, []);

  const value = useMemo<Store>(
    () => ({ s, now, device, transport: transportRef.current, actions, connect, disconnect }),
    [s, now, device, actions, connect, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside AppStoreProvider");
  return v;
};
