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

## 本站部署形态（2026-11-04 起）

```
https://120.55.125.13 ──443──► sgp-web 容器（nginx:1.27-alpine → /opt/sgp-web/site/sgp）
                               裸域 / → 302 到 /sgp/；应用 base=/sgp/
http://120.55.125.13  ──80───► free-hire-frontend（原有系统，零改动；/main 入口是它的可选重定向）
```

URL 约定：**本站入口固定 `https://120.55.125.13/sgp/`**——用路径区分两个项目，不用记 http/https 端口差异。Vite `base:"/sgp/"` + React Router `basename=BASE_URL` 配套，资源都在 `/sgp/assets/` 下。

服务器上 `/opt/sgp-web/`：

| 文件 | 作用 |
|---|---|
| `docker-compose.yml` | 独立 compose 项目：nginx:1.27-alpine，只发布 `443:443`，`restart: unless-stopped` |
| `nginx.conf` | TLS + `/`→302 `/sgp/` + `location /sgp/` SPA fallback（`try_files $uri $uri/ /sgp/index.html`，React Router 必需） |
| `tls/cert.pem` `key.pem` | 自签证书，`CN=SAN=120.55.125.13`，3650 天，2036 年到期 |
| `site/sgp/` | 网站静态文件（构建产物直接铺这里，容器只读挂载） |

证书是**自签**的——浏览器首次访问要点「高级 → 继续访问」，例外会被记住。要消掉警告需要域名 + 真证书（Let's Encrypt），目前没有域名。

## 更新网站

```powershell
cd C:\Users\666\Desktop\shangxiabanbaijian\code\website
powershell -File scripts\deploy.ps1
```

脚本做的事：`npm run build` → `scp -r dist\* root@…:/opt/sgp-web/site/sgp/` → `curl -k https://127.0.0.1/sgp/` 健康检查。**纯静态替换，容器不用重启**。

## 设备连接原理（为什么 HTTPS 是必须的）

- Web Serial / Web Bluetooth 只在 **Secure Context** 可用：`https://` 或 `http://localhost`。`http://IP` 下 API 直接不存在
- 连接永远是**浏览器本地**的：在 A 电脑打开网页连的是 A 电脑上插的收工牌，和网站托管在哪无关
- localStorage 按源隔离：部署版上 ASR/LLM 端点配置要重新填；状态回顾跨天归档是浏览器本地缓存，会重新积累（设备端数据连接后照常同步）

## 安全操作边界（同 HROnfire 运维报告）

- 可以：`docker ps` / `docker logs sgp-web` / 替换 `/opt/sgp-web/site/sgp/` 内容 / `docker compose -f /opt/sgp-web/docker-compose.yml restart`
- 禁止：动 `/opt/hronfire`、`docker compose down -v`/`volume rm`/`system prune --volumes`（会删 pg-data）、宿主机装监听 80 的服务、改安全组已有规则、改 iptables
- 容器删了重建：`cd /opt/sgp-web && docker compose up -d`（挂载文件都在，秒回）
