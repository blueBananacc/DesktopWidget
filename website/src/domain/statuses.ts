import type { KeyAction, StatusId, StatusSource } from "./types";

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

export const STATUSES: Record<StatusId, StatusMeta> = {
  work: { id: "work", label: "工作中", screen: "工作中", hint: "可以找我", pattern: "ring", className: "s-work", color: "var(--st-work)", workLike: true },
  busy: { id: "busy", label: "勿扰", screen: "请勿打扰", hint: "非紧急请稍后", pattern: "solid", className: "s-busy", color: "var(--st-busy)", workLike: true },
  focus: { id: "focus", label: "专注中", screen: "专注中", hint: "专注计时中", pattern: "half", className: "s-focus", color: "var(--st-focus)", workLike: true },
  meet: { id: "meet", label: "会议中", screen: "会议中", hint: "正在开会", pattern: "hatch", className: "s-meet", color: "var(--st-meet)", workLike: false },
  rest: { id: "rest", label: "休息中", screen: "休息一下", hint: "稍后回来", pattern: "dots", className: "s-rest", color: "var(--st-rest)", workLike: false },
  off: { id: "off", label: "已下班", screen: "已收工", hint: "明天见", pattern: "moon", className: "s-off", color: "var(--st-off)", workLike: false },
};

export const STATUS_ORDER: StatusId[] = ["work", "busy", "focus", "meet", "rest", "off"];

export const keyActionLabel = (a: KeyAction): string =>
  a === "offwork" ? "收工" : a === "focus25" ? "专注 25′" : STATUSES[a].label;

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
