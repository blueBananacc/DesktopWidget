import type { KeyAction, LedMode, ScreenLayout, StatusId } from "../domain/types";

/**
 * 网页 ⇄ 收工牌 通信协议草案（JSON，UTF-8）。
 * 字段需与固件对齐后再定稿；BLE 下单条消息过长时由传输层分包。
 */
export type OutboundMessage =
  | { type: "state"; status: StatusId; screen: string; sub: string; until?: number; led?: LedMode; brightness?: number; layout: ScreenLayout; ts: number } // led/brightness 可选（灯效事实源在设备 /led.json，缺失时设备按本地配置）；layout 只作用于默认屏，设备持久保存
  | { type: "sched"; op: "set"; id?: string; name: string; kind: "repeat" | "date"; wd?: number[]; date?: string; ns: { t: string; st: StatusId; n?: string }[] } // 计划表整张 upsert（事实源在设备 /schedules.json；id 缺省=设备分配）
  | { type: "sched"; op: "del" | "use"; id: string }   // 删表 / 设为当前启用的重复计划
  | { type: "sched"; op: "pause"; paused: boolean }    // 今日暂停/恢复（只影响当天，跨天自动失效）
  | { type: "sched"; op: "mode"; mode: "next" | "today" } // 手动干预后恢复策略
  | { type: "sched"; op: "list" }                      // 请求设备回 schedules（hello 后设备也主动推）
  | { type: "stdef"; op: "set"; id?: string; zh: string; hint?: string; c: number; work?: boolean } // 自定义状态 upsert（事实源在设备 /stdefs.json；id 缺省=设备分配 c<N>，≤7 字符；c=0xRRGGBB）
  | { type: "stdef"; op: "del"; id: string }           // 删除自定义状态：连带清它的自定义屏幕；正在使用则设备退回 work
  | { type: "stdef"; op: "list" }                      // 请求设备回 stdefs（hello 后设备也主动推）
  | { type: "time"; epoch: number; tzOffsetMin: number }
  | { type: "break"; minutes: number; enabled: boolean; offToday: boolean; accumMs?: number } // 休息提醒设置；accumMs 仅在明确要求重置时携带，设备保持计时权威
  | { type: "keys"; k1: KeyAction; k2: KeyAction; k3: KeyAction; k4: KeyAction; ts: number } // 按键映射写入设备 /keys.json（K1 仍需按住 1.5s）；设备持久化后回 keys 快照
  | { type: "led"; op: "set"; map?: Record<string, LedMode>; br?: number; night?: boolean } // 灯效写入设备 /led.json：map=每状态档位，br=亮度，night=夜间自动关；设备持久化后回 led 快照
  | { type: "reminder"; text?: string; count?: number; ts: number } // 提醒触发：text 仅当用户允许上屏时携带；设备 OLED 显示 + RGB 闪烁，任意按键确认
  | { type: "app"; op: "begin"; status: string; size: number } // 按状态上传自定义屏幕：.wasm 写入 LittleFS /app_<status>.wasm（持久，断电不丢）
  | { type: "app"; op: "chunk"; data: string } // wasm 二进制 base64 分片（≤~1KB 解码数据/条），按序追加
  | { type: "app"; op: "run" } // 收尾：收齐落盘；上传的是当前状态则立即重载执行（wasm3 沙箱）
  | { type: "app"; op: "stop" } // 停掉当前 app 回默认屏
  | { type: "app"; op: "clear"; status: string } // 删除某状态的自定义屏幕（含被禁用的 .bad），恢复默认显示
  | { type: "app"; op: "list" } // 请求设备回 apps 清单（hello / run / clear 后设备也会主动上报）
  | { type: "app"; op: "dump"; status: string } // 把设备上的 wasm 读回来（appData 分片），网页用它渲染"设备上的实际程序"
  | { type: "stt"; op: "start" } // 让设备开始录音并按 aud 帧上行（codec 见 sttState.codec）
  | { type: "stt"; op: "stop" }  // 停止录音；设备回 sttState idle 作收尾
  | { type: "sttResult"; text: string } // ASR 结果回传设备 → 触发设备端 agent 循环（v0.7 起）
  | { type: "agentRes"; message: AgentMessage } // 网页代理 LLM 的结果回设备（assistant 消息，含 tool_calls 时设备继续循环）
  | { type: "agent"; op: "cancel" } // 中止设备上进行中的 agent 循环
  | { type: "todo"; op: "add"; text: string; at?: number; trig?: "offwork"; show?: boolean; src?: string } // 网页→设备建待办（at=epoch ms；trig=offwork 收工触发；show=false 触发时只报数量；src=来源标记）
  | { type: "todo"; op: "set"; id: string; text?: string; at?: number; trig?: "offwork" | "at"; show?: boolean; done?: boolean } // 部分更新（编辑；at=-1 清定时）
  | { type: "todo"; op: "done"; id: string; done?: boolean }
  | { type: "todo"; op: "del"; id: string }
  | { type: "todo"; op: "clear" }
  | { type: "todo"; op: "list" } // 请求设备回 todos（hello 后设备也主动推）
  | { type: "sync" }; // 握手：固件回 hello

