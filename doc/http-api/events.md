# 事件目录（GET /api/events）

事件流的分帧方式见 [tunnel.md §6](tunnel.md#6-事件流)。每个事件帧的报文体是一个 SSE 事件：

```
event: <名称>
data: <JSON，含 "type": "<名称>">
```

`data` 结构与对应读接口返回体**完全相同**（例如 `keys` 事件 = `GET /api/keys` 的响应体），字段定义以
[openapi/](openapi/) 的 schema 为准，本文只说明**何时发送**。

## 1. 原则

- **设备是事实源**：快照类事件（`keys`、`led`、`schedules`…）总是整份资源，客户端整表替换镜像，不做增量合并。
- **写操作不回快照**：写接口只回 `{"result":"OK"}` 或错误；资源变化统一以快照事件广播给所有订阅通道（包括发起写操作的通道）。
- **请求内的业务错误走 HTTP 状态码**；只有设备自主运行中产生的错误才以 `*Err` 事件出现。

## 2. 订阅快照

订阅建立后设备按以下顺序推送全量快照（客户端可据此判断“设备真值已到齐”）：

| 顺序 | 事件 | 对应读接口 |
|---|---|---|
| 1 | `hello` | `GET /api/version`（`{type,name,firmware}`） |
| 2 | `state` | `GET /api/state` |
| 3 | `breakState` | `GET /api/break` |
| 4 | `apps` | `GET /api/apps` |
| 5 | `todos` | `GET /api/todos` |
| 6 | `schedules` | `GET /api/schedules` |
| 7 | `stdefs` | `GET /api/stdefs` |
| 8 | `keys` | `GET /api/keys` |
| 9 | `led` | `GET /api/led` |
| 10 | `timerCfg` | `GET /api/timer/config` |
| 11 | `timer` | `GET /api/timer` |
| 12 | `share` | `GET /api/share` |
| 13 | `peers` | `GET /api/peers` |
| 14 | `segments{phase:begin}` → `seg`×N → `segments{phase:end}` | `GET /api/segments`（设备校时后约 2 s 内） |

设备未校时时第 14 步延后到收到 `PUT /api/time` 之后；客户端**应当**在订阅后立即校时。

## 3. 事件一览

| 事件 | 触发时机 | 说明 |
|---|---|---|
| `hello` | 订阅快照第 1 帧 | 设备名、固件版本 |
| `state` | 状态快照第 2 帧；任何状态/屏显字段提交后 | 快照：`status/screen/sub/layout/led/brightness`。触发源：`PUT /api/state`、`PATCH /api/led`（改快照内字段）、本地按键/计划表切换 |
| `key` | K1–K4 实体键触发 | `k`=1–4；映射为 `offwork` 的键按住 1.5 s 才发 |
| `touch` | TTP223 触摸键触发 | 动作由 `keys.t` 映射决定 |
| `timer` | 旋钮选择/启动/到点/取消；运行中每秒 | `st`=`idle\|select\|run\|done`，`remain` 毫秒 |
| `timerCfg` | 旋钮配置改变 | 快照 |
| `breakState` | 休息提醒到点（`due:true`）、配置改变、每 10 s 心跳 | 快照；心跳兼作链路活性 |
| `wantTime` | 设备未校时每 10 s、已校时每 10 min | 客户端回 `PUT /api/time` |
| `segments` / `seg` | 状态切换后约 2 s、每 10 min 兜底 | `begin` 清空 → 逐段 `seg` → `end` 一次性替换 |
| `apps` | 屏幕程序安装/删除、自定义状态删除 | 快照 |
| `appErr` | 屏幕程序 trap 或加载失败 | 设备已回默认屏 |
| `todos` | 待办增删改、到点触发、跨天清理 | 快照 |
| `todoFired` | 定时到点或进入 `off` 收工触发 | `ids` 为触发的待办 |
| `schedules` | 计划表增删改/启用/暂停/模式切换、跨天 | 快照 |
| `stdefs` | 自定义状态增删改 | 快照 |
| `keys` / `led` / `share` | 对应设置改变 | 快照 |
| `peers` | ESP-NOW 成员表变化；有成员时每 30 s | 快照，成员 10 min 未听到即移除 |
| `sttState` | 录音开始/结束/出错 | `ms` 已录时长 |
| `aud` | 录音中约 68 帧/秒 | IMA-ADPCM 帧（base64），帧内自带解码状态 |
| `agentReq` | 设备 agent 循环需要 LLM | 客户端调 LLM 后回 `POST /api/agent/response` |
| `agentDone` / `agentErr` | agent 循环结束 / 中止 | `agentErr.msg`=`timeout\|disconnected\|cancelled\|bad_response` |
| `schedErr` / `stdefErr` | 仅在非请求上下文产生的错误 | 请求内错误改走 HTTP 状态码 |

## 4. 客户端义务

1. 收到 `wantTime` **必须**尽快 `PUT /api/time`。
2. 收到 `agentReq` **应当**在 30 s 内回 `POST /api/agent/response`，否则设备以 `agentErr{timeout}` 收尾。
3. 15 s 内没有任何帧（含 10 s 一次的 `breakState` 心跳）**应当**判定链路失效并重连。
