// sgp-emu 容器入口：一个容器里跑两个进程。
//   1. packages/server/index.mjs  —— 模拟器本体（wasm 固件 + 设备 HTTP API，:8640）
//   2. shell/emu-shell-server.mjs —— /emu-shell 浏览器工具桥（:8641，转发给 busy-emulator CLI）
// 任一个退出就把另一个也停掉，交给 restart: unless-stopped 整体拉起。
import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";

// 模拟器只监听 127.0.0.1；给 nginx 一个容器内的可达口：8642 上做纯 TCP 转发。
createServer((client) => {
  const upstream = connect(8640, "127.0.0.1");
  client.pipe(upstream).pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
}).listen(8642, "0.0.0.0", () => console.log("emu relay: 0.0.0.0:8642 → 127.0.0.1:8640"));

const children = [
  ["emulator", ["/app/emulator/packages/server/index.mjs", "--port", "8640", "--data", "/data"]],
  ["emu-shell", ["/app/shell/emu-shell-server.mjs"]],
  ["presence", ["/app/shell/presence-server.mjs"]],
].map(([name, args]) => {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("error", (e) => console.error(`${name}: spawn failed: ${e.message}`));
  return { name, child };
});

let exiting = false;
const stop = (code = 0) => {
  if (exiting) return;
  exiting = true;
  for (const { child } of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 800).unref();
};
for (const { name, child } of children) {
  child.on("exit", (code, signal) => {
    console.error(`${name} exited (code=${code} signal=${signal}) — shutting down for restart`);
    stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
