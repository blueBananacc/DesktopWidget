// Production host for the /emu-shell browser bridge (emulator-shell.mjs). The vite dev/preview
// servers mount it as middleware; in the deployed container this tiny server does the same job:
//
//   node emu-shell-server.mjs            # listens on SGP_SHELL_PORT (default 8641)
//
// Environment it understands (all optional):
//   SGP_EMULATOR_REPO   the emulator source checkout (CLI lives under packages/server/cli)
//   SGP_EMU_API         the emulated bar's HTTP API (default http://127.0.0.1:8640)
//   BUSY_EMULATOR_DATA  the emulator's data folder — must be the same dir index.mjs --data uses
//   SGP_PROJECTS_ROOT   where Create app puts new projects
//   SGP_SHELL_PORT      this server's port (default 8641)
import { createServer } from "node:http";
import { emulatorShell } from "./emulator-shell.mjs";

const port = Number(process.env.SGP_SHELL_PORT ?? 8641);
const host = process.env.SGP_SHELL_HOST ?? "127.0.0.1";

const server = createServer((req, res) => {
  // The middleware only owns /call and /ping; everything else is a 404 here.
  emulatorShell(req, res, () => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: "not_found", message: "unknown shell path", hint: null } }));
  });
});

server.listen(port, host, () => {
  console.log(`emu-shell: http://${host}:${port} (repo=${process.env.SGP_EMULATOR_REPO ?? "(default)"}, data=${process.env.BUSY_EMULATOR_DATA ?? "(default)"})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
