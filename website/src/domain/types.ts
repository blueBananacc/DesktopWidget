export type StatusId = "work" | "busy" | "focus" | "meet" | "rest" | "off";

export type StatusSource = "manual" | "touch" | "shortcut" | "schedule" | "timer" | "agent" | "offwork" | "device";

export interface CurrentStatus {
  id: StatusId;
  source: StatusSource;
  since: number;
  until?: number;
  note?: string;
}

export type OverrideMode = "untilNextNode" | "pauseToday";

export interface ScheduleNode {
  id: string;
  time: string; // HH:mm
  status: StatusId;
  note?: string;
}

export interface Schedule {
  id: string;
  name: string;
  kind: "repeat" | "date";
  weekdays: number[]; // 0=Sun … 6=Sat, for repeat
  date?: string; // YYYY-MM-DD, for date
  nodes: ScheduleNode[];
}

export type ReminderTrigger = "time" | "afterOffwork";

export interface Reminder {
  id: string;
  title: string;
  detail?: string;
  trigger: ReminderTrigger;
  at?: string; // HH:mm when trigger === "time"
  day: string; // YYYY-MM-DD 归属日；早于今天 = 昨天遗留
  firedAt?: number; // 已触发提醒的时刻；延后时清除以便重新触发
  showOnDevice: boolean; // 允许正文上屏
  deviceText?: string; // 设备屏上实际显示的文字；留空时默认显示标题
  createdBy: "manual" | "voice";
  done: boolean;
}

export interface StatusSegment {
  status: StatusId;
  source: StatusSource;
  start: number;
  end?: number;
}

export interface Member {
  id: string;
  name: string;
  status?: StatusId;
  until?: string;
  via: "espnow" | "gateway" | "self";
  updatedAt: number;
}

export type ConnectionKind = "none" | "mock" | "ble" | "serial";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface DeviceInfo {
  name: string;
  kind: ConnectionKind;
  state: ConnectionState;
  lastSyncAt?: number;
  pending: number;
}

export type LedMode = "solid" | "breath" | "off";

/** 实体按键动作：收工流程 / 25 分钟专注 / 暂停或恢复今日计划 / 直接切换状态 */
export type KeyAction = "offwork" | "focus25" | "pauseToday" | StatusId;

export interface KeyMap {
  k1: KeyAction; // 收工键
  k2: KeyAction; // 快捷键
  k3: KeyAction; // 触摸区·左
  k4: KeyAction; // 触摸区·右
}

export interface Settings {
  overrideMode: OverrideMode;
  breakEnabled: boolean;
  breakMinutes: number;
  breakOptions: number[];
  ledBrightness: number;
  ledNightOff: boolean;
  led: Record<StatusId, LedMode>;
  keys: KeyMap;
  deviceName: string;
  knobStep: number;
  knobMax: number;
  shareEnabled: boolean;
  showReminderOnDevice: boolean;
  agentEnabled: boolean;
  phoneDnd: Partial<Record<StatusId, boolean>>;
  staleMinutes: number;
  screenLayout: "large" | "withTime" | "minimal";
}

export type AgentState = "idle" | "running" | "needsInput" | "done" | "error";
