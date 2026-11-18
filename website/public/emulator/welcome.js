// The first run's greeting (EMU-207): with no project yet, the window asks one question, "How will you make your app?",
// before it shows its empty work area. Two answers:
//
//   - "I'll write the code": the window's own Create app (its pop-up: a template, or an empty app with its name and
//     icon), and in the App section three steps: edit src/main.ts (with Show in Finder/Explorer, which opens the
//     project's folder), press Refresh, Publish.
//   - "My AI agent will": a short text to paste into an agent that runs commands (Claude Code, Codex, Cursor), with
//     the command line's path for the system the app runs on (on Windows in a form that runs in PowerShell, Git Bash
//     and cmd alike when the path allows it, else the form for each), and a button that creates the project for the agent
//     first, so that the text names its folder.
//
// Answered or closed, the greeting does not come by itself again: the desktop app writes that down in its own settings,
// in its data folder (window.emulatorActions.welcome.seen), never in a project, with the way the person chose.
// "Getting started" at the foot of the Apps section opens it again, on that way: the text for the agent, or the three
// lines on writing the code with Create app. Back leads to the question, to choose the other way. In a plain browser
// there is no desktop app: no greeting and no link.
//
// The window's own script (window.js) asks this one for the steps of a new app (emulatorWelcome.hintFor) and tells it
// of an app it created (emulatorWelcome.created); this one starts the window's Create app (emulatorWindow.createApp).
// Everything from a project (its folder) is put on the page as text. Every action with consequences is called from
// the person's click or key, in its handler.
(() => {
  const MCP_GUIDE = "https://github.com/busy-app/busybar-emulator/blob/main/public-docs/mcp.md";
  const WAYS = ["code", "agent"];
  const MAIN_FILE = "src/main.ts";

  // ---------------------------------------------------------------- the text for agents (no page needed)

  /** A POSIX shell word for a path, `~/` left to the shell when the rest needs no quotes or after them. */
  function shellWord(path) {
    const plain = (text) => /^[A-Za-z0-9_./~+-]+$/.test(text);
    const quoted = (text) => `'${text.replace(/'/g, `'\\''`)}'`;
    if (plain(path)) return path;
    if (path.startsWith("~/")) return `~/${quoted(path.slice(2))}`;
    return quoted(path);
  }

  /**
   * A Windows path that runs as a command unquoted, with forward slashes, in PowerShell, Git Bash and cmd alike: a
   * drive, then names of letters (any alphabet), digits, `_`, `.` and `-`. A space, `&`, `(`, `'`, `$`, `%` and the
   * like need quotes, and no quoting works in all three shells.
   */
  const ANY_SHELL = /^[A-Za-z]:[\\/](?:[\p{L}\p{N}_.-]+[\\/])*[\p{L}\p{N}_.-]+$/u;

  /**
   * How each shell an agent on Windows may run calls the command line (PowerShell: Codex, Cursor and Claude Code's
   * PowerShell tool; Git Bash: Claude Code's Bash tool; cmd). `any`: the one form for all three, when the path has
   * one; else `bash` or `cmd` may be null where no quoting of the path works in that shell. Without a path from the
   * desktop app (a run from the source folder), the fixed path (ADR-0002 §7a), from the variable each shell reads.
   */
  function windowsCalls(cli) {
    if (!cli) {
      return {
        any: null,
        powershell: `& "$env:LOCALAPPDATA\\busy-emulator\\bin\\busy-emulator.exe"`,
        bash: `"$LOCALAPPDATA/busy-emulator/bin/busy-emulator.exe"`,
        cmd: `"%LOCALAPPDATA%\\busy-emulator\\bin\\busy-emulator.exe"`,
      };
    }
    const forward = cli.replace(/\\/g, "/");
    if (ANY_SHELL.test(cli)) return { any: forward, powershell: forward, bash: forward, cmd: forward };
    return {
      any: null,
      powershell: `& '${cli.replace(/'/g, "''")}'`,
      // In double quotes Git Bash still reads $ and `, and cmd reads %; in single quotes cmd reads nothing.
      bash: /[$`]/.test(forward) ? `'${forward.replace(/'/g, `'\\''`)}'` : `"${forward}"`,
      cmd: /%/.test(cli) ? null : `"${forward}"`,
    };
  }

  /**
   * How the command line is called in the text's steps, for the system the app runs on: on Windows the one form for
   * every shell when the path has one, else PowerShell's, `& '<path>'`; elsewhere the path as a word of the shell.
   * Without a path from the desktop app (a run from the source folder), the fixed path the app writes at every start.
   */
  function cliCall({ platform, cli }) {
    if (platform === "win32") {
      const calls = windowsCalls(cli);
      return calls.any ?? calls.powershell;
    }
    return cli ? shellWord(cli) : "~/.busy-emulator/bin/busy-emulator";
  }

  /** The path to allow in an agent's permissions, as a person reads it. */
  function cliPath({ platform, cli }) {
    if (platform === "win32") return cli ? (windowsCalls(cli).any ?? cli) : "%LOCALAPPDATA%\\busy-emulator\\bin\\busy-emulator.exe";
    return cli ?? "~/.busy-emulator/bin/busy-emulator";
  }

  /** On Windows, the line under the path: why it is written so, or how the other shells call it. */
  function windowsShells(cli) {
    const calls = windowsCalls(cli);
    if (calls.any) return "照原样写，用正斜杠、不加引号：PowerShell、Git Bash 和 cmd 里都能运行。";
    const others = calls.bash === calls.cmd ? [`in Git Bash or cmd as ${calls.bash}`] : [`in Git Bash as ${calls.bash}`, ...(calls.cmd ? [`in cmd as ${calls.cmd}`] : [])];
    return `That is for PowerShell, as in the steps below; call it ${others.join(", ")}.`;
  }

  /**
   * The text to paste into an agent. `folder`: the project the window created for it; without one, the agent creates
   * it. Plain text, the same facts and words as the emulator's block in a project's AGENTS.md.
   */
  function agentText({ platform, cli = null, folder = null }) {
    const call = cliCall({ platform, cli });
    const windows = platform === "win32";
    const first = folder
      ? [`1. 项目已在这个文件夹里：${folder}`, "   在这个文件夹里工作，先读它的 AGENTS.md。"]
      : [`1. ${call} create my-app`, "   它会用官方模板创建 my-app 文件夹。在这个文件夹里工作，先读它的 AGENTS.md。"];
    return [
      "帮我为桌面设备模拟器开发一个应用。设备是一块带 72×16 LED 点阵屏、小背屏、按键和滚轮的桌面硬件；我没有真机，模拟器在本机运行着同款固件，窗口已经打开。",
      "",
      `用它的命令行（完整路径调用）：${call}`,
      ...(windows ? [windowsShells(cli)] : []),
      "每条命令单独执行，不要拼接。加 --json 可得到单行结果；失败时它的 hint 会指出下一步。",
      "",
      ...first,
      `2. ${call} dev --once`,
      "   构建应用、安装到模拟器并启动。",
      `3. ${call} screenshot --scale 8`,
      "   把模拟器屏幕当前显示截图到 screenshots/ 目录：去看它。",
      `4. ${call} logs`,
      "   查看应用的 console.log、报错和退出原因。",
      "",
      `每次改动后重新执行第 2 到 4 步。${call} help 列出其余命令。`,
      "",
      "我对这个应用的想法：",
    ].join("\n");
  }

  /**
   * The text to go on with an app that is there, from its own page in the window (app-column: Copy prompt for AI):
   * its name and id, its folder, the command line's path in the platform's form, the commands to build, see and read
   * it, and the rule to ask before publishing. Made at the click, with the real values.
   */
  function appPrompt({ platform, cli = null, name, id, folder }) {
    const call = cliCall({ platform, cli });
    return [
      `和我一起开发模拟器应用 "${name}"（${id}）。设备是一块带 72×16 LED 点阵屏、小背屏、按键和滚轮的桌面硬件，模拟器在本机运行着同款固件。`,
      "",
      `项目在这个文件夹里：${folder}`,
      "在那里工作，先读它的 AGENTS.md。",
      "",
      `用模拟器的命令行（完整路径调用）：${call}`,
      ...(platform === "win32" ? [windowsShells(cli)] : []),
      "在项目的文件夹里，每条命令单独执行：",
      `1. ${call} dev --once`,
      "   构建应用、安装到模拟器并启动。",
      `2. ${call} screenshot --scale 8`,
      "   把模拟器屏幕当前显示截图到 screenshots/ 目录：去看它。",
      `3. ${call} logs`,
      "   查看应用的 console.log、报错和退出原因。",
      "",
      "每次改动后重新执行第 1 到 3 步。模拟器窗口是开着的，dev --once 后或我在窗口里点 Refresh 后会显示新版本。",
      "发布应用或提交到应用目录之前，先问我。",
      "",
      "接下来我想要：",
    ].join("\n");
  }

  /** What allowing the command means, for the person: one line under the text. */
  function permissionLine({ platform, cli = null }) {
    const path = cliPath({ platform, cli });
    // Claude Code on Windows runs commands with its PowerShell tool and, with Git for Windows, its Bash tool (Git
    // Bash): a rule for each, written as the command is.
    const calls = platform === "win32" ? windowsCalls(cli) : null;
    const rules = calls ? `PowerShell(${calls.powershell} *) and Bash(${calls.bash} *)` : `Bash(${cliCall({ platform, cli })} *)`;
    const claude = `（在 Claude Code 里：${rules}）`;
    return `为了不让 AI 每一步都向你确认，把命令 ${path} 加进它的权限白名单${claude}。这样它就能在本机构建并运行项目代码。`;
  }

  const api = {
    agentText,
    appPrompt,
    permissionLine,
    cliCall,
    windowsCalls,
    MCP_GUIDE,
    MAIN_FILE,
    hintFor: () => null,
    created: () => {},
    open: () => {},
    // Settles once the first run has decided whether the greeting shows (the update's pop-up waits for it).
    decided: Promise.resolve(),
  };
  globalThis.emulatorWelcome = api;

  if (typeof document === "undefined" || typeof document.createElement !== "function") return;

  // ---------------------------------------------------------------- the page

  const actions = () => globalThis.emulatorActions ?? null;
  const inShell = () => {
    try {
      return actions()?.available?.().shell === true;
    } catch {
      return false;
    }
  };
  if (!inShell()) return;

  const NO_GESTURE = "no_gesture";
  const icon = (name) => `<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><use href="/sgp/emulator/icons/busy-sprite.svg#bi-${name}"/></svg>`;
  function make(tag, className = "", text = null) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== null) el.textContent = text;
    return el;
  }
  function button(className, label, onClick, picture = null) {
    const el = make("button", className);
    el.type = "button";
    if (picture) el.innerHTML = icon(picture);
    if (label) el.append(make("span", "", label));
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e);
    });
    return el;
  }

  // What the desktop app said: the system it runs on and the command line's path. Until it has, the browser's guess.
  let facts = { platform: /win/i.test(globalThis.navigator?.platform ?? "") ? "win32" : "darwin", cli: null };
  let way = null; // the way the person chose last time, as the desktop app keeps it: "code", "agent" or null
  let agentFolder = null; // the project the greeting created for the agent
  let writing = false; // the person chose to write the code: the next app created gets its three steps
  let stepsFolder = null; // the project whose three steps the App section shows
  const fileManager = () => (facts.platform === "win32" ? "Explorer" : "Finder");

  // ---- the three steps of a new app, in the App section

  const steps = make("section", "first-steps");
  steps.ariaLabel = "下一步";
  const stepsHead = make("div", "first-steps-head");
  const hide = button("icon-btn small", "", () => {
    stepsFolder = null;
    steps.remove();
  }, "cross");
  hide.ariaLabel = "收起引导";
  hide.title = "收起引导";
  stepsHead.append(make("b", "", "应用已就绪"), hide);
  const list = make("ol");
  const one = make("li");
  const edit = make("span");
  edit.append("在编辑器里修改 ", make("code", "", MAIN_FILE), "。");
  // Show in Finder/Explorer: the desktop app opens the project's folder itself, its files in view.
  const show = button("btn soft", "", () => {
    actions()
      .reveal(stepsFolder)
      .catch(() => {});
  });
  one.append(edit, show);
  const two = make("li");
  two.append("点 ", make("b", "", "Refresh"), "：模拟器会重新运行你的改动。");
  const three = make("li");
  three.append("准备好后点 ", make("b", "", "Publish"), " 发布到应用目录。");
  list.append(one, two, three);
  steps.append(stepsHead, list);

  api.hintFor = (project) => {
    if (!project || !stepsFolder || project.folder !== stepsFolder) return null;
    show.innerHTML = icon("folder");
    show.append(make("span", "", "显示项目文件夹"));
    show.title = "在文件管理器中打开项目文件夹";
    return steps;
  };
  api.created = (project) => {
    if (!writing || !project?.folder) return;
    writing = false;
    stepsFolder = project.folder;
  };


  /**
   * The person answered: the greeting does not come by itself again. `chosen`, a way they chose, is kept for the next
   * "Getting started". A refusal changes nothing they see.
   */
  function seen(chosen = null) {
    if (WAYS.includes(chosen)) way = chosen;
    actions()
      .welcome.seen(chosen ? { way: chosen } : undefined)
      .catch(() => {});
  }

  let closeGreeting = () => {};
  /** "I'll write the code": the window's own Create app (its pop-up: a template, or an empty app with its name and icon). */
  function writeCode() {
    seen("code");
    writing = true;
    closeGreeting();
    globalThis.emulatorWindow?.createApp?.();
  }
  api.writeCode = writeCode;

  // ---- the greeting: a card over the window, which waits behind it (only on a whole page)

  if (!document.body || typeof document.body.append !== "function") return;

  const root = make("div", "welcome");
  root.id = "welcome";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "welcome-title");
  const card = make("div", "welcome-card");
  card.tabIndex = -1;
  const close = button("icon-btn welcome-close", "", () => finish(), "cross");
  close.ariaLabel = "关闭";
  close.title = "关闭并直接开始（不创建项目）";

  // The question.
  const ask = make("div", "welcome-step");
  ask.dataset.step = "ask";
  const title = make("h1", "", "你想怎么开发应用？");
  title.id = "welcome-title";
  const choiceCode = make("button", "choice");
  choiceCode.type = "button";
  choiceCode.dataset.choice = "code";
  choiceCode.innerHTML = `<span class="round">${icon("code")}</span><b>我自己写代码</b><span>创建一个项目，然后在你自己的编辑器里修改</span>`;
  choiceCode.addEventListener("click", () => writeCode());
  const choiceAgent = make("button", "choice");
  choiceAgent.type = "button";
  choiceAgent.dataset.choice = "agent";
  choiceAgent.innerHTML = `<span class="round">${icon("sparkles")}</span><b>交给 AI 来写</b><span>生成一段提示词，粘贴给 Claude Code、Codex 或 Cursor</span>`;
  choiceAgent.addEventListener("click", () => toAgent());
  const choices = make("div", "choices");
  choices.append(choiceCode, choiceAgent);
  ask.append(make("p", "welcome-kicker", "欢迎使用模拟器"), title, make("p", "welcome-lead", "这里运行着一台完整固件的桌面设备模拟器。为它开发应用，在模拟器里看效果，然后发布到应用目录。"), choices);

  // The text for the agent.
  const agent = make("div", "welcome-step");
  agent.dataset.step = "agent";
  agent.hidden = true;
  const agentTitle = make("h1", "", "把这段提示词粘贴给你的 AI");
  const prompt = make("pre", "welcome-prompt");
  prompt.tabIndex = 0;
  prompt.setAttribute("aria-label", "给你的 AI 的提示词");
  const copy = button("btn solid", "复制", () => copyPrompt(), "copy");
  copy.id = "welcome-copy";
  const createForAgent = button("btn", "先创建项目文件夹", () => createAgentProject(), "folder");
  createForAgent.id = "welcome-create";
  createForAgent.title = "在选定的文件夹里创建项目，提示词里会带上它的路径";
  const showAgentFolder = button("btn", "", () => {
    actions()
      .reveal(agentFolder)
      .catch(() => {});
  }, "folder");
  showAgentFolder.id = "welcome-show";
  showAgentFolder.hidden = true;
  const said = make("span", "welcome-said");
  said.setAttribute("aria-live", "polite");
  const agentRow = make("div", "welcome-row");
  agentRow.append(copy, createForAgent, showAgentFolder, said);
  const permission = make("p", "welcome-note");
  const mcp = make("p", "welcome-note");
  const guide = make("a", "", "接入方法");
  guide.href = MCP_GUIDE;
  guide.target = "_blank";
  guide.rel = "noopener noreferrer";
  mcp.append("Claude Desktop 这类不能执行命令的聊天应用，可以把模拟器作为 MCP 服务接入。", guide);
  const backToAsk = button("btn", "返回", () => showStep("ask"), "arrow-left");
  const done = button("btn soft", "开始使用", () => finish());
  done.id = "welcome-done";
  const foot = make("div", "welcome-foot");
  foot.append(backToAsk, done);
  agent.append(agentTitle, make("p", "welcome-lead", "适用于 Claude Code、Codex、Cursor，或任何能在本机执行命令的 AI 助手。"), prompt, agentRow, permission, mcp, foot);

  // Writing the code: where it is, what the bar can do, how to see a change; then Create app. "Getting started" opens
  // on it for a person who chose this way before.
  const code = make("div", "welcome-step");
  code.dataset.step = "code";
  code.hidden = true;
  const codeLines = make("ol", "welcome-lines");
  const where = make("li");
  where.append("应用代码在项目文件夹里的 ", make("code", "", MAIN_FILE), "。");
  const what = make("li");
  what.append("设备能力说明在同一文件夹的 ", make("code", "", "types/"), " 和 ", make("code", "", "AGENTS.md"), " 里。");
  const see = make("li");
  see.append("改完点应用区的 ", make("b", "", "Refresh"), "：模拟器会重新运行你的改动。");
  codeLines.append(where, what, see);
  const createApp = button("btn solid", "创建应用", () => writeCode(), "plus");
  createApp.id = "welcome-create-app";
  const codeRow = make("div", "welcome-row");
  codeRow.append(createApp);
  const codeFoot = make("div", "welcome-foot");
  codeFoot.append(
    button("btn", "返回", () => showStep("ask"), "arrow-left"),
    button("btn soft", "开始使用", () => finish()),
  );
  code.append(make("h1", "", "自己动手写代码"), make("p", "welcome-lead", "创建一个项目，然后在你自己的编辑器里开发。改动会通过这台模拟器运行。"), codeLines, codeRow, codeFoot);

  card.append(close, ask, agent, code);
  root.append(card);
  document.body.append(root);

  // "Getting started", at the foot of the Apps section: the greeting again, whenever the person wants it.
  const reopen = make("button", "quiet-link welcome-link", "入门指引");
  reopen.type = "button";
  reopen.id = "welcome-open";
  reopen.title = "如何开发应用：自己动手，或交给 AI 助手";
  reopen.addEventListener("click", () => open());
  document.querySelector(".apps-card")?.append(reopen);

  /** The rest of the window waits while the greeting is up: no clicks, no focus, no keys for the bar. */
  const behind = () => [document.querySelector("header.topbar"), document.querySelector("aside.side"), document.querySelector("main#stage")].filter(Boolean);
  function setOpen(shown) {
    root.hidden = !shown;
    for (const el of behind()) el.inert = shown;
    if (shown) card.focus({ preventScroll: true });
  }

  function renderPrompt() {
    prompt.textContent = agentText({ ...facts, folder: agentFolder });
    permission.textContent = permissionLine(facts);
    createForAgent.hidden = agentFolder !== null;
    showAgentFolder.hidden = agentFolder === null;
    showAgentFolder.replaceChildren(showAgentFolder.firstChild, make("span", "", "显示项目文件夹"));
    showAgentFolder.title = `Open the project's folder in ${fileManager()}`;
  }

  function showStep(step) {
    ask.hidden = step !== "ask";
    agent.hidden = step !== "agent";
    code.hidden = step !== "code";
    if (step === "agent") renderPrompt();
    card.scrollTop = 0;
    card.focus({ preventScroll: true });
  }

  /** The greeting: on the way the person chose last time, else on the question. */
  function open(step = way ?? "ask") {
    said.textContent = "";
    showStep(step);
    setOpen(true);
  }

  function finish() {
    seen();
    setOpen(false);
  }

  closeGreeting = () => setOpen(false);
  api.open = open;

  function toAgent() {
    seen("agent");
    showStep("agent");
  }

  async function copyPrompt() {
    let answer = false;
    try {
      answer = (await actions().copy(prompt.textContent)) !== false;
    } catch (e) {
      answer = e?.code === NO_GESTURE ? "again" : false;
    }
    said.className = "welcome-said";
    said.textContent = answer === "again" ? "请再点一次" : answer ? "已复制" : "复制失败";
  }

  let creating = false;
  async function createAgentProject() {
    if (creating) return;
    creating = true;
    said.className = "welcome-said working";
    said.textContent = "正在创建项目：需要下载模板，约一分钟";
    createForAgent.ariaDisabled = "true";
    let made = null;
    try {
      made = await actions().projects.create({ example: null });
      said.className = "welcome-said";
      said.textContent = made ? "项目已就绪。请再复制一次提示词" : "";
    } catch (e) {
      said.className = "welcome-said failed";
      said.textContent = e?.code === NO_GESTURE ? "请再点一次" : [`项目创建失败：${e?.message ?? e}`, e?.hint].filter(Boolean).join(" ");
    }
    creating = false;
    createForAgent.ariaDisabled = "false";
    if (made?.folder) {
      agentFolder = made.folder;
      renderPrompt();
    }
  }

  // While it is up, the keys are the greeting's: Escape closes it, and none of them reaches the bar.
  addEventListener(
    "keydown",
    (e) => {
      if (root.hidden) return;
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    },
    true,
  );

  // ---- the first run: the greeting shows by itself when it was never answered and there is no project yet

  async function start() {
    let answer;
    let projects;
    try {
      [answer, projects] = await Promise.all([actions().welcome.get(), actions().projects.list()]);
    } catch {
      return; // A desktop app without the greeting: the window as it is.
    }
    facts = { platform: typeof answer?.platform === "string" ? answer.platform : facts.platform, cli: typeof answer?.cli === "string" ? answer.cli : null };
    way = WAYS.includes(answer?.way) ? answer.way : null;
    if (answer?.show && Array.isArray(projects) && projects.length === 0) open("ask");
  }
  api.decided = start().catch(() => {});
})();
