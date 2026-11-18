# 部署云端模拟器到生产服务器（120.55.125.13:/opt/sgp-web）
# 做的事：组装 emu-image 构建上下文（模拟器源码裁剪 + shell 桥）→ scp 上传 → 服务器上
# docker compose build + up → nginx 换配置并 reload。网站本体仍走 deploy.ps1。
#
# 用法：cd website && powershell -File scripts\deploy-emulator.ps1
#   -EmulatorRepo <path>   模拟器源码检出（默认 ../busybar-emulator 的已知路径，可用 SGP_EMULATOR_REPO 覆盖）
param(
  [string]$EmulatorRepo = $env:SGP_EMULATOR_REPO
)
$ErrorActionPreference = "Stop"
if (-not $EmulatorRepo) { $EmulatorRepo = "C:\Users\666\Desktop\busy\busybar-emulator" }

$key    = "$env:USERPROFILE\.ssh\sgp_deploy"
$dst    = "root@120.55.125.13:/opt/sgp-web/"
$here   = Split-Path -Parent $PSScriptRoot          # website/
$deploy = Join-Path $here "deploy"
$ctx    = Join-Path $deploy "emu-image"             # 本地组装目录

foreach ($need in @("packages\server\index.mjs", "packages\server\cli\busy-emulator.mjs", "packages\engine\firmware.json", "packages\engine\build\1.3.1\build-info.json")) {
  if (-not (Test-Path (Join-Path $EmulatorRepo $need))) { throw "模拟器源码不完整：$EmulatorRepo\$need 不存在" }
}

Write-Host "==> 组装构建上下文 $ctx"
if (Test-Path $ctx) { Remove-Item -Recurse -Force $ctx }
New-Item -ItemType Directory -Force "$ctx\emulator\packages", "$ctx\shell" | Out-Null

# server 全量（含 cli/projects/capture…），去掉测试与说明
robocopy "$EmulatorRepo\packages\server" "$ctx\emulator\packages\server" /E /XF *.test.mjs /XD test | Out-Null
# engine 只留运行时要的：顶层 .mjs + firmware.json + build/{1.3.1,apps-assets}
New-Item -ItemType Directory -Force "$ctx\emulator\packages\engine\build" | Out-Null
robocopy "$EmulatorRepo\packages\engine" "$ctx\emulator\packages\engine" "*.mjs" "firmware.json" | Out-Null
robocopy "$EmulatorRepo\packages\engine\build\1.3.1" "$ctx\emulator\packages\engine\build\1.3.1" /E | Out-Null
robocopy "$EmulatorRepo\packages\engine\build\apps-assets" "$ctx\emulator\packages\engine\build\apps-assets" /E | Out-Null
# 示例应用：上游 examples/ + 本仓库 deploy/examples/（收工牌自己的示例）合并进 emulator/examples
# —— EXAMPLES_DIR 就指这个目录，不带它"创建应用→模板应用"只剩官方模板
robocopy "$EmulatorRepo\examples" "$ctx\emulator\examples" /E | Out-Null
robocopy "$deploy\examples" "$ctx\emulator\examples" /E | Out-Null
# shell 桥 + 共享看板 presence 服务（本仓库 scripts/ 下的三个文件）
Copy-Item "$here\scripts\emulator-shell.mjs", "$here\scripts\emu-shell-server.mjs", "$here\scripts\presence-server.mjs" "$ctx\shell\"
Copy-Item "$deploy\Dockerfile", "$deploy\run.mjs" $ctx

Write-Host "==> 打包上传"
$tar = Join-Path $env:TEMP "sgp-emu-image.tar"
if (Test-Path $tar) { Remove-Item $tar }
tar -cf $tar -C $ctx .
scp -i $key -o BatchMode=yes $tar "root@120.55.125.13:/tmp/sgp-emu-image.tar"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
scp -i $key -o BatchMode=yes "$deploy\docker-compose.yml", "$deploy\nginx.conf" $dst
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> 服务器上解包、构建、启动"
$remote = @(
  'set -e'
  'mkdir -p /opt/sgp-web/emu-image'
  'tar -xf /tmp/sgp-emu-image.tar -C /opt/sgp-web/emu-image'
  'cd /opt/sgp-web'
  'docker compose up -d --build emu'
  'docker exec sgp-web nginx -t'
  'docker exec sgp-web nginx -s reload'
  'sleep 3'
  "docker exec sgp-emu node -e 'fetch(""http://127.0.0.1:8640/_emu/status"").then(r=>r.json()).then(j=>console.log(""emu-up:"",JSON.stringify(j)))' || docker logs --tail 20 sgp-emu"
) -join "`n"
$remote | ssh -i $key -o BatchMode=yes root@120.55.125.13 "bash -s"

Write-Host "`n完成：https://120.55.125.13/sgp/ 的模拟器区域现在由云端 sgp-emu 容器提供后端。"