/** OpenAI 消息对象：assistant 消息可带 tool_calls；tool 消息带 tool_call_id（与设备 agent 循环一致） */
export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export type InboundMessage =
  | { type: "touch"; zone: "left" | "right" }
  | { type: "shortcut"; press: "single" | "long" }
  | { type: "offworkKey" }
  | { type: "knob"; minutes: number }
  | { type: "breakState"; minutes: number; accumMs: number; enabled: boolean; offToday: boolean; due: boolean }
  | { type: "wantTime" } // 设备未校时（如中途重启）主动请求 time
  | { type: "segments"; phase: "begin" | "end" } // 今日状态区间全量推送的起止帧
  | { type: "seg"; status: StatusId; start: number; end?: number } // 单个区间；end 缺省 = 进行中
  | { type: "hello"; name: string; firmware: string }
  | { type: "apps"; list: { status: string; size: number; bad?: boolean }[] } // 设备上实际安装的自定义屏幕；bad=崩溃后被自动禁用
  | { type: "appErr"; status: string; msg: string } // app 运行 trap 或加载失败，设备已回默认屏
  | { type: "appData"; status: string; seq?: number; last: boolean; data?: string; missing?: boolean } // app dump 的读回分片（base64）；missing=设备上没有该状态的程序
  | { type: "sttState"; state: "recording" | "idle" | "error"; rate: number; codec: "adpcm" | "opus"; ms: number; msg?: string } // 录音状态：开始/结束/出错；ms=已录时长
  | { type: "aud"; seq: number; data: string } // 音频帧（base64）：帧内自带解码状态，丢帧只留缺口不糊后续；seq 检丢
  | { type: "agentReq"; round: number; msgs: AgentMessage[]; tools?: unknown[] } // 设备 agent 循环请求网页代理调 LLM（v0.7 起）
  | { type: "agentDone"; text: string } // agent 循环结束：最终回复（设备 OLED 同时上屏 8s）
  | { type: "agentErr"; msg: string }   // agent 中止：timeout/disconnected/cancelled/…
  | { type: "todos"; list: DeviceTodo[] } // 设备待办事实源（v0.7 起；hello 后/增删改/到点触发后推送）
  | { type: "todoFired"; ids: string[]; count: number } // 设备到点/收工触发了哪些待办（v0.8 起；与"用户手动完成"区分）
  | { type: "schedules"; act: string; paused: boolean; mode: "next" | "today"; list: DevSched[] } // 设备端计划表快照（v0.8 起；hello 后/ops 后推送）。act/paused 是设备执行态；list 与网页计划库做收敛合并
  | { type: "schedErr"; msg: string }
  | { type: "stdefs"; list: DevStdef[] }               // 设备自定义状态注册表快照（v0.9 起；hello 后/ops 后推送）。事实源在设备，网页整表替换镜像
  | { type: "stdefErr"; msg: string }
  | { type: "keys"; k1: string; k2: string; k3: string; k4: string } // 设备按键映射快照（v1.0 起；hello 后/keys 写入后推送）。事实源在设备 /keys.json
  | { type: "led"; map: Record<string, LedMode>; br: number; night: boolean } // 设备灯效设置快照（v1.0 起；hello 后/led 写入后推送）。事实源在设备 /led.json

/** 设备侧自定义状态（事实源在设备）：id ≤7 字符以 c 开头；zh=屏显名（wqy16 大字，建议≤4汉字）；c=0xRRGGBB；work=该状态计入工作时长/休息提醒 */
export interface DevStdef {
  id: string;
  zh: string;
  hint?: string;
  c: number;
  work?: boolean;
}

/** 设备待办（事实源在设备）：at=epoch ms；trig=offwork 收工触发；show=false 触发时只报数量；created=创建时刻；src=来源(voice/web) */
export interface DeviceTodo {
  id: string;
  at?: number;
  trig?: "offwork";
  text: string;
  show?: boolean;
  created?: number;
  src?: string;
  done: boolean;
}

/** 设备侧计划表（事实源）：kind=repeat 按 wd 星期位，kind=date 按单日；ns=节点（t=HH:MM，st=状态，n=备注） */
export interface DevSched {
  id: string;
  name: string;
  kind: "repeat" | "date";
  wd?: number[];
  date?: string;
  ns: { t: string; st: StatusId; n?: string }[];
}

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
