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
  /** 设备上报的已安装自定义屏幕（apps 消息）；undefined = 还没收到清单（未连接或旧固件） */
  apps?: Record<string, DeviceApp>;
  /** 最近一次设备端 app 运行失败（trap / 加载失败） */
  appErr?: { status: string; msg: string; at: number };
}

/** 设备 LittleFS 里某状态的 wasm：bad = 曾导致设备复位，已被自动禁用 */
export interface DeviceApp { size: number; bad?: boolean }

/** 默认屏布局（固件真实支持的三种）：完整 = 状态+时间+说明；clock = 状态+时间；status = 仅状态 */
export type ScreenLayout = "full" | "clock" | "status";

export type LedMode = "solid" | "breath" | "off";

/** 实体按键动作：收工流程 / 25 分钟专注 / 暂停或恢复今日计划 / 直接切换状态 */
export type KeyAction = "offwork" | "focus25" | "pauseToday" | StatusId;

export interface KeyMap {
  k1: KeyAction; // 收工键
  k2: KeyAction; // 快捷键
  k3: KeyAction; // 触摸区·左
  k4: KeyAction; // 触摸区·右
}

/** 自定义屏幕来源：wat = 页面里编辑的 WAT 源码（wabt 编译上传）；wasm = 直接上传的预编译二进制（base64）。wat 的 name/desc 是用户给这个"屏幕块"起的展示名和一句话描述 */
export type ScreenDef =
  | { kind: "wat"; src: string; name?: string; desc?: string }
  | { kind: "wasm"; b64: string; name?: string };

/** 用户保存的自定义屏幕块：在任何状态的模板区都能选它复用 */
export interface ScreenPreset { id: string; name: string; desc: string; src: string }

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
  screenLayout: ScreenLayout;
  /** 按状态自定义屏幕：statusId -> WAT 源码或预编译 wasm；上传后设备按状态存 LittleFS，进入状态自动执行 */
  customScreens: Record<string, ScreenDef>;
  /** 用户存下的屏幕块（跨状态复用的个人模板） */
  screenPresets: ScreenPreset[];
}

export type AgentState = "idle" | "running" | "needsInput" | "done" | "error";
