import type { Member, Reminder, Schedule, Settings, StatusId, StatusSegment } from "../domain/types";
import { atToday, dateKey, startOfDay } from "../domain/time";
import { DAY_MS, totalsForSegments, type Totals } from "../domain/review";
import { currentNode, sortedNodes } from "../domain/schedule";

export const defaultSettings: Settings = {
  overrideMode: "untilNextNode",
  breakEnabled: true,
  breakMinutes: 45,
  breakOptions: [20, 30, 45],
  ledBrightness: 40,
  ledNightOff: true,
  led: { work: "solid", busy: "solid", focus: "breath", meet: "solid", rest: "solid", off: "off" },
  keys: { k1: "offwork", k2: "busy", k3: "work", k4: "busy" },
  deviceName: "收工牌 A1",
  knobStep: 5,
  knobMax: 180,
  shareEnabled: true,
  showReminderOnDevice: false,
  agentEnabled: true,
  phoneDnd: { busy: true, focus: true, meet: true },
  staleMinutes: 15,
  screenLayout: "withTime",
};

export const seedSchedules = (): Schedule[] => [
  {
    id: "weekday",
    name: "标准工作日",
    kind: "repeat",
    weekdays: [1, 2, 3, 4, 5],
    nodes: [
      { id: "n1", time: "09:00", status: "work" },
      { id: "n2", time: "10:30", status: "meet", note: "周会" },
      { id: "n3", time: "11:30", status: "work" },
      { id: "n4", time: "12:00", status: "rest", note: "午休" },
      { id: "n5", time: "13:30", status: "work" },
      { id: "n6", time: "14:00", status: "meet", note: "需求评审" },
      { id: "n7", time: "15:00", status: "work" },
      { id: "n8", time: "18:00", status: "off" },
    ],
  },
  {
    id: "remote",
    name: "居家办公",
    kind: "repeat",
    weekdays: [1, 2, 3, 4, 5],
    nodes: [
      { id: "r1", time: "09:30", status: "work" },
      { id: "r2", time: "12:00", status: "rest" },
      { id: "r3", time: "13:00", status: "focus", note: "深度工作" },
      { id: "r4", time: "15:00", status: "work" },
      { id: "r5", time: "18:30", status: "off" },
    ],
  },
  {
    id: "friday",
    name: "周五短工作日",
    kind: "repeat",
    weekdays: [5],
    nodes: [
      { id: "f1", time: "09:00", status: "work" },
      { id: "f2", time: "16:00", status: "off" },
    ],
  },
];

export const seedReminders = (now: number): Reminder[] => {
  const day = dateKey(now);
  const yesterday = dateKey(startOfDay(now) - 1);
  return [
    // 昨天遗留：未完成的待办跨天保留，归入"昨天遗留"块
    { id: "m0", title: "回复客户邮件", trigger: "time", at: "16:30", day: yesterday, showOnDevice: false, createdBy: "manual", done: false },
    { id: "m9", title: "确认打印机驱动", trigger: "time", at: "10:00", day: yesterday, showOnDevice: false, createdBy: "manual", done: false },
    { id: "m1", title: "提交本周周报", detail: "到点时设备和手机同时提示", trigger: "time", at: "17:30", day, showOnDevice: false, createdBy: "manual", done: false },
    { id: "m2", title: "带狗狗去看医生", detail: "收工后在设备上显示，仅自己可见", trigger: "afterOffwork", day, showOnDevice: true, createdBy: "voice", done: false },
    { id: "m3", title: "给设计稿补充标注", trigger: "time", at: "16:00", day, showOnDevice: false, createdBy: "manual", done: true },
  ];
};

export const seedMembers = (now: number): Member[] => [
  { id: "lin", name: "小林", status: "work", via: "espnow", updatedAt: now - 60_000 },
  { id: "zhou", name: "老周", status: "busy", until: "15:30", via: "gateway", updatedAt: now - 3 * 60_000 },
  { id: "chen", name: "陈姐", status: "meet", via: "espnow", updatedAt: now - 3 * 3600_000 },
];

/** 根据计划表生成今天到目前为止的状态区间，用于演示回顾数据 */
export const seedSegments = (schedule: Schedule, now: number): StatusSegment[] => {
  const nodes = sortedNodes(schedule).filter((n) => atToday(n.time, now) <= now);
  return nodes.map((n, i) => ({
    status: n.status,
    source: "schedule",
    start: atToday(n.time, now),
    end: nodes[i + 1] ? atToday(nodes[i + 1].time, now) : undefined,
  }));
};

const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

/** 演示用：过去 29 天的状态区间（工作日较完整，周末多数无记录，偶有未记录空档） */
export const seedPast = (now: number) => {
  const day0 = startOfDay(now);
  const segments: Record<string, StatusSegment[]> = {};
  const history: Record<string, Totals> = {};
  const sources: StatusSegment["source"][] = ["schedule", "schedule", "device", "touch", "shortcut"];
  for (let i = 1; i < 30; i++) {
    const base = startOfDay(day0 - i * DAY_MS + 12 * 3600_000);
    const dow = new Date(base).getDay();
    const r = (k: number) => rand(i * 31 + k);
    if (dow === 0 || (dow === 6 && r(0) < 0.6)) continue;
    const plan: [StatusId, number][] = dow === 6
      ? [["work", 600 + r(1) * 40], ["focus", 680 + r(2) * 20], ["off", 760 + r(3) * 60]]
      : [
          ["work", 530 + r(1) * 45],
          ...(r(2) < 0.7 ? [["meet", 630] as [StatusId, number], ["work", 690 + r(3) * 15] as [StatusId, number]] : []),
          ["rest", 720 + r(4) * 10],
          [r(5) < 0.5 ? "focus" : "work", 800 + r(6) * 20],
          ...(r(7) < 0.5 ? [["meet", 840] as [StatusId, number]] : []),
          [r(8) < 0.4 ? "busy" : "work", 900 + r(9) * 30],
          ...(r(10) < 0.35 ? [["rest", 960 + r(11) * 20] as [StatusId, number], ["work", 990 + r(12) * 10] as [StatusId, number]] : []),
          ["off", 1050 + r(13) * 100],
        ];
    const gapAt = r(14) < 0.3 ? 1 + Math.floor(r(15) * (plan.length - 2)) : -1;
    const segs: StatusSegment[] = plan.map(([status, min], j) => {
      const next = plan[j + 1];
      const end = next ? base + Math.round(next[1]) * 60_000 - (j === gapAt ? 12 * 60_000 : 0) : base + DAY_MS - 60_000;
      return { status, source: sources[Math.floor(r(20 + j) * sources.length)], start: base + Math.round(min) * 60_000, end };
    });
    const key = dateKey(base);
    segments[key] = segs;
    history[key] = totalsForSegments(segs, base + DAY_MS);
  }
  return { history, segments };
};

export const initialStatus = (schedule: Schedule | undefined, now: number): StatusId =>
  currentNode(schedule, now)?.status ?? "work";
