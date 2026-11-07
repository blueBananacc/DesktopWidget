import type { CustomStatusDef, KeyAction, StatusId, StatusSource } from "./types";

export interface StatusMeta {
  id: StatusId;
  label: string;
  screen: string;
  hint: string;
  pattern: "ring" | "solid" | "half" | "hatch" | "dots" | "moon";
  className: string;
  color: string;
  workLike: boolean;
}

export const STATUSES: Record<string, StatusMeta> = {
  work: { id: "work", label: "工作中", screen: "工作中", hint: "可以找我", pattern: "ring", className: "s-work", color: "var(--st-work)", workLike: true },
  busy: { id: "busy", label: "勿扰", screen: "请勿打扰", hint: "非紧急请稍后", pattern: "solid", className: "s-busy", color: "var(--st-busy)", workLike: true },
  focus: { id: "focus", label: "专注中", screen: "专注中", hint: "专注计时中", pattern: "half", className: "s-focus", color: "var(--st-focus)", workLike: true },
  meet: { id: "meet", label: "会议中", screen: "会议中", hint: "正在开会", pattern: "hatch", className: "s-meet", color: "var(--st-meet)", workLike: false },
  rest: { id: "rest", label: "休息中", screen: "休息一下", hint: "稍后回来", pattern: "dots", className: "s-rest", color: "var(--st-rest)", workLike: false },
  off: { id: "off", label: "已下班", screen: "已收工", hint: "明天见", pattern: "moon", className: "s-off", color: "var(--st-off)", workLike: false },
};

export const STATUS_ORDER: StatusId[] = ["work", "busy", "focus", "meet", "rest", "off"];

// ===== 自定义状态注册表：设备 stdefs 快照的镜像（customStatuses），AppStore 调用 setCustomStatusDefs =====
let customDefs: Record<string, CustomStatusDef> = {};
export function setCustomStatusDefs(list: CustomStatusDef[]) {
  customDefs = Object.fromEntries(list.map((d) => [d.id, d]));
}
export function customStatusDefs(): CustomStatusDef[] { return Object.values(customDefs); }
/** 状态是否有效（内建或已注册的自定义）。计划表节点引用失效状态时该表不可启用 */
export function isKnownStatus(id: StatusId): boolean { return !!STATUSES[id] || !!customDefs[id]; }

// ===== 名字缓存：见过的状态定义即使被删，历史回顾里仍按名字/颜色展示（历史是记录，不随定义删除） =====
let nameCache: Record<string, { name: string; color: string }> = {};
export function cacheStatusNames(list: CustomStatusDef[]) {
  for (const d of list) nameCache[d.id] = { name: d.name, color: d.color };
}
export function statusNameCache(): Record<string, { name: string; color: string }> { return nameCache; }
export function loadStatusNameCache(map: Record<string, { name: string; color: string }>) { nameCache = { ...map }; }

/** 全部状态 id：内建 6 个在前 + 设备自定义在后（自定义不参与设备按键循环"off"规则之外的约束） */
export function allStatusIds(): StatusId[] { return [...STATUS_ORDER, ...Object.keys(customDefs)]; }
/** 状态元数据统一入口：内建 → 自定义 → 已删除的名字缓存 → 未知兜底（灰色，防崩溃） */
export function statusMeta(id: StatusId): StatusMeta {
  const b = STATUSES[id];
  if (b) return b;
  const c = customDefs[id];
  if (c) return { id, label: c.name, screen: c.name, hint: c.hint ?? "", pattern: "solid", className: "s-custom", color: c.color, workLike: c.workLike };
  const g = nameCache[id];
  if (g) return { id, label: g.name, screen: g.name, hint: "该状态已删除", pattern: "solid", className: "s-custom", color: g.color, workLike: false };
  return { id, label: id, screen: id, hint: "该状态已删除", pattern: "solid", className: "s-custom", color: "var(--ink-3)", workLike: false };
}
/** status() host API 下标：内建 0-5，自定义 6+i（与固件 m3_status 一致） */
export function statusApiIndex(id: StatusId): number {
  const i = STATUS_ORDER.indexOf(id);
  if (i >= 0) return i;
  const ci = Object.keys(customDefs).indexOf(id);
  return ci >= 0 ? STATUS_ORDER.length + ci : 0;
}

export const keyActionLabel = (a: KeyAction): string =>
  a === "offwork" ? "收工" : a === "focus25" ? "专注 25′" : a === "pauseToday" ? "暂停/恢复计划"
    : a === "cycleL" ? "上一个状态" : a === "cycleR" ? "下一个状态" : statusMeta(a).label;

export const SOURCE_LABEL: Record<StatusSource, string> = {
  manual: "网页手动切换",
  touch: "设备触摸区",
  shortcut: "实体快捷键",
  schedule: "计划表",
  timer: "倒计时",
  agent: "Agent 联动",
  offwork: "收工",
  device: "设备本地切换",
};
