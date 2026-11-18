# 收工牌云端模拟器：固件 JS 运行时（wasm）+ /emu-shell 浏览器工具桥，一个容器两个进程。
# 构建上下文由 scripts/deploy-emulator.ps1 组装：emulator/（源码裁剪）+ shell/（网站 scripts 里的桥）。
FROM node:20-alpine

# npm 镜像（create app 时要联网装模板依赖）；git 供作者名探测（没有也不阻塞）
RUN apk add --no-cache git && npm config set registry https://registry.npmmirror.com

WORKDIR /app
COPY emulator/ /app/emulator/
COPY shell/    /app/shell/
COPY run.mjs   /app/run.mjs

ENV SGP_EMULATOR_REPO=/app/emulator \
    BUSY_EMULATOR_DATA=/data \
    SGP_PROJECTS_ROOT=/projects \
    SGP_EMU_API=http://127.0.0.1:8640 \
    SGP_SHELL_PORT=8641 \
    SGP_SHELL_HOST=0.0.0.0 \
    SGP_PRESENCE_PORT=8643 \
    SGP_PRESENCE_HOST=0.0.0.0 \
    NODE_ENV=production

# /data：模拟器数据卷（应用、信任表、server key）；/projects：网页创建的应用项目
VOLUME ["/data", "/projects"]

# 8642 nginx 用的转发口（模拟器本体只绑回环）；8641 shell 桥；8643 共享看板 presence 服务——都不对外发布，只经 sgp-web 反代
EXPOSE 8641 8642 8643

CMD ["node", "/app/run.mjs"]
