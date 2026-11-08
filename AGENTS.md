# 收工牌

隐私优先的桌面工作状态设备（ESP32-S3 + OLED + RGB + 麦克风）+ 配套 Vite/React/TS 网站。仓库根即 `code/`：`firmware/`（Arduino）、`website/`（网页）、`bridge/`（电脑侧本地 HTTP 桥）、`doc/`（PRD/协议/部署）。

## 设备接口（HTTP 隧道，v0.9 起）

设备⇄电脑唯一的接口面是 **HTTP/1.1 子集**：BLE/串口字节流隧道（`tunnel.md` §7）+ 原生 USB 口 NCM 虚拟网卡上的真 TCP/IP（`192.168.55.1:80`，doc/usb-net.md）。规范文件在 `doc/http-api/`：`tunnel.md`（分帧）、`events.md`（事件目录）、`openapi/`（分资源 OpenAPI 片段 → `website/scripts/openapi-bundle.mjs` 打包成 `website/public/openapi.json`）。新增接口步骤见 `doc/http-api/README.md`；网页/模拟设备/桥都必须与固件路由表保持同步。

## 部署与服务器连接

- 网站已部署到阿里云 ECS `https://120.55.125.13/sgp/`（独立 docker 容器 `sgp-web`，与既有 free-hire 项目隔离）；SSH 用 `~/.ssh/sgp_deploy` 私钥连 `root@120.55.125.13`。
- 更新网站：`cd website && powershell -File scripts\deploy.ps1`。细节见 [doc/deploy.md](doc/deploy.md)。
