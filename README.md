# 收工牌 Shougongpai

隐私优先的桌面工作状态牌：ESP32-S3 + OLED + RGB 灯 + 麦克风 + 实体按键（可选触摸/旋钮），配套 Vite/React/TS 网站。状态、待办、日程、休息提醒全部在本地设备与浏览器之间流转；多块牌子之间用 ESP-NOW 组成共享看板。

在线站点：<https://120.55.125.13/sgp/>

## 仓库结构

| 目录 | 内容 |
|---|---|
| [`firmware/`](firmware/) | Arduino 固件（`shougongpai/shougongpai.ino` + `usb_net.cpp`），接线、编译、烧录见 [firmware/README.md](firmware/README.md) |
| [`website/`](website/) | 配套网站（Vite + React + TS），开发说明见 [website/AGENTS.md](website/AGENTS.md) |
| [`bridge/`](bridge/) | 电脑侧本地 HTTP 桥（串口 → `127.0.0.1` 真 HTTP + SSE）及刷机/排障脚本，见 [bridge/README.md](bridge/README.md) |
| [`doc/`](doc/) | PRD、硬件、协议规范、部署文档，索引见 [doc/MAP.md](doc/MAP.md) |

## 设备接口

设备对外只有一个接口面：**HTTP/1.1 子集**，可跑在三种传输上——

1. **BLE / 串口字节流**（隧道分帧）：网页通过 Web Bluetooth / Web Serial 直连。
2. **本地桥**：`bridge/` 把串口隧道转成 `http://127.0.0.1` 上的标准 HTTP + SSE，供 curl、脚本、Agent 调用。
3. **USB NCM 虚拟网卡**：原生 USB 口插线即出网卡，`http://192.168.55.1/api/*` 直达，无需桥（见 [doc/usb-net.md](doc/usb-net.md)）。

规范文件（与固件路由表、网页、模拟设备、桥保持同步）：

- [doc/http-api/tunnel.md](doc/http-api/tunnel.md) — 分帧与通道
- [doc/http-api/events.md](doc/http-api/events.md) — 事件流目录
- [doc/http-api/openapi/](doc/http-api/openapi/) — 分资源 OpenAPI 片段，`website/scripts/openapi-bundle.mjs` 打包为 `website/public/openapi.json`
- 新增接口流程：[doc/http-api/README.md](doc/http-api/README.md)

## 快速开始

```bash
# 网站
cd website && npm install && npm run dev      # http://localhost:5174/sgp/

# 本地桥（设备经串口连接）
cd bridge && npm install && node bridge.mjs --port COM8

# 固件：Arduino IDE / arduino-cli，板型参数见 firmware/README.md
arduino-cli compile -b "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=esp_sr_16" firmware/shougongpai
```

部署网站：`cd website && powershell -File scripts\deploy.ps1`（详见 [doc/deploy.md](doc/deploy.md)）。

## 现状

- ✅ HTTP 隧道（BLE / 串口 / 原生 USB CDC）、事件流、ESP-NOW 共享看板
- ✅ USB NCM 网卡：枚举、静态 IP 下 ping + HTTP 全通，设备端 DHCP 服务已验证
- 🚧 零配置访问（`shougongpai.local`，IPv6 RA/SLAAC + RDNSS）：开发中，见分支 `wip/usb-net-zeroconf`；部分 Windows 主机目前仍需手动配 `192.168.55.2/24`
