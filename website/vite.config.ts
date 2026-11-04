import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/sgp/",          // 生产部署在 https://<host>/sgp/ 子路径下（与 80 端口的其他站点区分入口）
  server: { port: 5174 },
});
