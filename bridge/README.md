# 收工牌本地 HTTP 桥

把设备的字节流 HTTP 隧道（[../doc/http-api/tunnel.md](../doc/http-api/tunnel.md) §7「电脑侧桥」）暴露成 `127.0.0.1` 上的**真实 HTTP + SSE**，让 curl、脚本、Agent（Claude Code hooks、MCP server）、Home Assistant 等普通 HTTP 客户端直接调设备——设备不需要联网、不需要 IP。

```
HTTP 客户端 ──► http://127.0.0.1:8787/api/* ──► bridge ──HTTP 报文字节──► COMx（串口隧道）──► 设备
                   ◄── 响应/SSE 事件流 ◄── 按 X-Request-Id 关联 ◄──
```

## 用法

```
npm install
node bridge.mjs [--port COM8] [--listen 8787] [--baud 460800]
```

- `--port`：串口（默认 `COM8`，也可用环境变量 `SGP_PORT`）
- `--listen`：本地监听端口（默认 `8787`，只绑 127.0.0.1，不对局域网开放）
- `--baud`：波特率（默认 `460800`，与固件一致）

## 接口

| 端点 | 说明 |
|---|---|
| `任意 /api/*` | 原样转发到设备隧道（方法、query、body、Content-Type 保留；`X-Request-Id`/`X-Api-Sem-Ver` 由桥生成） |
| `GET /api/events` | SSE 长连接：订阅后设备的快照与增量事件以标准 `text/event-stream` 持续下行 |
| `GET /openapi.json` | 接口定义副本（`website/public/openapi.json`，用 `website` 下 `npm run openapi` 生成） |
| 其他 | 帮助文本 |

例：

```
curl http://127.0.0.1:8787/api/version
curl -X PUT http://127.0.0.1:8787/api/state -H "Content-Type: application/json" -d "{\"status\":\"focus\"}"
curl -N http://127.0.0.1:8787/api/events
```

## 注意

- **同一时间串口只能被一个程序占用**：桥运行时网页的串口连接不可用（BLE 通道不受影响）。
- 设备主动行为（`wantTime` 校时请求、`agentReq` LLM 代理、`key`/`touch` 按键事件）都以事件形式出现在 `/api/events` 里；需要这些功能的客户端必须自己订阅并回写对应接口——桥只做透传，不做编排。
- 写接口只回 `{"result":"OK"}`；资源变化以快照事件广播（[events.md](../doc/http-api/events.md) §1）。要跟踪设备状态请订阅事件流。

## 主机侧工具脚本（原生 USB 口调试/刷机）

NCM 复合固件下原生口一根线即可完成刷机与串口访问（本机 usbser 不分配 COM 号，脚本均走 `\\?\usb#…` 设备路径）：

| 脚本 | 用途 |
|---|---|
| `find-serial-paths.ps1` | 枚举设备串行接口设备路径（按设备 VID 过滤），输出可直接给下面两个脚本 |
| `cdc-1200-touch.ps1 -Path <路径>` | CDC 置 1200 波特触发 ROM 下载模式（`USBCDC` 内置 esptool 兼容复位），原生口回落 `PID_1001` 后用 esptool 直刷 |
| `read-serial-path.ps1` | 直接以设备路径开 CDC 读写（可置 DTR/RTS、可发隧道请求），无需 COM 号 |
| `dump-usbdesc.ps1` | 用 SetupApi/配置管理 API 抓取设备实际发出的 USB 描述符字节（排障用） |

典型刷机流程（原生口，固件为 `USBMode=default,CDCOnBoot=cdc` 构建）：

```powershell
$path = (& .\find-serial-paths.ps1)[0]            # 应用态 CDC 路径
.\cdc-1200-touch.ps1 -Path $path                  # 进下载模式（PID_1001）
$dl = (& .\find-serial-paths.ps1)[0]              # 下载器串行路径
esptool --port $dl write_flash ...             # 芯片型号与镜像参数见固件烧录说明
```
