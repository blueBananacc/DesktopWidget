// /emu-shell: the browser edition of the emulator window's desktop shell. The vendored window
// (public/emulator/) speaks window.busyShell.action(name, arg) — the same bridge the Electron app
// gives it — and this middleware answers those names by running busy-emulator's own command line
// (packages/server/cli), which is plain Node and needs no Electron. Answers stream back as NDJSON:
// one { job } line per line of tool progress, then one { ok:true, value } or { ok:false, error }.
//
// Point it at the emulator checkout with SGP_EMULATOR_REPO; the default is this machine's copy.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EMU_ROOT = process.env.SGP_EMULATOR_REPO ?? "C:/Users/666/Desktop/busy/busybar-emulator";
const CLI = path.join(EMU_ROOT, "packages", "server", "cli", "busy-emulator.mjs");

// The data folder the command line resolves for itself (cli/context.mjs): %LOCALAPPDATA%\<AppName>
// on Windows, ~/Library/Application Support/<AppName> on macOS — a development run takes the home of
// the environment, exactly what os.homedir() gives here. BUSY_EMULATOR_DATA names it outright (the
// emulator server honours the same variable, so the container shares one volume).
const APP_NAME = "BUSY Bar Emulator";
const DATA_DIR =
  process.env.BUSY_EMULATOR_DATA ??
  (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), APP_NAME)
    : path.join(os.homedir(), "Library", "Application Support", APP_NAME)); // 与 cli/context.mjs 一致：非 Windows 都走这里

/** Where Create app puts new projects; mirrors the desktop app's "~/BUSY Bar projects". */
const PROJECTS_ROOT = process.env.SGP_PROJECTS_ROOT ?? path.join(os.homedir(), "sgp-emulator-projects");
const CAPTURE_DIR = path.join(PROJECTS_ROOT, "screenshots");
const TMP_DIR = path.join(os.tmpdir(), "sgp-emu-shell");

const IS_WIN = process.platform === "win32";

/** The emulated bar's own HTTP API: same container/localhost as the server process. */
const EMU_API = process.env.SGP_EMU_API ?? "http://127.0.0.1:8640";

/**
 * Reads appmeta/manifest.json out of a .tgz buffer: gunzip, then walk ustar headers
 * (name@0, size@124 octal, 512-byte blocks). Returns the parsed manifest or null.
 */
function readPackageManifest(raw) {
  try {
    const tar = gunzipSync(raw);
    for (let off = 0; off + 512 <= tar.length;) {
      const name = tar.subarray(off, off + 100).toString("utf8").replace(/\0.*$/, "");
      const size = parseInt(tar.subarray(off + 124, off + 136).toString("utf8").trim() || "0", 8);
      if (!name || !Number.isFinite(size)) break;
      const dataStart = off + 512;
      if (name.endsWith("appmeta/manifest.json")) {
        return JSON.parse(tar.subarray(dataStart, dataStart + size).toString("utf8"));
      }
      off = dataStart + Math.ceil(size / 512) * 512;
    }
  } catch {
    // not gzip / not tar / not json: all mean "not a package"
  }
  return null;
}

// ----------------------------------------------------------------------------- small utilities

const jsonLine = (value) => `${JSON.stringify(value)}\n`;

function firstLine(text) {
  const line = String(text ?? "").split("\n").map((one) => one.trim()).find(Boolean);
  return line ?? null;
}

/** The app's id part of a name, the same rule as create-app.js's idPart. */
function idPart(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s.]+/g, "_")
    .replace(/[^a-z0-9_-]+/g, "")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function homeRelative(full) {
  const home = os.homedir();
  if (full.startsWith(home)) return `~${full.slice(home.length)}`.replace(/\\/g, "/");
  return full;
}

/** A "data:image/png;base64,…" address to a file the command line can read; null when it is not one. */
async function dataUrlToFile(dataUrl, name) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl ?? ""));
  if (!match) return null;
  await mkdir(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, name);
  await writeFile(file, Buffer.from(match[1], "base64"));
  return file;
}

// ----------------------------------------------------------------------------- the command line

/**
 * One busy-emulator run: `node <cli> <args…> --json --progress`. Its progress (stderr with
 * --progress) goes out as job lines; its one line of JSON on stdout is the answer, kept whole.
 * Returns that parsed line, or a { ok:false } look-alike when nothing parseable came back.
 */
