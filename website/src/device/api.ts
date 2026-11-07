import type { KeyAction, LedMode, ScreenLayout, StatusId } from "../domain/types";
import type { TunnelClient } from "./http/client";
import type { AgentMessage, DevSched, DeviceEvent } from "./protocol";

/** 读接口返回体 = 同名事件的 data（events.md §1） */
type Snap<T extends DeviceEvent["type"]> = Extract<DeviceEvent, { type: T }>;

export interface Version { api_semver: string; firmware: string; name: string }
export interface StateWrite { status: StatusId; screen?: string; sub?: string; layout?: ScreenLayout; led?: LedMode; brightness?: number }
export type ScheduleWrite = Omit<DevSched, "id">;
export interface StdefWrite { zh: string; hint?: string; c: number; work?: boolean }
export interface TodoWrite { text: string; at?: number; trig?: "offwork"; show?: boolean; src?: string }
export interface TodoPatch { text?: string; at?: number; trig?: "offwork" | "at"; show?: boolean; done?: boolean }

const seg = (s: string) => encodeURIComponent(s);

/** 设备 HTTP API 的类型化封装：一个方法对应 doc/http-api/openapi 里的一个 operation */
export class DeviceApi {
  constructor(readonly http: TunnelClient) {}

  // ---- System ----
  version = () => this.http.json<Version>("GET", "/api/version", { timeoutMs: 1500 });

  // ---- State ----
  getState = () => this.http.json<{ type: "state"; status: StatusId; screen: string; sub: string; layout: ScreenLayout; led: LedMode; brightness: number }>("GET", "/api/state");
  putState = (body: StateWrite) => this.http.request("PUT", "/api/state", { json: body });
  getTime = () => this.http.json<{ type: "time"; synced: boolean; epoch: number; tzOffsetMin: number }>("GET", "/api/time");
  putTime = (epoch = Date.now(), tzOffsetMin = -new Date().getTimezoneOffset()) => this.http.request("PUT", "/api/time", { json: { epoch, tzOffsetMin } });
  getSegments = () => this.http.json<{ type: "segments"; list: Snap<"seg">[] }>("GET", "/api/segments");

  // ---- Break ----
  getBreak = () => this.http.json<Snap<"breakState">>("GET", "/api/break");
  patchBreak = (body: { minutes?: number; enabled?: boolean; offToday?: boolean; accumMs?: number }) => this.http.request("PATCH", "/api/break", { json: body });

  // ---- Schedules ----
  getSchedules = () => this.http.json<Snap<"schedules">>("GET", "/api/schedules");
  createSchedule = (body: ScheduleWrite) => this.http.json<{ result: "OK"; id: string }>("POST", "/api/schedules", { json: body });
  putSchedule = (id: string, body: ScheduleWrite) => this.http.request("PUT", `/api/schedules/${seg(id)}`, { json: body });
  deleteSchedule = (id: string) => this.http.request("DELETE", `/api/schedules/${seg(id)}`);
  activateSchedule = (id: string) => this.http.request("POST", `/api/schedules/${seg(id)}/activate`);
  scheduleControl = (body: { paused?: boolean; mode?: "next" | "today" }) => this.http.request("PATCH", "/api/schedules/control", { json: body });

  // ---- Statuses ----
  getStdefs = () => this.http.json<Snap<"stdefs">>("GET", "/api/stdefs");
  createStdef = (body: StdefWrite) => this.http.json<{ result: "OK"; id: string }>("POST", "/api/stdefs", { json: body });
  putStdef = (id: string, body: StdefWrite) => this.http.request("PUT", `/api/stdefs/${seg(id)}`, { json: body });
  deleteStdef = (id: string) => this.http.request("DELETE", `/api/stdefs/${seg(id)}`);

  // ---- Todos ----
  getTodos = () => this.http.json<Snap<"todos">>("GET", "/api/todos");
  createTodo = (body: TodoWrite) => this.http.json<{ result: "OK"; id: string }>("POST", "/api/todos", { json: body });
  patchTodo = (id: string, body: TodoPatch) => this.http.request("PATCH", `/api/todos/${seg(id)}`, { json: body });
  deleteTodo = (id: string) => this.http.request("DELETE", `/api/todos/${seg(id)}`);
  clearTodos = () => this.http.request("DELETE", "/api/todos");
  remind = (body: { text?: string; count?: number }) => this.http.request("POST", "/api/reminders", { json: body });

  // ---- Settings ----
  getKeys = () => this.http.json<Snap<"keys">>("GET", "/api/keys");
  putKeys = (body: { k1: KeyAction; k2: KeyAction; k3: KeyAction; k4: KeyAction; t?: KeyAction }) => this.http.request("PUT", "/api/keys", { json: body });
  getLed = () => this.http.json<Snap<"led">>("GET", "/api/led");
  patchLed = (body: { map?: Record<string, LedMode>; br?: number; night?: boolean }) => this.http.request("PATCH", "/api/led", { json: body });
  getTimer = () => this.http.json<Snap<"timer">>("GET", "/api/timer");
  startTimer = (minutes: number) => this.http.request("POST", "/api/timer/start", { json: { minutes } });
  cancelTimer = () => this.http.request("POST", "/api/timer/cancel");
  getTimerConfig = () => this.http.json<Snap<"timerCfg">>("GET", "/api/timer/config");
  patchTimerConfig = (body: { step?: number; max?: number }) => this.http.request("PATCH", "/api/timer/config", { json: body });

  // ---- Board ----
  getShare = () => this.http.json<Snap<"share">>("GET", "/api/share");
  patchShare = (body: { en?: boolean; name?: string; zone?: string }) => this.http.request("PATCH", "/api/share", { json: body });
  getPeers = () => this.http.json<Snap<"peers">>("GET", "/api/peers");

  // ---- Screens ----
  getApps = () => this.http.json<Snap<"apps">>("GET", "/api/apps");
  getApp = async (status: string) => (await this.http.request("GET", `/api/apps/${seg(status)}`, { timeoutMs: 30000 })).body;
  putApp = (status: string, wasm: Uint8Array, onProgress?: (r: number) => void) =>
    this.http.request("PUT", `/api/apps/${seg(status)}`, { bytes: wasm, contentType: "application/octet-stream", timeoutMs: 60000, onProgress });
  deleteApp = (status: string) => this.http.request("DELETE", `/api/apps/${seg(status)}`);
  stopApp = () => this.http.request("POST", "/api/apps/stop");

  // ---- Voice ----
  sttStart = () => this.http.request("POST", "/api/stt/start");
  sttStop = () => this.http.request("POST", "/api/stt/stop");
  sttResult = (text: string) => this.http.request("POST", "/api/stt/result", { json: { text } });
  agentRespond = (message: AgentMessage) => this.http.request("POST", "/api/agent/response", { json: { message } });
  agentCancel = () => this.http.request("POST", "/api/agent/cancel");
}
