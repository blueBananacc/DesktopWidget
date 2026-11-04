# 部署收工牌网站到生产服务器（120.55.125.13 → /opt/sgp-web/site）
# 用法：在 code/website 下执行  powershell -File scripts\deploy.ps1
# 站点由独立容器 sgp-web（nginx:alpine，:443）托管，与 free-hire 项目完全隔离。
$ErrorActionPreference = "Stop"
$key = "$env:USERPROFILE\.ssh\sgp_deploy"
$dst = "root@120.55.125.13:/opt/sgp-web/site/sgp/"

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
scp -i $key -o BatchMode=yes -r "dist\*" $dst
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# scp 落地的目录可能是 700——容器内 nginx 以非 root 运行，必须放开读取/遍历，否则静态文件被 SPA fallback 顶包造成白屏
ssh -i $key -o BatchMode=yes root@120.55.125.13 "chmod -R a+rX /opt/sgp-web/site/"
ssh -i $key -o BatchMode=yes root@120.55.125.13 "curl -sk -o /dev/null -w 'deploy-check:%{http_code}' https://127.0.0.1/sgp/"
Write-Host "`n部署完成：https://120.55.125.13/sgp/ （首次访问需在浏览器点「高级→继续访问」）"
