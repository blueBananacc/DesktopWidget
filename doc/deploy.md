# 部署：收工牌网站 → 阿里云 ECS

## 服务器实况

- 阿里云 ECS，Ubuntu 22.04，2C4G，root；公网 IP `120.55.125.13`
- **这是共享生产机**：`free-hire-*` 全家桶（docker compose：frontend nginx + FastAPI + Celery + Postgres + Redis + assistant）跑在 `:80`，**不要动** `/opt/hronfire`、它的 compose、以及 80 端口
- 安全组入方向放行：22 / 80 / 443（443 原本就有规则）；ufw 未启用
- 磁盘 40G 用了一半，构建型操作先看 `df -h`（本站点纯静态，不占构建资源）

## SSH 连接

```powershell
ssh -i C:\Users\666\.ssh\sgp_deploy -o StrictHostKeyChecking=no root@120.55.125.13
```

- 私钥 `C:\Users\666\.ssh\sgp_deploy`（无密码），公钥已写入服务器 `/root/.ssh/authorized_keys`（`sgp-deploy` 注释行）
- 注意：同目录的 `hronfire_deploy` 私钥**有密码**，别用错；PowerShell 里 `ssh-keygen -N '""'` 生成的是字面引号密码，要空密码用 `-N ''`
- 服务器上添加新公钥：阿里云控制台 → ECS 实例 → 远程连接 Workbench → `echo '<pub>' >> /root/.ssh/authorized_keys`，再 `chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys`（sshd StrictModes 会拒绝权限过宽的 key 文件）

## 本站部署形态（2026-11-18 起：网站 + 云端模拟器）

```
https://120.55.125.13 ──443──► sgp-web 容器（nginx:1.27-alpine → /opt/sgp-web/site/sgp）
                               ├─ 裸域 / → 302 到 /sgp/；应用 base=/sgp/
                               ├─ /_emu、/api、/docs、/emulator、stage3d → sgp-emu:8642（TCP 转发口）
                               └─ /emu-shell → sgp-emu:8641（浏览器工具桥，NDJSON 流）
https://hr.120.55.125.13.sslip.io ──443（同 nginx，按 server_name 分流）──► 反代 172.17.0.1:80 → free-hire-frontend
                              sgp-emu 容器（node:20-alpine，不发布端口）：
                               ├─ packages/server/index.mjs —— 模拟器本体，只绑 127.0.0.1:8640
                               ├─ run.mjs 里的 TCP 转发 0.0.0.0:8642 → 127.0.0.1:8640（跨容器入口）
                               └─ shell/emu-shell-server.mjs —— /call、/ping → sgp-emulator CLI
http://120.55.125.13  ──80───► free-hire-frontend（原有系统，零改动；/main 入口是它的可选重定向）
```

**HR 入口说明**：浏览器会把 `http://IP` 自动升级成 `https://IP`（本站），裸 IP 已回不去 HR——用 `https://hr.120.55.125.13.sslip.io` 访问 HR（sslip.io 免费通配 DNS，解析回 120.55.125.13）。独立 origin 避免了 `/api` 路径冲突（本站和 HR 都用 `/api/`，同域无法分流）。HR 容器零改动，流量经 docker0 网关进其发布的 :80。

URL 约定：**本站入口固定 `https://120.55.125.13/sgp/`**——用路径区分两个项目，不用记 http/https 端口差异。Vite `base:"/sgp/"` + React Router `basename=BASE_URL` 配套，资源都在 `/sgp/assets/` 下。

服务器上 `/opt/sgp-web/`：

| 文件 | 作用 |
|---|---|
| `docker-compose.yml` | 独立 compose 项目：web（nginx:1.27-alpine，`443:443`）+ emu（构建自 ./emu-image），`restart: unless-stopped` |
| `nginx.conf` | TLS + `/`→302 `/sgp/` + SPA fallback + 模拟器反代（Host/Origin 改写回环，等价 vite `changeOrigin`；`/_emu` SSE 关缓冲长超时；`/emu-shell` 转发到 8641） |
| `emu-image/` | 模拟器构建上下文：`emulator/`（packages/server 全量 + engine 顶层 .mjs + firmware.json + build/{1.3.1,apps-assets}）、`shell/`（emulator-shell.mjs + emu-shell-server.mjs）、`Dockerfile`、`run.mjs` |
| `tls/cert.pem` `key.pem` | Let's Encrypt IP 证书（shortlived profile，~6.7 天），acme.sh 自动续期，见下节 |
| `tls/hr-cert.pem` `hr-key.pem` | HR 域名证书（`hr.120.55.125.13.sslip.io`，90 天），同一 acme.sh 续期 |
| `site/sgp/` | 网站静态文件（构建产物直接铺这里，容器只读挂载） |

