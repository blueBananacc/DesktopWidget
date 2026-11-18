import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { emulatorShell, emulatorHtmlInjection } from "./scripts/emulator-shell.mjs";

// 本地设备模拟器（node packages/server/index.mjs）的 API 与事件流。
// 它的 entry-guard 校验 Host/Origin：changeOrigin 把 Host 改写成 127.0.0.1:8640，
// Origin 覆写成它自己的源——即守卫认可的"本站页面"，跨源页面则会被拒。
const EMULATOR = "http://127.0.0.1:8640";
const emuProxy: ProxyOptions = {
  target: EMULATOR,
  changeOrigin: true,
  ws: true,
  headers: { origin: EMULATOR },
};

// /emu-shell：模拟器窗口的"桌面壳"在浏览器里的替身。vendored 窗口通过 window.busyShell
// 调本机能力（建项目、构建、运行、文件夹对话框…），这里把它转给 busy-emulator CLI。
// 同时给 /sgp/emulator/index.html 注入 browser-shell.js——只有存在此 middleware 的环境
// （dev / preview）才有桥；静态部署的页面自动回落到纯浏览器模式。
const emulatorShellPlugin: Plugin = {
  name: "sgp-emulator-shell",
  configureServer(server) {
    server.middlewares.use(emulatorHtmlInjection());
    server.middlewares.use("/emu-shell", emulatorShell);
  },
  configurePreviewServer(server) {
    server.middlewares.use(emulatorHtmlInjection());
    server.middlewares.use("/emu-shell", emulatorShell);
  },
};

export default defineConfig({
  plugins: [react(), emulatorShellPlugin],
  base: "/sgp/",          // 生产部署在 https://<host>/sgp/ 子路径下（与 80 端口的其他站点区分入口）
  server: {
    port: 5174,
    proxy: {
      // 3D 视图的 frame 文件量大且有独立许可，不进仓库，按需代理回模拟器
      "/sgp/emulator/stage3d": { ...emuProxy, rewrite: (p) => p.replace(/^\/sgp/, "") },
      "/_emu": emuProxy,   // SSE 事件流、按键、电源、时间控制
      "/api": emuProxy,    // 设备 HTTP API
      "/emulator": emuProxy,
      "/docs": emuProxy,   // 模拟器的 API 文档页
    },
  },
});