function cli(args, { onLine = null, cwd = os.homedir(), signal = null } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args, "--json", "--progress"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let errTail = "";
    let rest = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => {
      errTail = (errTail + chunk).slice(-4000);
      rest += chunk.toString("utf8");
      let at;
      while ((at = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, at).trim();
        rest = rest.slice(at + 1);
        if (line) onLine?.(line);
      }
    });
    child.on("error", (error) => resolve({ ok: false, code: "tool_failed", message: String(error), hint: null }));
    child.on("close", () => {
      const last = out.split("\n").map((one) => one.trim()).filter(Boolean).at(-1);
      try {
        resolve(last ? JSON.parse(last) : { ok: false, code: "tool_failed", message: firstLine(errTail) ?? "The command line printed nothing.", hint: null });
      } catch {
        resolve({ ok: false, code: "tool_failed", message: firstLine(errTail) ?? "The command line's answer was not JSON.", hint: null });
      }
    });
    if (signal) {
      const kill = () => killTree(child);
      if (signal.aborted) kill();
      else signal.addEventListener("abort", kill, { once: true });
    }
  });
}

/** A Windows process tree (the command's own children too); on POSIX the process itself. */
function killTree(child) {
  try {
    if (IS_WIN) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  } catch {
    // already gone
  }
}

/** git's user.name as the project author, looked up once: what the desktop app pre-fills. */
let authorCache;
function gitAuthor() {
  if (authorCache !== undefined) return authorCache;
  return (authorCache = new Promise((resolve) => {
    execFile("git", ["config", "--get", "user.name"], { timeout: 4000, windowsHide: true }, (error, stdout) => {
      const name = String(stdout ?? "").trim();
      resolve(!error && name ? { name, from: "git" } : null);
    });
  }));
}

// ----------------------------------------------------------------------------- native dialogs

/** PowerShell's folder picker in an STA session: the chosen path, or null when closed. */
function pickFolder(from = null) {
  if (!IS_WIN) return Promise.resolve(null);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = 'Choose the folder the project goes into'",
    "$d.ShowNewFolderButton = $true",
    from ? `$d.SelectedPath = '${String(from).replace(/'/g, "''")}'` : "",
    "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }",
  ].join("; ");
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-STA", "-Command", script], { timeout: 120000, windowsHide: false }, (error, stdout) => {
      const chosen = String(stdout ?? "").trim();
      resolve(error || !chosen ? null : chosen);
    });
  });
}

/** PowerShell's open-file picker: the chosen file's path, or null when closed. */
function pickFile({ from = null, filter = "All files (*.*)|*.*", title = "Open" } = {}) {
  if (!IS_WIN) return Promise.resolve(null);
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.OpenFileDialog",
    `$d.Title = '${title.replace(/'/g, "''")}'`,
    `$d.Filter = '${filter.replace(/'/g, "''")}'`,
    from ? `$d.InitialDirectory = '${String(from).replace(/'/g, "''")}'` : "",
    "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.FileName) }",
  ].join("; ");
  return new Promise((resolve) => {
    execFile("powershell", ["-NoProfile", "-STA", "-Command", script], { timeout: 120000, windowsHide: false }, (error, stdout) => {
      const chosen = String(stdout ?? "").trim();
      resolve(error || !chosen ? null : chosen);
    });
  });
}

// ----------------------------------------------------------------------------- trust and the list

/** The emulator's own trust registry, imported from its source (cli/projects/trust.mjs). */
async function trustTools() {
  const base = path.join(EMU_ROOT, "packages", "server", "projects");
  const [trust, registry] = await Promise.all([
    import(pathToFileURL(path.join(base, "trust.mjs")).href),
    import(pathToFileURL(path.join(base, "registry.mjs")).href),
  ]);
  const known = () => {
    try {
      return registry.readProjects?.(DATA_DIR) ?? registry.listProjects?.(DATA_DIR, { platform: process.platform }) ?? [];
    } catch {
      return [];
    }
  };
  return {
    trust: (dir) => trust.trustProject(DATA_DIR, dir, "trusted", { platform: process.platform }),
    isTrusted: (dir) => {
      try {
        return trust.isTrusted(DATA_DIR, dir, process.platform);
      } catch {
        return false;
      }
    },
    listed: (dir) => known().some((one) => one.folder === dir || one.dir === dir),
  };
}