模拟器数据持久在两个 compose 卷：`emu-data`（/data：应用、信任表、server key）、`emu-projects`（/projects：网页创建的应用项目）。**所有访客共享同一台云端模拟设备**——谁装的应用、按的按键大家都能看到。

## TLS 证书（Let's Encrypt IP 证书，2026-11-18 起）

- 证书：Let's Encrypt **IP 证书**（SAN=`IP:120.55.125.13`，shortlived profile，有效期 ~6.7 天），无域名也可签发；浏览器/系统信任链完整，无「不安全」警告
- 校验方式：**tls-alpn-01**（LE 对 IP 证书只支持 http-01/tls-alpn-01，80 口被 free-hire 占用 → 选 alpn 走 443）
- 工具：服务器 `/root/.acme.sh`（git clone 安装，raw.githubusercontent.com 被运营商 reset）；账号注册时**不能带邮箱**（LE 会校验邮箱域名有合法公共后缀，`--register-account` 不带 `-m` 即可）
- 续期闭环：acme.sh cron 每天 4 次 `--cron`；到期前（ARI 建议窗口，约签发后 3 天）自动续期——
  - `pre-hook`：`docker stop sgp-web`（alpn 校验要独占 443，停机 ~15 秒）
  - 证书落到 `/opt/sgp-web/tls/{cert,key}.pem`（`--install-cert` 记下的路径）
  - `post-hook`：`docker start sgp-web` + `reloadcmd` 里 `nginx -s reload`（顺序无关，容器起来必带新证）
- 手动重签：`acme.sh --issue -d 120.55.125.13 --alpn --server letsencrypt --cert-profile shortlived --days 4 --force`（HR 域名证书同理，去掉 `--cert-profile`，`-d hr.120.55.125.13.sslip.io`）
- 风险：IP 证书寿命短，续期依赖 cron + 443 可用；若连续失败证书过期会回到证书警告——巡检时 `echo | openssl s_client -connect 120.55.125.13:443 | openssl x509 -noout -dates` 看有效期

## 部署云端模拟器

```powershell
cd C:\Users\666\Desktop\shangxiabanbaijian\code\website
powershell -File scripts\deploy-emulator.ps1   # -EmulatorRepo <path> 可换源码检出
```

脚本做的事：把模拟器源码裁剪成构建上下文（`deploy/emu-image/`，已 gitignore）→ tar+scp 上传 → 服务器 `docker compose up -d --build emu` → 换新 `docker-compose.yml`/`nginx.conf` 并 `nginx -s reload` → 容器内 `/_emu/status` 健康检查。镜像内 `apk add git` + npm 源指向 npmmirror（create app 要联网装模板依赖）。

## 更新网站

```powershell
cd C:\Users\666\Desktop\shangxiabanbaijian\code\website
powershell -File scripts\deploy.ps1
```

脚本做的事：`npm run build` → `scp -r dist\* root@…:/opt/sgp-web/site/sgp/` → `chmod -R a+rX`（**必需**：scp 可能落下 700 目录，容器内 nginx 非 root 读不到文件时会被 SPA fallback 顶包成 index.html——症状是白屏、js 请求返回 ~453B HTML）→ `curl -k https://127.0.0.1/sgp/` 健康检查。**纯静态替换，容器不用重启**。注意改了 `deploy/nginx.conf` 或 compose 时不要走 deploy.ps1（它只发 dist），走 deploy-emulator.ps1。

## 设备连接原理（为什么 HTTPS 是必须的）

- Web Serial / Web Bluetooth 只在 **Secure Context** 可用：`https://` 或 `http://localhost`。`http://IP` 下 API 直接不存在
- 连接永远是**浏览器本地**的：在 A 电脑打开网页连的是 A 电脑上插的收工牌，和网站托管在哪无关
- localStorage 按源隔离：部署版上 ASR/LLM 端点配置要重新填；状态回顾跨天归档是浏览器本地缓存，会重新积累（设备端数据连接后照常同步）

## 安全操作边界（同 HROnfire 运维报告）

- 可以：`docker ps` / `docker logs sgp-web` / 替换 `/opt/sgp-web/site/sgp/` 内容 / `docker compose -f /opt/sgp-web/docker-compose.yml restart`
- 禁止：动 `/opt/hronfire`、`docker compose down -v`/`volume rm`/`system prune --volumes`（会删 pg-data）、宿主机装监听 80 的服务、改安全组已有规则、改 iptables
- 容器删了重建：`cd /opt/sgp-web && docker compose up -d`（挂载文件都在，秒回）
