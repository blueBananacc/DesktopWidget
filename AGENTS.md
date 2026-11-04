# 收工牌

隐私优先的桌面工作状态设备（ESP32-S3 + OLED + RGB + 麦克风）+ 配套 Vite/React/TS 网站。仓库根即 `code/`：`firmware/`（Arduino）、`website/`（网页）、`doc/`（PRD/协议/部署）。

## 部署与服务器连接

- 网站已部署到阿里云 ECS `https://120.55.125.13/sgp/`（独立 docker 容器 `sgp-web`，与既有 free-hire 项目隔离）；SSH 用 `~/.ssh/sgp_deploy` 私钥连 `root@120.55.125.13`。
- 更新网站：`cd website && powershell -File scripts\deploy.ps1`。细节见 [doc/deploy.md](doc/deploy.md)。
