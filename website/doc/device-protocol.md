# 网页 ⇄ 设备通信

**接口规范在 `../doc/http-api/`**：传输分帧 → [tunnel.md](../../doc/http-api/tunnel.md)、事件目录 → [events.md](../../doc/http-api/events.md)、资源与方法 → [openapi/](../../doc/http-api/openapi/)（打包产物 `public/openapi.json`，`npm run openapi` 重新生成）。本文只讲网页侧实现结构与设备行为语义，不再重复规范内容。

代码在 `src/device/`：

- `protocol.ts`：`DeviceEvent`（= `InboundMessage`）事件类型、BLE UUID 常量。事件结构与 events.md 一一对应
- `http/codec.ts`：HTTP/1.1 报文编解码（请求/响应帧、`Content-Length` 分帧、增量解析、SSE 编解码），容忍帧间杂散日志字节
- `http/link.ts`：`ByteLink` 接口——`open/openGranted/close/write/onData/onClose`，纯字节通道抽象
- `http/client.ts`：`TunnelClient`——请求关联（`X-Request-Id`）、写串行化、超时、`/api/events` SSE 订阅分发、原始帧 tap（调试页用）、`API_SEMVER` 常量
- `http/api.ts`：`DeviceApi`——按 OpenAPI 每个 operation 一个类型化方法
- `http/serialLink.ts` / `bleLink.ts`：Web Serial（460800）与 Web Bluetooth（NUS 风格 UUID，TX notify/RX write，200B 分片）两条字节通道
- `http/mockDevice.ts` + `mockLink.ts`：**字节级**模拟设备——实现与固件相同的路由表（含校验、事件流、自治行为），没硬件时网页走同一套 codec/客户端
- `app.ts`：wasm 自定义屏幕的上传/取回/哈希（`PUT/GET/DELETE /api/apps/{status}`，二进制 body）
- `audio.ts`：`aud` 事件的 IMA-ADPCM 解码

## 链路形态

```
网页业务（AppStore） ──DeviceApi 方法──► TunnelClient ──HTTP 报文字节──► ByteLink
                                        ▲                                │ BLE notify / 串口
                       DeviceEvent ◄── subscribe("/api/events") ◄── 设备事件帧（SSE body）
```

- **设备是事实源**：订阅后设备按 events.md §2 顺序推全量快照（hello → state → breakState → … → peers → segments），网页整表替换各处镜像，不做增量合并
- **写操作不回快照**：`PUT/PATCH/POST` 只回 `{"result":"OK"}` 或错误；变化（含自己发起的）统一由快照事件广播回来
- 时间同步：收到 `wantTime` 事件 → `PUT /api/time`；连接时 `sendSnapshot` 也会校时
- 活性：任何上行帧刷新 `lastInboundAt`；15s 无帧判定链路死（设备有 10s `breakState`/`wantTime` 心跳）
- 电脑侧脚本/Agent 不直连 BLE/串口，用 `code/bridge/`（真 HTTP + SSE → 串口隧道）；同一时间串口只能被一个程序占用

## 设备端事件映射

| 输入 | 上报事件 | 网页响应 |
|---|---|---|
| K1–K4 实体键（GPIO17/16/15/7） | `key{k:1–4}` | 按 keys.k1–k4 映射执行：状态切换 / 专注 25′ / 暂停计划 / 状态循环；**映射为 offwork 的键需按住 1.5s 才触发**（离线同规则） |
| TTP223 触摸键（GPIO4，触摸抬起触发） | `touch` | 按 keys.t 映射执行（默认 rest） |
| K1–K4 中必须保留一个 offwork——设备与网页双层校验，拒绝非法写入（422 `no_offwork`） | — | — |
| 网页为状态大脑：设备只报事件，显示文本由 `PUT /api/state` 的 `screen/sub` 决定；未连接时按键按 `/keys.json` 里持久化的映射本地执行（出厂默认 K1=收工、K2=请勿打扰、K3/K4=状态循环、触摸=休息），本地/计划表切换也会广播 `state` 快照 | | |

## 状态与区间（事实源在设备）