/** The project folder at or above `start` (one picked inside it counts): src/appmeta says it is one. */
function locateProject(start) {
  let dir = start;
  try {
    if (statSync(dir).isFile()) dir = path.dirname(dir);
  } catch {
    // keep as given
  }
  for (let i = 0; i < 6 && dir && dir !== path.dirname(dir); i += 1, dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "src", "appmeta", "manifest.json"))) return dir;
  }
  return null;
}

function projectInfo(dir) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(dir, "src", "appmeta", "manifest.json"), "utf8"));
    return { id: typeof manifest.id === "string" ? manifest.id : null, name: typeof manifest.name === "string" ? manifest.name : null };
  } catch {
    return { id: null, name: null };
  }
}

// ----------------------------------------------------------------------------- OS gestures

function reveal(target) {
  if (!IS_WIN && process.platform !== "darwin") return false; // 容器/Linux 里没有文件管理器
  const file = existsSync(target) && statSync(target).isFile();
  const what = IS_WIN ? (file ? `/select,"${target}"` : `"${target}"`) : target;
  const tool = IS_WIN ? "explorer" : "open";
  const child = spawn(tool, [what], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  return true;
}

function openPath(target) {
  if (!IS_WIN && process.platform !== "darwin") return false; // 容器里无可打开的本机对象
  const child = IS_WIN
    ? spawn("cmd", ["/c", "start", "", `"${target}"`], { detached: true, stdio: "ignore", windowsHide: true })
    : spawn("open", [target], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return true;
}

function copyText(text) {
  return new Promise((resolve) => {
    const tool = IS_WIN ? "clip" : process.platform === "darwin" ? "pbcopy" : "xclip";
    const child = spawn(tool, IS_WIN || process.platform === "darwin" ? [] : ["-selection", "clipboard"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(String(text), "utf8");
  });
}

// ----------------------------------------------------------------------------- the run mirror

// The command line believes an emulator runs only while run/emulator.json names its app, alive —
// the desktop app writes that mirror; a source-run server does not, but it writes run/server.lock
// with the same facts. Translating the lock into the mirror lets every bar command (run, install,
// stop, projects' on-the-bar flags) see this server. A lock whose process is gone is not mirrored.
function syncMirror() {
  try {
    const lockFile = path.join(DATA_DIR, "run", "server.lock");
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    if (!Number.isInteger(lock?.pid) || !Number.isFinite(lock?.started)) return;
    try {
      process.kill(lock.pid, 0);
    } catch {
      return;
    }
    const text = JSON.stringify(
      {
        pid: lock.pid,
        started: lock.started,
        exe: typeof lock.exe === "string" ? lock.exe : null,
        state: "ready",
        detail: null,
        port: lock.port ?? 8640,
        url: lock.url ?? `http://127.0.0.1:${lock.port ?? 8640}`,
      },
      null,
      2,
    );
    const mirror = path.join(DATA_DIR, "run", "emulator.json");
    try {
      if (readFileSync(mirror, "utf8") === text) return;
    } catch {
      // absent or unreadable: write it
    }
    writeFileSync(mirror, text);
  } catch {
    // no lock at all: no server, nothing to mirror
  }
}

// ----------------------------------------------------------------------------- the job channel

let nextJob = 1;
const devProcs = new Map(); // folder → child of a dev run still watching
const recordings = new Map(); // "front"|"window"… → { child, file }

/**
 * Runs `steps` in turn as one window job; each step is a command-line run whose stderr lines become
 * the job's. A step is either the argument list itself (`["build", folder]`) or `[args, label]` —
 * the label a line of its own first. Stops at the first step that fails.
 */
async function runSteps(steps, { jobKind, folder, emit }) {
  let last = null;
  for (const step of steps) {
    const [args, label] = Array.isArray(step?.[0]) ? step : [step, null];
    if (label) emit({ id: emit.jobId, kind: jobKind, folder, state: "running", line: label });
    last = await cli(args, { onLine: (line) => emit({ id: emit.jobId, kind: jobKind, folder, state: "running", line }) });
    if (!last?.ok) return last;
  }
  return last ?? { ok: false, code: "tool_failed", message: "Nothing ran.", hint: null };
}

// ----------------------------------------------------------------------------- the actions

const NO_BROWSER = (what) => ({
  ok: false,
  error: { code: "unavailable", message: `${what}需要桌面版模拟器：浏览器里运行的是 CLI 桥，没有这步的本机界面。`, hint: null },
});

async function createProject(arg, emit) {
  const place = arg?.place ?? {};
  const parent = place.parent || PROJECTS_ROOT;
  const dir = path.join(parent, place.folder || "my-app");
  await mkdir(parent, { recursive: true });
  const flags = ["create", dir];
  if (arg?.example) flags.push("--example", String(arg.example));
  if (arg?.name) flags.push("--name", String(arg.name));
  if (arg?.id) flags.push("--id", String(arg.id));
  if (arg?.author) flags.push("--author", String(arg.author));
  if (arg?.texts?.short_description) flags.push("--description", String(arg.texts.short_description));
  if (arg?.icon?.front?.data) {
    const file = await dataUrlToFile(arg.icon.front.data, "icon-front.png");
    if (file) flags.push("--icon", file);
  }
  if (arg?.icon?.back?.data) {
    const file = await dataUrlToFile(arg.icon.back.data, "icon-back.png");
    if (file) flags.push("--back-icon", file);
  }
  const made = await cli(flags, { onLine: (line) => emit({ id: emit.jobId, kind: "create", folder: dir, state: "running", line }) });
  if (!made.ok) return { ok: false, error: { code: made.code ?? "failed", message: made.message ?? "创建失败", hint: made.hint ?? null } };
  // The window's Refresh that ends Create app: build, then put it on the BUSY Bar and start it.
  const refreshed = await runSteps([["build", "Building…"], ["run", "Putting it on the BUSY Bar…"]].map(([cmd, label]) => [[cmd, dir], label]), { jobKind: "refresh", folder: dir, emit });
  const dependencies = made.dependencies?.state ? made.dependencies : { state: made.dependencies === "cache" || made.ok ? "ok" : "failed", reason: null };
  return {
    ok: true,
    value: {
      id: made.id ?? arg?.id ?? null,
      name: made.name ?? arg?.name ?? null,
      folder: made.folder ?? dir,
      unfinished: [],
      dependencies,
      refreshed: { ok: refreshed.ok !== false, message: refreshed.ok ? null : refreshed.message ?? null, hint: refreshed.hint ?? null, code: refreshed.code ?? null },
    },
  };
}

async function refreshProject(folder, emit) {
  const last = await runSteps([["build", "Building…"], ["run", "Putting it on the BUSY Bar…"]].map(([cmd, label]) => [[cmd, folder], label]), { jobKind: "refresh", folder, emit });
  return last.ok ? { ok: true, value: { ok: true } } : { ok: false, error: { code: last.code ?? "failed", message: last.message ?? "Refresh 失败", hint: last.hint ?? null } };
}

const oneStep = (cmd, kind) => async (arg, emit) => {
  const folder = typeof arg === "string" ? arg : arg?.folder;
  const last = await runSteps([[cmd, folder]], { jobKind: kind, folder, emit });
  return last.ok ? { ok: true, value: { ...last, message: last.message ?? null } } : { ok: false, error: { code: last.code ?? "failed", message: last.message ?? `${cmd} 失败`, hint: last.hint ?? null } };
};

async function importProject(folder, emit) {
  const tools = await trustTools().catch(() => null);
  tools?.trust(folder);
  const added = await cli(["projects", "--add", folder]);
  if (!added.ok) return { ok: false, error: { code: added.code ?? "failed", message: added.message, hint: added.hint } };
  const refreshed = await refreshProject(folder, emit);
  const info = projectInfo(folder);
  return { ok: true, value: { id: info.id, name: info.name, folder, refreshed: refreshed.ok ? { ok: true } : { ok: false, message: refreshed.error?.message ?? null, hint: refreshed.error?.hint ?? null } } };
}

async function devStart(folder, emit) {
  if (devProcs.has(folder)) return { ok: false, error: { code: "busy", message: "这个项目已经在监视中。", hint: null } };
  const child = spawn(process.execPath, [CLI, "dev", folder, "--json", "--progress"], { cwd: os.homedir(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  devProcs.set(folder, child);
  let rest = "";
  let out = "";
  child.stderr.on("data", (chunk) => {
    rest += chunk.toString("utf8");
    let at;
    while ((at = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, at).trim();
      rest = rest.slice(at + 1);
      if (line) emit({ id: emit.jobId, kind: "dev", folder, state: "running", line });
    }
  });
  child.stdout.on("data", (chunk) => (out += chunk));
  child.on("error", () => devProcs.delete(folder));
  return new Promise((resolve) => {
    child.on("close", () => {
      devProcs.delete(folder);
      const last = out.split("\n").filter((one) => one.trim()).at(-1);
      let parsed = null;
      try {
        parsed = last ? JSON.parse(last) : null;
      } catch {
        parsed = null;
      }
      resolve(parsed?.ok === false ? { ok: false, error: { code: parsed.code ?? "failed", message: parsed.message, hint: parsed.hint } } : { ok: true, value: { ended: true } });
    });
  });
}

const HANDLERS = {
  // -------------------------------------------------- projects
  async "projects.list"() {
    const answer = await cli(["projects"]);
    return answer.ok ? { ok: true, value: answer.projects ?? [] } : { ok: false, error: answer };
  },

  async "projects.examples"() {
    const answer = await cli(["create", "--examples", "--pictures"]);
    return answer.ok ? { ok: true, value: answer.examples ?? [] } : { ok: false, error: answer };
  },

  async "projects.place"(arg) {
    const parent = arg?.parent || PROJECTS_ROOT;
    const folder = arg?.folder || "my-app";
    const full = path.join(parent, folder);
    const author = await gitAuthor();
    let problem = null;
    try {
      if (statSync(full).isDirectory() && readdirSync(full).length) problem = `${homeRelative(full)} exists and is not empty`;
    } catch {
      // does not exist: the usual case
    }
    return {
      ok: true,
      value: {
        parent,
        shown: homeRelative(parent),
        folder,
        path: full,
        shownPath: homeRelative(full),
        namespace: author ? idPart(author.name) : null,
        author,
        ...(problem ? { problem } : {}),
      },
    };
  },

  async "projects.place.choose"(arg) {
    const chosen = await pickFolder(arg?.from ?? PROJECTS_ROOT);
    return { ok: true, value: chosen ? { parent: chosen } : null };
  },

  "projects.create": createProject,

  async "projects.open"(_arg, emit) {
    const chosen = await pickFolder(PROJECTS_ROOT);
    if (!chosen) return { ok: true, value: null };
    const dir = locateProject(chosen);
    if (!dir) return { ok: false, error: { code: "not_a_project", message: `${chosen} 不是应用项目（没有 src/appmeta/manifest.json）。`, hint: null } };
    return importProject(dir, emit);
  },

  async "projects.find"(arg) {
    const pick = arg?.pick ?? "any";
    const chosen = pick === "folder" ? await pickFolder(PROJECTS_ROOT) : pick === "file" ? await pickFile({ title: "Choose any file of the app's project" }) : (await pickFile({ title: "Choose the app's folder or any file in it" })) ?? (await pickFolder(PROJECTS_ROOT));
    if (!chosen) return { ok: true, value: null };
    const dir = locateProject(chosen);
    if (!dir) return { ok: true, value: { found: false, message: "所选位置不是应用项目（往上也没有找到 src/appmeta/manifest.json）。", chosen, shownChosen: homeRelative(chosen) } };
    const info = projectInfo(dir);
    const tools = await trustTools().catch(() => null);
    return {
      ok: true,
      value: {
        found: true,
        folder: dir,
        chosen,
        shownChosen: homeRelative(chosen),
        id: info.id,
        name: info.name,
        listed: tools ? tools.listed(dir) : true,
        trusted: tools ? tools.isTrusted(dir) : true,
      },
    };
  },

  "projects.import": (arg, emit) => importProject(String(arg ?? ""), emit),

  "projects.refresh": (arg, emit) => refreshProject(String(arg ?? ""), emit),

  "projects.build": oneStep("build", "build"),
  "projects.run": oneStep("run", "run"),
  "projects.stop": oneStep("stop", "stop"),
  "projects.check": oneStep("check", "check"),
  "projects.submit": oneStep("submit", "submit"),
  "projects.dependencies": oneStep("build", "refresh"),
  "projects.dependencies.auto": async () => ({ ok: true, value: { started: [] } }),
  "projects.retryDependencies": async () => ({ ok: true, value: { started: [] } }),

  "projects.dev.start": (arg, emit) => devStart(String(arg ?? ""), emit),

  async "projects.dev.stop"(arg) {
    const child = devProcs.get(String(arg ?? ""));
    if (!child) return { ok: true, value: { stopped: false } };
    killTree(child);
    devProcs.delete(String(arg));
    return { ok: true, value: { stopped: true } };
  },

  async "projects.package.install"(arg) {
    // 浏览器没有系统文件对话框：页面把选好的 .tgz 以 data: 地址传来，走固件的 stage→install→launch
    const match = /^data:[^;]*;base64,(.+)$/s.exec(String(arg?.data ?? ""));
    const raw = match ? Buffer.from(match[1], "base64") : null;
    if (!raw?.length) return { ok: false, error: { code: "no_package", message: "没有收到应用包数据。", hint: null } };
    const manifest = readPackageManifest(raw);
    if (!manifest?.id) return { ok: false, error: { code: "invalid_package", message: "这不是一个有效的应用包：里面读不到 appmeta/manifest.json。", hint: null } };
    const base = EMU_API;
    try {
      const staged = await fetch(`${base}/api/apps/stage`, { method: "POST", body: raw }).then((r) => r.json());
      if (!staged?.install_key) return { ok: false, error: { code: "stage_failed", message: staged?.error?.message ?? staged?.message ?? "设备拒绝了应用包。", hint: null } };
      const res = await fetch(`${base}/api/apps/install?install_key=${encodeURIComponent(staged.install_key)}`, { method: "POST" });
      if (!res.ok) return { ok: false, error: { code: "install_failed", message: `安装失败（HTTP ${res.status}）。`, hint: null } };
      const launched = await fetch(`${base}/api/apps/launch?app_id=${encodeURIComponent(manifest.id)}`, { method: "POST" });
      return {
        ok: true,
        value: {
          ok: true, id: manifest.id, name: manifest.name ?? manifest.id, version: manifest.version ?? null,
          running: launched.ok, file: arg?.name ?? null,
          message: `已安装 ${manifest.name ?? manifest.id}${launched.ok ? " 并启动" : ""}。`,
        },
      };
    } catch (error) {
      return { ok: false, error: { code: "bridge_down", message: `连不上模拟器设备 API（${base}）：${error?.message ?? error}`, hint: null } };
    }
  },

  // -------------------------------------------------- apps
  async "apps.delete"(arg) {
    const flags = ["uninstall", String(arg?.id ?? "")];
    if (arg?.withFiles) flags.push("--delete-files");
    const answer = await cli(flags);
    return answer.ok
      ? { ok: true, value: { ok: true, id: arg?.id ?? null, trashed: answer.trashed ?? arg?.withFiles === true, kept: false, message: firstLine(answer.text) } }
      : { ok: false, error: answer };
  },

  // -------------------------------------------------- terminal
  async "terminal.info"() {
    return { ok: true, value: { available: false, name: null, label: null, why: "浏览器版没有内嵌终端：用命令行 busy-emulator logs 看应用日志。" } };
  },
  "terminal.open": async () => NO_BROWSER("在系统终端里打开控制台"),

  // -------------------------------------------------- publishing, stage 1
  "publish.status": async (arg) => {
    const answer = await cli(["publish", "status", String(arg ?? "")]);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.check": async (arg) => {
    const answer = await cli(["publish", "check", String(arg ?? "")]);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.texts": async (arg) => {
    const flags = ["catalog-texts", "set", String(arg?.folder ?? "")];
    if (arg?.name) flags.push("--name", String(arg.name));
    const texts = arg?.texts ?? {};
    for (const key of ["short_description", "description", "changelog", "category"]) {
      if (texts[key]) flags.push(`--${key.replace(/_/g, "-")}`, String(texts[key]));
    }
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.icon": async (arg) => {
    const flags = ["icon", String(arg?.folder ?? "")];
    const front = await dataUrlToFile(arg?.front?.data ?? arg?.front, "publish-icon-front.png");
    if (!front) return { ok: false, error: { code: "usage", message: "没有可用的图标图片。", hint: null } };
    flags.push("--from", front);
    const back = await dataUrlToFile(arg?.back?.data ?? arg?.back, "publish-icon-back.png");
    if (back) flags.push("--back", back);
    flags.push("--force");
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.readme": async (arg) => {
    const readme = arg?.readme ?? {};
    const flags = ["publish", "readme", "set", String(arg?.folder ?? "")];
    if (readme.mode === "markdown" && readme.markdown) {
      flags.push("--mode", "markdown", "--markdown", String(readme.markdown));
    } else {
      if (readme.title) flags.push("--title", String(readme.title));
      if (readme.intro) flags.push("--intro", String(readme.intro));
      if (readme.usage) flags.push("--usage", String(readme.usage));
      if (Array.isArray(readme.controls) && readme.controls.length) flags.push("--controls", JSON.stringify(readme.controls));
    }
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.license": async (arg) => {
    const flags = ["publish", "license", String(arg?.folder ?? ""), "--license", String(arg?.license ?? "")];
    if (arg?.author) flags.push("--author", String(arg.author));
    if (arg?.replace) flags.push("--replace");
    if (arg?.upload) {
      const file = await pickFile({ title: "Choose your license's file", filter: "License files (*.txt;*.md)|*.txt;*.md|All files (*.*)|*.*" });
      if (!file) return { ok: true, value: { ok: false, code: "declined", message: "没有选择文件。" } };
      flags.push("--from", file);
    }
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.files": async (arg) => {
    const flags = ["publish", "files", String(arg?.folder ?? "")];
    if (arg?.write) flags.push("--write");
    for (const one of arg?.keepOut ?? []) flags.push("--keep-out", String(one));
    for (const one of arg?.keepIn ?? []) flags.push("--keep-in", String(one));
    if (arg?.readme === true) flags.push("--readme", "replace");
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.screenshots": async (arg) => {
    const flags = ["publish", "screenshots", String(arg?.folder ?? "")];
    if (arg?.take) flags.push("--take", arg.take === "back" ? "back" : "front");
    if (arg?.order) flags.push("--order", JSON.stringify(arg.order));
    if (arg?.remove) flags.push("--remove", String(arg.remove));
    if (arg?.upload) {
      const file = await pickFile({ title: "Choose the screenshot to upload", filter: "PNG images (*.png)|*.png" });
      if (!file) return { ok: true, value: { ok: false, code: "declined", message: "没有选择文件。" } };
      flags.push("--upload", JSON.stringify([file]));
      if (arg.upload === "front" || arg.upload === "back") flags.push("--display", arg.upload);
    }
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: answer } : { ok: false, error: answer };
  },
  "publish.package": async (arg, emit) => {
    const folder = typeof arg === "string" ? arg : arg?.folder;
    const steps = [];
    if (arg?.build) steps.push(["build", folder]);
    steps.push(["publish", "package", folder]);
    const last = await runSteps(steps, { jobKind: "publish", folder, emit });
    return last.ok ? { ok: true, value: last } : { ok: false, error: last };
  },

  // -------------------------------------------------- publishing, stage 2 (GitHub lives in the app)
  "github.status": async () => ({ ok: true, value: { signedIn: false, accounts: [] } }),
  "github.checklist": async () => NO_BROWSER("作者清单"),
  "github.signin": async () => NO_BROWSER("GitHub 登录"),
  "github.signin.wait": async () => NO_BROWSER("GitHub 登录"),
  "github.signin.cancel": async () => ({ ok: true, value: true }),
  "github.code.open": async () => NO_BROWSER("GitHub 登录"),
  "github.use": async () => NO_BROWSER("切换 GitHub 账号"),
  "github.signout": async () => ({ ok: true, value: true }),
  "github.name": async () => NO_BROWSER("GitHub 仓库名检查"),
  "github.push": async () => NO_BROWSER("推送到 GitHub"),
  "github.cancel": async () => ({ ok: true, value: true }),
  "github.request": async () => NO_BROWSER("向目录提 PR"),
  "github.entry": async () => NO_BROWSER("查询目录条目"),
  "github.lookup": async () => NO_BROWSER("GitHub 仓库查询"),
  "github.import": async () => NO_BROWSER("从 GitHub 导入"),
  "github.release.install": async () => NO_BROWSER("从 GitHub Release 安装"),

  // -------------------------------------------------- screenshots and recording
  "capture.screenshot": async (arg) => {
    await mkdir(CAPTURE_DIR, { recursive: true });
    const file = path.join(CAPTURE_DIR, `screenshot-${Date.now()}.png`);
    const flags = ["screenshot", "--out", file];
    if (Array.isArray(arg?.displays) && arg.displays.includes("back") && !arg.displays.includes("front")) flags.push("--back");
    const answer = await cli(flags);
    return answer.ok ? { ok: true, value: { file, name: arg?.name ?? null } } : { ok: false, error: answer };
  },
  "capture.record.start": async (arg, emit) => {
    await mkdir(CAPTURE_DIR, { recursive: true });
    const file = path.join(CAPTURE_DIR, `recording-${Date.now()}.mp4`);
    const child = spawn(process.execPath, [CLI, "record", "--out", file, "--layout", arg?.layout ?? "window", "--json"], { cwd: os.homedir(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const key = arg?.layout ?? "window";
    recordings.set(key, { child, file });
    child.on("close", () => {
      if (recordings.get(key)?.child === child) recordings.delete(key);
      emit({ id: emit.jobId, kind: "recording", capture: true, state: "ended", file });
    });
    emit({ id: emit.jobId, kind: "recording", capture: true, state: "recording", file });
    return { ok: true, value: { recording: true, file } };
  },
  "capture.record.stop": async () => {
    const answer = await cli(["record", "--stop"]);
    const file = [...recordings.values()][0]?.file ?? null;
    return answer.ok ? { ok: true, value: { file, saved: true } } : { ok: false, error: answer };
  },
  "capture.record.state": async () => ({ ok: true, value: { recording: recordings.size > 0, file: [...recordings.values()][0]?.file ?? null } }),
  "capture.reveal": async (arg) => ({ ok: true, value: reveal(String(arg ?? "")) }),

  // -------------------------------------------------- reporting / update: app-only
  "report.preview": async () => NO_BROWSER("预览问题报告"),
  "report.open": async () => NO_BROWSER("打开问题报告"),
  "report.save": async () => NO_BROWSER("保存诊断包"),
  "report.reveal": async () => NO_BROWSER("查看诊断包"),

  // -------------------------------------------------- window-level
  reveal: async (arg) => ({ ok: true, value: reveal(String(arg ?? "")) }),
  open: async (arg) => ({ ok: true, value: openPath(String(arg ?? "")) }),
  copy: async (arg) => ({ ok: true, value: await copyText(String(arg ?? "")) }),
  browse: async (arg) => ({ ok: true, value: openPath(String(arg ?? "")) }),

  "welcome.get": async () => ({ ok: true, value: { show: false, way: null, platform: process.platform, cli: `node "${CLI.replace(/\\/g, "/")}"` } }),
  "welcome.seen": async () => ({ ok: true, value: true }),

  // The app's built-in updater is an app thing; the window only asks because update-popup.js probes.
  "update.state": async () => ({ ok: true, value: { state: "none", canInstall: false } }),
  "update.popup": async () => ({ ok: true, value: { show: false } }),
  "update.download": async () => ({ ok: true, value: { started: false } }),
  "update.restart": async () => ({ ok: true, value: false }),

  "menu.get": async () => ({ ok: true, value: [] }),
};

/** Reads a JSON request body (small: names and options only). */
function readBody(req) {
  return new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** The connect-style middleware: POST /emu-shell/call { name, arg } → NDJSON of job lines + answer. */
export async function emulatorShell(req, res, next) {
  const url = (req.url ?? "").split("?")[0];
  if (url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(jsonLine({ ok: true, cli: existsSync(CLI) }));
    return;
  }
  if (url !== "/call" || req.method !== "POST") return next();

  syncMirror();
  const body = await readBody(req);
  const name = typeof body?.name === "string" ? body.name : null;
  const handler = name ? HANDLERS[name] : null;
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  const write = (value) => res.write(jsonLine(value));

  if (!handler) {
    write({ ok: false, error: { code: "unavailable", message: `浏览器工具桥不认识动作 ${JSON.stringify(name)}。`, hint: null } });
    return void res.end();
  }

  const jobId = nextJob++;
  const emit = (job) => {
    if (!res.writableEnded && !res.destroyed) write({ job });
  };
  emit.jobId = jobId;

  try {
    const answer = await handler(body.arg, emit);
    write(answer);
  } catch (error) {
    write({ ok: false, error: { code: "internal", message: String(error?.message ?? error), hint: null } });
  }
  res.end();
}

// index.html 固定引入 browser-shell.js：不需要注入中间件。桥不在时 action() 回落 bridge_down。
