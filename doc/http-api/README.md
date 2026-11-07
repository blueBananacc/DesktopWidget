# 收工牌设备 HTTP API

设备与电脑/网页之间**唯一**的接口面。HTTP 在这里是报文格式与资源语义规范；传输走 BLE 或 USB 串口字节流（设备不跑 TCP/IP），电脑侧本地桥再把它暴露成真实 HTTP。

| 文件 | 内容 | 性质 |
|---|---|---|
| [tunnel.md](tunnel.md) | 字节流上的 HTTP/1.1 分帧、请求关联、事件流帧、错误体、通道参数 | 规范性 |
| [events.md](events.md) | 事件目录、订阅快照顺序、客户端义务 | 规范性 |
| [openapi/openapi.yaml](openapi/openapi.yaml) | 根文档：公共 schema、错误码、公共响应 | 规范性 |
| `openapi/<资源>.yaml` | 按资源拆分的片段：`tags` / `paths` / `schemas` 三段 | 规范性 |
| `website/public/openapi.json` | 打包产物（网页调试页、本地桥 `/openapi.json` 使用） | 生成物，勿手改 |

## 实现位置

| 角色 | 代码 |
|---|---|
| 设备端解析器 + 路由表 | `firmware/shougongpai/shougongpai.ino` 「HTTP 隧道」段（`HTTP_ROUTES` 表） |
| 网页 codec / 客户端 / 类型化 API | `website/src/device/http/{codec,client}.ts`、`website/src/device/api.ts` |
| 网页字节通道（BLE / 串口 / 模拟设备） | `website/src/device/http/{bleLink,serialLink,mockLink,mockDevice}.ts` |
| 网页调试页 | `website/src/pages/ApiDebug.tsx`（AppShell 内 `/api` 路由） |
| 电脑侧本地桥 | `bridge/bridge.mjs`（127.0.0.1:8787 真 HTTP + SSE → 串口隧道） |

**模拟设备必须实现与固件相同的路由表**，网页在没有硬件时走的是同一套 codec 与客户端。

## 约定

### 路径与方法

- 全部路径以 `/api/` 开头，资源名用小写复数（`/api/todos`），单例资源用单数（`/api/led`）。
- `GET` 读、`PUT` 整体写入（新建或替换）、`PATCH` 部分更新（省略字段保持不变）、`POST` 创建或动作（`/start`、`/cancel`、`/activate`）、`DELETE` 删除。
- 动作类子路径用动词（`/api/timer/start`）；静态段优先于 `{id}` 匹配，静态段名即保留 id。
- 新建时设备分配 id 用 `POST /api/<集合>` 并返回 `CreatedResponse`；客户端自带 id 用 `PUT /api/<集合>/{id}`。

### 请求与响应

- 写接口成功只回 `SuccessResponse` / `CreatedResponse`，**不回资源快照**——变化统一以快照事件广播。
- 读接口的资源对象**必须**带 `type` 判别字段，且与同名事件的 `data` 结构一致；新增资源时两者用同一个 schema。
- 错误一律 `{error, error_code}`；新增 `error_code` 先加进 `openapi.yaml` 的 `ErrorCode` 枚举，再在固件和模拟设备里使用。
- 字符串上限按设备缓冲区计，单位是 **UTF-8 字节**，用扩展字段 `x-max-bytes` 标注（不用 `maxLength`，后者按字符计）；超出部分设备截断。
- 布尔字段不用 0/1，时间一律 epoch 毫秒（`*Ms` 为相对时长）。

### 版本

- `info.version` 即 API 语义版本，与固件常量 `API_SEMVER`、网页 `API_SEMVER` 同步修改。
- 新增可选字段、新增接口：minor +1；修改字段含义、删除接口或字段：major +1（设备对主版本不符的 `X-Api-Sem-Ver` 返回 400）。

### 隐私

- 共享看板相关接口只暴露**当前状态**，不得新增携带历史、待办、计划表内容的共享字段（PRD 3.7）。
- ESP-NOW 广播是明文，不得用于传输需要保密的信息。

## 新增一个接口的步骤

1. 在对应 `openapi/<资源>.yaml` 写 `paths` 与 `schemas`（新资源则新建片段文件并写 `tags`）。
2. `cd website && npm run openapi` 重新打包（重复的 path/schema/operationId、无法解析的 `$ref` 会直接报错）。
3. 固件路由表加一行 `{方法, 路径模式, 处理函数}`，处理函数只做参数校验和调用既有逻辑。
4. 模拟设备 `http/mockDevice.ts` 路由表加同一行。
5. `website/src/device/api.ts` 加类型化方法；有新事件时同步 `protocol.ts` 的 `DeviceEvent` 联合类型与 [events.md](events.md)。
6. 验证：`npm run build`（含 `openapi --check`）、`arduino-cli compile`，并在 `/sgp/api` 调试页对模拟设备和真机各调一次。
