# SGP-HTTP 隧道传输规范（v1）

本文件是**规范性文档**：定义收工牌如何在 **BLE / USB 串口这类无 IP 的字节流**，以及 **USB 网卡 TCP socket** 上承载 HTTP/1.1 报文。
接口本身（路径、方法、请求体、响应体）见 [openapi/](openapi/)；设备主动推送的事件目录见 [events.md](events.md)。

关键词 **必须 / 不得 / 应当 / 可以** 分别对应 RFC 2119 的 MUST / MUST NOT / SHOULD / MAY。

## 1. 分层

```
┌──────────────────────────────────────────────┐
│ 资源语义：OpenAPI（/api/keys、/api/led …）     │  ← openapi/*.yaml
├──────────────────────────────────────────────┤
│ 报文语法：HTTP/1.1 message（RFC 9112 子集）    │  ← 本文 §2–§4
├──────────────────────────────────────────────┤
│ 关联与复用：X-Request-Id、事件流帧              │  ← 本文 §5–§6
├──────────────────────────────────────────────┤
│ 字节通道：BLE NUS / USB 串口 / USB 网卡 TCP     │  ← 本文 §7
└──────────────────────────────────────────────┘
```

HTTP 在这里只是**报文格式与语义规范**，不依赖 TCP/IP、Wi-Fi 或 DNS——但 USB 网卡通道（§7）会经由真实 TCP/IP 承载同一报文。

## 2. 报文语法

1. 每条报文**必须**符合 HTTP/1.1 报文语法：起始行、零个或多个头部行、空行、可选报文体。
2. 发送方**必须**使用 CRLF 作为行结束；接收方**必须**同时接受裸 LF。
3. 起始行：
   - 请求：`<METHOD> <origin-form> HTTP/1.1`，`origin-form` **必须**以 `/api/` 开头，可带 `?query`。
   - 响应：`HTTP/1.1 <3 位状态码> <原因短语>`。
4. 支持的方法：`GET`、`PUT`、`PATCH`、`POST`、`DELETE`。其他方法返回 `405`。
5. 头部名大小写不敏感。`Host` 头**可以**省略（通道上只有一台设备），设备忽略其值。

## 3. 报文体与分帧

1. 报文边界**只**由 `Content-Length` 决定。有报文体的报文**必须**携带 `Content-Length`（字节数，非字符数）；没有该头视为长度 0。
2. **不得**使用 `Transfer-Encoding`（包括 chunked）。设备收到带 `Transfer-Encoding` 的请求返回 `400 bad_request`。
3. 媒体类型：

   | Content-Type | 用途 |
   |---|---|
   | `application/json`（UTF-8） | 一般请求体与响应体 |
   | `application/octet-stream` | 屏幕程序 `.wasm` 上传/读回 |
   | `text/event-stream` | 事件流帧（§6） |

   JSON 请求体缺少 `Content-Type` 时设备按 `application/json` 处理；类型不符返回 `415`。
4. 设备端上限（超出返回 `413 payload_too_large`，设备**必须**读完并丢弃超长报文体以保持同步）：

   | 项 | 上限 |
   |---|---|
   | 起始行 | 256 B |
   | 单个头部行 | 256 B |
   | 头部数量 | 16 |
   | `PUT /api/apps/{status}` 报文体 | 49152 B（48 KiB） |
   | 其他请求报文体 | 8192 B |

## 4. 状态码与错误体

成功写操作返回 `200` + `{"result":"OK"}`（创建类附带新 `id`）；读操作返回资源 JSON，资源对象含 `type` 判别字段，取值与对应事件名一致。

失败**必须**返回如下 JSON（与 BUSY Bar 等开放设备 API 的约定一致）：

```json
{ "error": "人类可读的说明", "error_code": "machine_readable_code" }
```

| 状态码 | 典型 `error_code` | 含义 |
|---|---|---|
| 400 | `bad_request` / `bad_json` / `invalid_parameter` / `incompatible_api_version` | 语法或参数错误 |
| 404 | `not_found` | 路径或资源 id 不存在 |
| 405 | `method_not_allowed` | 路径存在但不支持该方法 |
| 409 | `full` / `busy` / `not_waiting` | 与设备当前状态冲突（容量满、正忙） |
| 413 | `payload_too_large` | 超出 §3.4 上限 |
| 415 | `unsupported_media_type` | 报文体类型不符 |
| 422 | `no_offwork` / `bad_status` / `not_repeat` / `invalid_wasm` | 语法正确但违反业务规则 |
| 500 | `internal` / `mic_failed` / `storage` | 设备内部错误 |

错误码全集见 [openapi/openapi.yaml](openapi/openapi.yaml) 的 `ErrorCode` 枚举。

## 5. 请求关联（X-Request-Id）

1. 客户端**必须**在每个请求中携带 `X-Request-Id`，取值 1–24 个 `[A-Za-z0-9._-]` 字符，在同一通道的在途请求中唯一。
2. 设备**必须**在对应响应中原样回带该头。请求缺失该头时设备回带 `-`。
3. 同一通道上响应**可以**乱序返回，也**可以**与事件流帧交错；客户端**必须**按 `X-Request-Id` 匹配，而不是按顺序。
4. 客户端**应当**为普通请求设置 5 s 超时，上传屏幕程序设置 60 s 超时。超时后到达的响应直接丢弃。
5. 版本协商：客户端**可以**携带 `X-Api-Sem-Ver: <major.minor.patch>`；主版本号与设备不一致时设备返回 `400 incompatible_api_version`。设备 API 版本见 `GET /api/version`。