- `GET/PUT /api/state`：status+screen+sub+layout，led/brightness 可选（缺省按设备 /led.json 持久配置；携带则当次覆盖显示不回写）。任何提交（写入、本地按键、计划表节点）都广播 `state` 快照
- 状态区间：设备自开机记录（≤96 段），`segments{begin}→seg×N→{end}` 事件推送——校时后约 2s 内、每 10 分钟兜底；校时前不推。网页收到 `{end}` 后**整表替换** `segments` 与 `current`（source=`device`）
- **连接握手顺序（设备为准）**：网页连上即 `GET /api/events` 订阅 → 设备推快照序列 → 网页等设备区间（`segments{end}`）采纳后，才恢复在快照中携带 `state`（`awaitAdoptionRef`）。采纳完成前网页本地状态变更不下发，避免旧状态覆盖设备
- 今日区间持久化 `/segs.json`（推送顺带落盘，断电误差 ≤10min）；`off` 段使 `offworkToday` 置位

## 休息提醒（设备自治）

- 设备按当前状态累计工作类时长，到点 RGB 闪 + OLED 提醒 + `breakState{due:true}` 事件
- `PATCH /api/break`（minutes/enabled/offToday/accumMs）；设备回 `breakState` 快照，网页有未回执字段时暂扣本地值并重发（`breakPending` 收敛逻辑）
- 跨天自动清零；`offToday` 午夜后自动恢复

## 计划表 / 自定义状态 / 待办 / 设置（事实源全在设备）

- 计划表 `/api/schedules*`：≤8 张、每张 ≤20 节点；设备自推今日生效表（单日 > 启用重复表）；`paused`/`mode` 为执行态；**今天进入过 off 即视今日计划完成**；含已删状态的表不可启用（422 `bad_status`），生效中遇失效节点到点跳过
- 自定义状态 `/api/stdefs*`：≤8 个（id=`c`+1-6 位小写，zh 屏显名，c=0xRRGGBB，work=计工时）；删除连带清 wasm 屏、正在使用则退回 work
- 待办 `/api/todos*` + 提醒 `POST /api/reminders`：设备到点自治触发（`todoFired`）
- 按键映射 `PUT /api/keys`、灯效 `PATCH /api/led`、旋钮配置 `PATCH /api/timer/config`、分享 `PATCH /api/share`：全部 /keys.json /led.json /knob.json /share.json 持久，写后推对应快照事件
- 全部字段上限按设备缓冲区计 **UTF-8 字节**（OpenAPI `x-max-bytes`）

## WASM 自定义屏幕

- `PUT /api/apps/{status}` 传**二进制** wasm（`application/octet-stream`，魔数 `\0asm` 校验，≤48KiB）；`GET` 取回；`DELETE` 清除；`POST /api/apps/stop` 停播
- `apps` 快照报已装清单（status/size/bad=崩溃禁用）；`appErr` 事件报 trap；spec：`../doc/wasm-screens.md`

## 语音与设备 Agent

- `POST /api/stt/start|stop` 起停 I2S 采音 → `aud` 事件上行 IMA-ADPCM 帧（16kHz，~68fps，帧自洽）→ 网页解码 POST 到用户配置的 ASR；`sttState` 报状态；60s 自动收尾、断连即停
- `POST /api/stt/result{text}` → 设备跑 agent 循环（`agentReq` 事件带 msgs+tools → 网页代理调 LLM → `POST /api/agent/response` 回填 assistant 消息 → 设备执行 tool_calls，≤4 轮、每轮 30s）；`POST /api/agent/cancel` 中止；`agentDone/agentErr` 收尾

## 共享看板：ESP-NOW 设备↔设备

- 同区域设备 ESP-NOW 局域网广播互通（STA、信道1、FF:FF:FF:FF:FF:FF）；浏览器收不到 ESP-NOW，**连接到网页的设备兼任网关**把成员表经 `peers` 事件转发
- 广播包 `{sgp:1,i,n,z,st,t}`：MAC 尾 id/昵称/区域码/**仅当前状态**/校时戳；只共享当前状态
- `GET /api/peers` 成员表、`PATCH /api/share` 开关/昵称/区域码（`/share.json` 持久，en 默认 false 不广播）；成员 10min 未听到剔除
- ESP-NOW 明文广播，只作同房间信标

## 接入约束

- Web Bluetooth 需 HTTPS 或 localhost、Chrome/Edge、用户手势触发；iOS Safari 不可用；Web Serial 同限制
- 新增通道只需实现 `ByteLink`（`http/link.ts`），页面不感知
- **网页无法直接收 ESP-NOW**：同区域设备互见需指定网关设备转发
- 网页做不到、App 才能做的：手机静音联动、iOS 后台 BLE、系统日历访问、关页后的可靠提醒
