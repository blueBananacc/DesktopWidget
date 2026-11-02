import type { KeyAction, LedMode, StatusId } from "../domain/types";

/**
 * 网页 ⇄ 收工牌 通信协议草案（JSON，UTF-8）。
 * 字段需与固件对齐后再定稿；BLE 下单条消息过长时由传输层分包。
 */
export type OutboundMessage =
  | { type: "state"; status: StatusId; screen: string; sub: string; until?: number; led: LedMode; brightness: number; ts: number }
  | { type: "schedule"; kind: "repeat" | "date"; weekdays?: number[]; date?: string; nodes: { time: string; status: StatusId }[]; override?: { date: string; nodes: { time: string; status: StatusId }[] }; paused: boolean; mode: "next" | "today"; ts: number } // 设备自治执行：repeat 按 weekdays，date 按单日；override=当日单日计划（优先于主表，跨天自动失效）；mode=手动干预后何时恢复
  | { type: "time"; epoch: number; tzOffsetMin: number }
  | { type: "break"; minutes: number; enabled: boolean; offToday: boolean; accumMs?: number } // 休息提醒设置；accumMs 仅在明确要求重置时携带，设备保持计时权威
  | { type: "keys"; k1: KeyAction; k2: KeyAction; k3: KeyAction; k4: KeyAction; ts: number } // 按键映射下发；设备离线时按此执行（K1 仍需按住 1.5s）
  | { type: "sync" }; // 握手：固件回 hello

export type InboundMessage =
  | { type: "touch"; zone: "left" | "right" }
  | { type: "shortcut"; press: "single" | "long" }
  | { type: "offworkKey" }
  | { type: "knob"; minutes: number }
  | { type: "breakState"; minutes: number; accumMs: number; enabled: boolean; offToday: boolean; due: boolean }
  | { type: "wantTime" } // 设备未校时（如中途重启）主动请求 time
  | { type: "segments"; phase: "begin" | "end" } // 今日状态区间全量推送的起止帧
  | { type: "seg"; status: StatusId; start: number; end?: number } // 单个区间；end 缺省 = 进行中
  | { type: "hello"; name: string; firmware: string };

export interface DeviceTransport {
  readonly kind: "mock" | "ble" | "serial";
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  onMessage(cb: (msg: InboundMessage) => void): void;
  onDisconnect(cb: () => void): void;
}

/** GATT UUID 占位，需与固件约定后替换 */
export const BLE_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const BLE_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // 网页 → 设备（write）
export const BLE_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // 设备 → 网页（notify）
export const BLE_NAME_PREFIX = "Shougong";