## 6. 事件流

HTTP/1.1 是请求-响应模型；设备主动推送（按键、状态快照、音频帧…）用“长生命周期响应”的分帧方式承载，语义对应 W3C Server-Sent Events。

1. 订阅：客户端发 `GET /api/events`（**应当**带 `Accept: text/event-stream`）。
2. 设备**必须**先回一个**开流帧**：`200`、`Content-Type: text/event-stream`、`Content-Length: 0`，`X-Request-Id` 为订阅请求的 id。
3. 之后每个事件是一个独立**事件帧**：
   - 起始行 `HTTP/1.1 200 OK`；
   - `X-Request-Id` 与订阅请求相同；
   - `Content-Type: text/event-stream`；
   - 报文体是**恰好一个** SSE 事件：`event: <名称>\n` + `data: <单行 JSON>\n` + `\n`。
4. `data` 是该事件的 JSON 对象，含 `type` 字段且等于事件名（便于直接复用读接口的同一结构）。
5. 订阅建立后设备**必须**立即按 [events.md §2](events.md#2-订阅快照) 的顺序推送一组**全量快照事件**，随后推送增量事件。
6. 每个通道同时只有一个订阅；重复订阅替换旧订阅（旧 id 不再收到帧）。`DELETE /api/events` 结束本通道订阅；通道断开（BLE 断连）视为结束。
7. 没有订阅的通道**不得**收到事件帧。读写接口与订阅相互独立：不订阅也能调用全部 REST 接口。

## 7. 字节通道

| 通道 | 物理层 | 设备 → 客户端 | 客户端 → 设备 |
|---|---|---|---|
| BLE | NUS 风格 GATT 服务 `6e400001-…`，设备名前缀 `Shougong` | TX 特征 `6e400003-…` notify，每次 ≤200 B | RX 特征 `6e400002-…` write，每次 ≤180 B |
| USB 串口 | CH343，460800 8N1（默认构建）**或** ESP32-S3 原生 USB-OTG CDC（`USBMode=default,CDCOnBoot=cdc` 构建，`Serial` 改绑原生口；Windows 首用需手动指派 COM，详见 doc/HARDWARE.md §15） | UART/CDC TX | UART/CDC RX |
| 本地桥 | TCP（`127.0.0.1:8787`，真 HTTP/1.1） | 见 [bridge/README.md](../../bridge/README.md) | 同左 |
| USB 网卡 | USB NCM + IPv4 + TCP `192.168.55.1:80`（`USBMode=default,CDCOnBoot=cdc` 构建；真 HTTP/1.1，无杂散字节） | socket 字节流 | socket 字节流；满槽时首响应为 `503` |

1. 报文可以跨越多个 BLE notify / write，接收方**必须**把通道视为连续字节流并重组。
2. **串口与设备日志共用 UART**。设备日志行**不得**以 `HTTP/` 开头；客户端解析器**必须**在报文之间跳过非报文字节，并以“行首 `HTTP/1.1 `”重新同步。设备**必须**用一次写调用输出一整个帧，避免日志插入帧内部。
3. 设备对客户端发来的非法字节同样做重同步：丢弃到下一个可解析的请求起始行。
4. 本地桥把真实 TCP HTTP 请求逐个转成隧道报文（自动补 `X-Request-Id`），把事件流转成标准 SSE 长连接；桥不改变任何资源语义。
5. **USB-OTG CDC 通道特有**：固件 `write` 有 `tud_cdc_n_connected` 门控——客户端**必须断言 DTR**（串口库/终端工具默认行为），否则设备下行字节全部丢弃；上行不受 DTR 影响。波特率参数被忽略（CDC 无速率概念）。
6. **USB 网卡通道**（详见 [../usb-net.md](../usb-net.md)）：真正的 TCP/IP 连接——无日志杂散字节、无 DTR 门控、报文边界由 socket 天然保证，每连接一个通道槽；`/api/events` 订阅在该连接上直接发 SSE 帧。并发连接数上限 `SGP_NET_SLOTS`（当前 3）。

## 8. 示例

请求（客户端 → 设备）：

```http
PUT /api/keys HTTP/1.1
X-Request-Id: 17
Content-Type: application/json
Content-Length: 67

{"k1":"offwork","k2":"busy","k3":"cycleL","k4":"cycleR","t":"rest"}
```

业务规则拒绝：

```http
HTTP/1.1 422 Unprocessable Entity
X-Request-Id: 17
Content-Type: application/json
Content-Length: 69

{"error":"K1-K4 must keep one offwork key","error_code":"no_offwork"}
```

事件帧（设备 → 客户端，订阅 id 为 `ev1`）：

```http
HTTP/1.1 200 OK
X-Request-Id: ev1
Content-Type: text/event-stream
Content-Length: 39

event: key
data: {"type":"key","k":2}

```
