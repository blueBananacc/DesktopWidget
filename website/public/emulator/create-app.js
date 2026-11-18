// window.emulatorCreateApp: the device window's Create app (README.md beside this file, "Create app"). A dialog in the
// middle of the dimmed window, as tall as what it holds, with four ways to start as a row of tabs at its top:
//
//   - Templates: the official template and the emulator's example apps, each a card with its icon, its name, a line
//     and a frame of its front display; one is chosen, then its name and where its folder goes, then Create.
//   - Empty app: the official template with the person's own name, id, catalog texts and icon, asked right away.
//   - Open existing: a project already on the computer. The system's dialog takes its folder or any file in it; the
//     desktop app finds the project around it (`projects.find`), the pop-up says what it found, and Open opens it as
//     Open App Folder does, the trust dialog included (`projects.import`), then starts it.
//   - Import from GitHub: a repository on github.com, named by its address or owner/name, downloaded through the
//     desktop app's GitHub CLI as the signed-in account into a new folder of the Location (`github.import`), then
//     opened as Open existing opens a project: the trust dialog, the Apps list, a start on the bar. Also how an author
//     picks up their app on another computer.
//
// Creating is the desktop app's `projects.create` (actions.js): the command line's create, then catalog-texts and
// icon on the new project. The page names no path of its own: the place is the default one or the one the person chose
// in the system's dialog (`projects.choosePlace`), and the folder's name is a plain name the desktop app checks. The
// name, the id and the texts are checked as they are typed by the catalog's own rules (/sgp/emulator/readiness/rules.mjs
// and texts.mjs, which the server serves as they are); the desktop app and the command line check them again.
//
// Everything from a project or an example (names, lines, paths, messages) is shown as text, never as markup. Every
// action with consequences is called from the person's click or key, in its handler.
(() => {
  const NO_GESTURE = "no_gesture";
  const NAME_LIMIT = 32;
  const ID_LIMIT = 32;
  const DEFAULT_NAME = "我的应用";

  const actions = () => globalThis.emulatorActions ?? null;
  const icon = (name) => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? `<svg class="bi" viewBox="0 0 24 24" aria-hidden="true"><use href="/sgp/emulator/icons/busy-sprite.svg#bi-${name}"/></svg>` : "");

  // ---------------------------------------------------------------- the rules (pure: tested on plain Node)

  // The catalog's rules, loaded when the pop-up first opens. Until they are (or where they cannot be), the plain
  // ones below check the same limits; the desktop app and the command line check everything again.
  let rules = null;
  const ID_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+){2,}$/;
  const NAME_PATTERN = /^[A-Za-z0-9 !?&'()+,\-./:#$%@_]+$/;
  const plainRules = {
    nameProblem(name) {
      if (typeof name !== "string" || !name) return "名称不是文本或为空";
      if ([...name].length > NAME_LIMIT) return `名称有 ${[...name].length} 个字符，上限是 ${NAME_LIMIT}`;
      if (name !== name.trim() || name.includes("  ")) return "名称首尾或中间不能有连续空格";
      return NAME_PATTERN.test(name) ? null : "只能使用英文字母、数字、单个空格和 ! ? & ' ( ) + , - . / : # $ % @ _";
    },
    idProblem: (id) => (typeof id === "string" && ID_PATTERN.test(id) ? null : "只能用小写英文字母、数字、_、- 和点，且至少有两个点"),
    genericAuthor: (name) => ["user", "users", "admin", "administrator", "owner", "pc", "guest", "root", "default"].includes(idPart(name)),
    CATEGORIES: [],
    textProblems: (texts) => {
      const short = texts?.short_description ?? "";
      const n = [...short].length;
      return { problems: { short_description: n < 10 ? `${n} characters: the short description needs at least 10.` : n > 120 ? `${n} characters: the catalog takes at most 120.` : null } };
    },
  };
  const ruleBook = () => rules ?? plainRules;

  /** Gives the pop-up the catalog's rules: rules.mjs and texts.mjs as modules (the page loads them; a test passes them). */
  function useRules({ rules: catalog, texts }) {
    rules = { nameProblem: catalog.nameProblem, idProblem: catalog.idProblem, genericAuthor: catalog.genericAuthor ?? plainRules.genericAuthor, CATEGORIES: catalog.CATEGORIES, textProblems: texts.textProblems };
  }

  async function loadRules() {
    if (rules) return;
    try {
      const [catalog, texts] = await Promise.all([import("/sgp/emulator/readiness/rules.mjs"), import("/sgp/emulator/readiness/texts.mjs")]);
      useRules({ rules: catalog, texts });
    } catch {
      // The plain rules stand in; Create is checked again where the project is made.
    }
  }

  /** A sentence of the rules, as the form says it: capital first, a full stop at the end. */
  const sentence = (text) => (text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : null);

  /** One part of an id from a text: lower-case Latin letters and digits, a run of spaces and dots as one "_". */
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

  /** The project's folder name from the app's name: "Focus Timer" gives focus-timer. */
  function folderFor(name) {
    const folder = String(name ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "");
    return folder || "my-app";
  }

  /**
   * The id a new app gets unless the person writes another: app.<author>.<name>, as the template's generator makes it,
   * cut to 32 characters, and with _2, _3 when another project or an app on the bar has it already.
   */
  function suggestId(name, namespace, taken = []) {
    const app = idPart(name) || "my_app";
    let prefix = `app.${idPart(namespace) || "example"}.`;
    if (ID_LIMIT - prefix.length < Math.min(app.length, 8)) prefix = "app.example.";
    const cut = (part, room) => part.slice(0, Math.max(1, room)).replace(/[_-]+$/, "") || part.slice(0, 1);
    const id = prefix + cut(app, ID_LIMIT - prefix.length);
    const used = new Set(taken);
    if (!used.has(id)) return id;
    for (let n = 2; n < 1000; n++) {
      const candidate = prefix + cut(app, ID_LIMIT - prefix.length - String(n).length - 1) + `_${n}`;
      if (!used.has(candidate)) return candidate;
    }
    return id;
  }

  /**
   * What is wrong with the form of a way, field by field (null where nothing is), and whether Create may be pressed.
   * `form`: { name, author, id, idEdited, short_description, category, icons }; `context`: { taken, place, way }.
   */
  function problemsOf(form, { taken = [], place = null, way = "empty" } = {}) {
    const book = ruleBook();
    const out = { name: null, author: null, id: null, short_description: null, category: null, place: null };
    if (asksAuthor(place)) {
      const author = (form.author ?? "").trim();
      if (!author) out.author = "填写你的 GitHub 用户名或名字：应用 ID 由它生成。";
      else if (/["\\\u0000-\u001f\u007f]/.test(author)) out.author = "不能包含引号或反斜杠。";
      else if (!idPart(author)) out.author = "只能用英文字母或数字：应用 ID 由它生成。";
      else if (book.genericAuthor(author)) out.author = `"${author}" 是很多人电脑共用的名字：别人的应用会得到相同 ID。请写你的 GitHub 用户名或自己的名字。`;
    }
    const name = form.name ?? "";
    if (!name.trim()) out.name = "填写应用名称。";
    else {
      const problem = book.nameProblem(name);
      if (problem) out.name = sentence(problem);
    }
    const id = idOf(form, { taken, namespace: namespaceFor(form, place) });
    const idProblem = book.idProblem(id);
    if (idProblem) out.id = sentence(idProblem);
    else if (id.length > ID_LIMIT) out.id = `ID 有 ${id.length} 个字符，设备上限是 ${ID_LIMIT}。`;
    else if (taken.includes(id)) out.id = "模拟器里已有应用使用这个 ID。";
    if (way === "empty") {
      const short = form.short_description ?? "";
      if (short.trim()) out.short_description = book.textProblems({ short_description: short }).problems.short_description ?? null;
      if (form.category && book.CATEGORIES.length && !book.CATEGORIES.some((one) => one.id === form.category)) out.category = "不是目录里的有效分类。";
    }
    if (!place) out.place = "正在确定文件夹位置";
    else if (place.problem) out.place = place.problem;
    return { ...out, ok: Object.values(out).every((one) => one === null) };
  }

  /**
   * Whether the form asks for the author: the desktop app knows none (no GitHub login, and git's user.name and the
   * account's name are missing or ones many computers share: actions.mjs, newAppAuthor). An older app says nothing.
   */
  function asksAuthor(place) {
    return Boolean(place) && place.author === null;
  }

  /** The id's namespace: the author the person writes when the form asks for one, else the desktop app's. */
  function namespaceFor(form, place) {
    return asksAuthor(place) ? (form.author ?? "") : (place?.namespace ?? null);
  }

  /** The id the form will use: the one the person wrote, or the one made from the name. */
  function idOf(form, { taken = [], namespace = null } = {}) {
    return form.idEdited ? (form.id ?? "") : suggestId(form.name, namespace, taken);
  }

  /**
   * What Create sends for the icons: the PNGs uploaded and checked by the icon block (icon-block.js), each drawn at its
   * size; none when nothing was, and the command line's create gives the app the default icon. A front alone: the back
   * is made from it; a back alone: the front stays the default one.
   */
  function iconRequest(form) {
    const front = form.icons?.front?.draft ?? null;
    const back = form.icons?.back?.draft ?? null;
    return front || back ? { ...(front ? { front } : {}), ...(back ? { back } : {}) } : null;
  }

  /** The form's answers as `projects.create` takes them. */
  function requestOf(way, form, { taken = [], place, example = null }) {
    const request = { example: way === "templates" ? example : null, name: form.name, id: idOf(form, { taken, namespace: namespaceFor(form, place) }), place: { parent: place.parent, folder: place.folder } };
    if (asksAuthor(place)) request.author = (form.author ?? "").trim();
    if (way === "empty") {
      const texts = {};
      if (form.short_description?.trim()) texts.short_description = form.short_description;
      if (form.category) texts.category = form.category;
      if (Object.keys(texts).length) request.texts = texts;
      const icon = iconRequest(form);
      if (icon) request.icon = icon;
    }
    return request;
  }

  /**
   * The person's app that has the name being typed (create-offline: creating again while the first one waited for the
   * network made rows of the same name, nothing said so). `existing`: [{ id, name, folder, shown }]. Letter case and
   * spaces around do not tell names apart.
   */
  function sameName(existing, name) {
    const wanted = String(name ?? "").trim().toLowerCase();
    if (!wanted || !Array.isArray(existing)) return null;
    return existing.find((one) => typeof one?.name === "string" && one.name.trim().toLowerCase() === wanted) ?? null;
  }

  const api = { useRules, idPart, folderFor, suggestId, problemsOf, idOf, asksAuthor, namespaceFor, requestOf, sameName };
  globalThis.emulatorCreateApp = api;

  // ---------------------------------------------------------------- the pop-up

  if (typeof document === "undefined" || !document.body || typeof document.body.append !== "function") return;

  function make(tag, className = "", text = null) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== null) el.textContent = text;
    return el;
  }
  function button(className, label, onClick, { picture = null, title = "", disabled = null } = {}) {
    const el = make("button", className);
    el.type = "button";
    if (picture) el.innerHTML = icon(picture);
    if (label) el.append(make("span", "", label));
    el.title = disabled ?? title;
    el.ariaDisabled = disabled ? "true" : "false";
    el.addEventListener("click", (e) => {
      e.stopPropagation?.();
      if (!disabled) onClick(e);
    });
    return el;
  }

  const WAYS = [
    { id: "templates", title: "模板应用", icon: "grid-view" },
    { id: "empty", title: "空白应用", icon: "plus" },
    { id: "open", title: "打开现有项目", icon: "folder" },
    { id: "github", title: "从 GitHub 导入", icon: "download-cloud" },
    { id: "package", title: "安装应用包", icon: "box-open" },
  ];
  /** What each way offers, the first line under the tabs. */
  const LEADS = {
    templates: "用一个现成的示例应用改成你自己的：它的代码、设置、图标和图片都会复制进新项目。",
    empty: "官方模板加上你自己的名称、图标和目录文案，之后都可以再改。",
    open: "本机已有的应用项目：选择它的文件夹或其中任意文件，模拟器会自动找到项目。",
    github: "github.com 上的仓库（你的或任意公开仓库）：下载到本机新文件夹并作为项目打开。",
    package: "别人构建好的应用包（.tgz）：直接安装到模拟器并运行，不创建项目文件夹。",
  };
  /** The macOS dialog takes a folder or a file; elsewhere a dialog is one or the other, so there are two buttons. */
  const oneDialog = () => /mac|darwin/i.test(String(state?.context?.platform ?? globalThis.navigator?.platform ?? "mac"));
  /** A size in bytes as the person reads it: KB or MB. */
  const sizeText = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`);
  const TEMPLATE = { name: null, title: "官方模板", summary: "模板自带的起步应用：屏幕上滚一行字，配一个设置页可以改内容。" };

  let state = null; // { context, way, examples, chosen, forms: { templates, empty }, place, busy, said, lines }
  let opened = 0; // which opening the answers of the place belong to
  const root = make("div", "create-app-scrim");
  root.hidden = true;
  const dialog = make("div", "create-app");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "create-app-title");
  root.append(dialog);
  let mounted = false;
  let returnFocus = null;

  /**
   * Opens the pop-up. `context`: { examples, taken: the ids in use, create(request) → the project, or null }: the
   * window's own Create (window.js), which lists and chooses the new app.
   */
  function open(context = {}) {
    if (!mounted) {
      document.body.append(root);
      mounted = true;
      root.addEventListener("click", (e) => e.target === root && close());
      document.addEventListener("keydown", onKey, true);
      actions()?.on?.("job", onJob);
    }
    returnFocus = document.activeElement ?? null;
    const examples = (context.examples ?? []).filter((one) => typeof one?.name === "string");
    state = {
      context,
      way: context.way ?? "templates",
      examples,
      chosen: null,
      forms: { templates: { name: "", nameTouched: false, author: "", id: "", idEdited: false, advanced: false }, empty: { name: DEFAULT_NAME, nameTouched: false, author: "", id: "", idEdited: false, advanced: false, short_description: "", category: "", icons: globalThis.emulatorIconBlock?.emptyModel() ?? null } },
      found: null, // Open existing: what the desktop app found from the person's choice
      github: { repo: "", look: null, looking: false, account: null, signing: null }, // Import from GitHub
      installed: null, // Install a package: what the last try said ({ ok, name, version, message } or why not)
      finding: false,
      parent: null,
      place: null,
      busy: null,
      said: null,
      lines: [],
    };
    opened += 1;
    root.hidden = false;
    document.body.classList.add("creating-app");
    render();
    focusFirst();
    loadRules().then(() => state && render());
    if (state.way === "github") void loadAccount();
    findPlace();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove("creating-app");
    state = null;
    try {
      returnFocus?.focus?.();
    } catch {
      // The button that opened it is gone.
    }
    globalThis.dispatchEvent?.(new Event("create-app-closed"));
  }

  const form = () => state.forms[state.way === "templates" ? "templates" : "empty"];
  /** The place the desktop app gave for the name as it is now; null while it is asked for a name just typed. */
  const placeNow = () => (state.place && state.place.asked === (state.way === "github" ? importFolder() : folderFor(form().name)) ? state.place : null);
  /** Import from GitHub's folder: the repository's name. */
  const importFolder = () => folderFor(state.github.look?.ok !== false && state.github.look?.name ? state.github.look.name : (/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(state.github.repo.trim())?.[1] ?? "app"));
  const taken = () => (Array.isArray(state.context.taken) ? state.context.taken : []);

  /** Where the folder would go, asked of the desktop app for the name now (reads only; no click needed). */
  let placeTimer = null;
  function findPlace({ soon = false } = {}) {
    clearTimeout(placeTimer);
    const ask = async () => {
      if (!state || state.way === "open") return;
      const mine = opened;
      const folder = state.way === "github" ? importFolder() : folderFor(form().name);
      try {
        const place = await actions().projects.place({ parent: state.parent, folder });
        if (!state || mine !== opened) return;
        state.place = { ...place, asked: folder };
      } catch (e) {
        if (!state || mine !== opened) return;
        state.place = { problem: String(e?.message ?? e), namespace: state.place?.namespace ?? null, author: state.place?.author, asked: folder };
      }
      render();
    };
    if (soon) placeTimer = setTimeout(ask, 150);
    else ask();
  }

  async function changeParent() {
    try {
      const chosen = await actions().projects.choosePlace({ from: state.place?.parent ?? null });
      if (!state || !chosen) return;
      state.parent = chosen.parent;
      state.said = null;
      findPlace();
    } catch (e) {
      if (!state) return;
      state.said = e?.code === NO_GESTURE ? { text: "请再点一次" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
      render();
    }
  }

  /** The words of the Refresh that ends Create app (build, install, start), for the pop-up's line. */
  const ROUND = { Building: "正在构建…", Installed: "正在安装到模拟器…", Started: "正在启动…" };

  function onJob(job) {
    // Import from GitHub's download: its lines and how many files have come.
    if (state?.busy && job?.kind === "import") {
      if (job.upload?.phase === "download" && job.upload.total) state.busy = `正在下载 ${job.upload.done}/${job.upload.total} 个文件`;
      else if (typeof job.line === "string") state.busy = job.line;
      return render();
    }
    if (state?.busy && job?.kind === "open" && job.state === "running" && !job.line) {
      state.busy = state.found?.trusted ? "正在打开应用" : "等待信任确认弹窗";
      return render();
    }
    if (!state?.busy || (job?.kind !== "create" && job?.kind !== "refresh") || typeof job.line !== "string") return;
    state.lines.push(job.line);
    if (state.lines.length > 4) state.lines.shift();
    const first = job.line.split("\n")[0];
    state.busy = job.kind === "refresh" ? (ROUND[first] ?? state.busy) : first.replace(/…$/, "");
    render();
  }

  async function create() {
    const way = state.way;
    const f = form();
    const check = problemsOf(f, { taken: taken(), place: placeNow(), way });
    if (!check.ok || state.busy) return;
    const request = requestOf(way, f, { taken: taken(), place: state.place, example: state.chosen?.name ?? null });
    state.busy = "正在创建应用";
    state.said = null;
    state.lines = [];
    render();
    let made = null;
    try {
      made = await (state.context.create ?? ((asked) => actions().projects.create(asked)))(request);
    } catch (e) {
      if (!state) return;
      state.busy = null;
      state.said = e?.code === NO_GESTURE ? { text: "请再点一次创建" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
      render();
      return;
    }
    if (!state) return;
    finished(made);
  }

  /** The app made or opened: when it runs, the pop-up says so for a moment, then goes. A Refresh that failed is said in the window. */
  function finished(made) {
    state.busy = null;
    if (made?.refreshed?.ok && typeof made.refreshed.message === "string") {
      state.said = { text: made.refreshed.message };
      render();
      const mine = opened;
      setTimeout(() => mine === opened && close(), 1200);
      return;
    }
    if (made) close();
    else render();
  }

  /** Open existing's Choose: the system's dialog (`pick`: any, folder, file), then what was found around the choice. */
  async function chooseExisting(pick) {
    if (!state || state.finding || state.busy) return;
    state.finding = true;
    state.said = null;
    render();
    try {
      const answer = await actions().projects.find({ pick });
      if (!state) return;
      if (answer) state.found = answer;
    } catch (e) {
      if (!state) return;
      state.said = e?.code === NO_GESTURE ? { text: "请再点一次选择" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
    } finally {
      if (state) state.finding = false;
    }
    if (state) render();
  }

  /** Open existing's Open: the project found, through the trust dialog when it is not trusted yet; then it starts. */
  async function openFound() {
    const chosen = state?.found;
    if (!chosen?.found || state.busy) return;
    state.busy = chosen.trusted ? "正在打开应用" : "等待信任确认弹窗";
    state.said = null;
    state.lines = [];
    render();
    let result = null;
    try {
      result = await (state.context.importProject ?? ((folder) => actions().projects.import(folder)))(chosen.folder);
    } catch (e) {
      if (!state) return;
      state.busy = null;
      state.said = e?.code === NO_GESTURE ? { text: "请再点一次打开" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
      render();
      return;
    }
    if (!state) return;
    if (!result) {
      state.busy = null;
      state.said = { text: "该文件夹未获得信任，未打开。" };
      return render();
    }
    finished(result);
  }

  // ---- Install a package (.tgz): someone else's app package, looked at, asked about in a dialog, then installed

  /** What an install answered, for the pop-up: done (it closes a moment later), Cancel, or why not. */
  function installAnswered(result) {
    if (!state) return;
    state.busy = null;
    if (result === null) return render(); // no file chosen
    state.installed = result;
    if (result?.ok) {
      state.said = { text: result.message };
      render();
      const mine = opened;
      setTimeout(() => mine === opened && close(), 1500);
      return;
    }
    state.said = result?.code === "declined" ? { text: "未安装任何内容。" } : { failed: true, text: [result?.message ?? "未能安装。", result?.hint].filter(Boolean).join(" ") };
    render();
  }
  const installFailed = (e, again) => (e?.code === NO_GESTURE ? { text: `请再点一次${again}` } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") });

  /** Install a package's Choose: the browser's file input, the package as data:, then stage→install on the bar. */
  function installPackage() {
    if (!state || state.busy) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tgz,.tar.gz,application/gzip,application/x-tar";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !state || state.busy) return;
      state.busy = `正在安装 ${file.name}`;
      state.said = null;
      state.installed = null;
      render();
      let result;
      try {
        const data = await new Promise((resolve, reject) => {
          const rd = new FileReader();
          rd.onload = () => resolve(rd.result);
          rd.onerror = () => reject(rd.error);
          rd.readAsDataURL(file);
        });
        result = await actions().projects.installPackage({ data, name: file.name });
      } catch (e) {
        if (!state) return;
        state.busy = null;
        state.said = installFailed(e, "选择");
        return render();
      }
      installAnswered(result);
    });
    input.click();
  }

  /** Import from GitHub of a repository that is no app project: its latest release's package, installed. */
  async function installRelease() {
    const look = state?.github.look;
    if (!look?.release || state.busy) return;
    state.busy = `正在下载 ${look.release.asset.name}`;
    state.said = null;
    render();
    let result;
    try {
      result = await actions().github.installRelease({ repo: `${look.owner}/${look.name}` });
    } catch (e) {
      if (!state) return;
      state.busy = null;
      state.said = installFailed(e, "安装");
      return render();
    }
    installAnswered(result);
  }

  // ---- Import from GitHub (catalog-update)

  /** The GitHub account the desktop app reads repositories as, asked when the tab opens. */
  async function loadAccount() {
    try {
      const gh = await actions().github.status();
      if (!state) return;
      state.github.account = gh;
    } catch (e) {
      if (!state) return;
      state.github.account = { configured: false, failed: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
    }
    render();
    if (state.github.account?.signedIn && state.github.repo.trim() && !state.github.look) void lookUp();
  }

  /** Use <login>, or Sign in to GitHub (a code to enter on github.com): the desktop app's GitHub sign-in, as Publish's. */
  async function useAccount(login) {
    try {
      const answer = await actions().github.useExisting(login);
      if (state && answer?.ok === false) state.said = { failed: true, text: [answer.message, answer.hint].filter(Boolean).join(" ") };
    } catch (e) {
      if (state) state.said = e?.code === NO_GESTURE ? { text: "请再点一次" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
    }
    await loadAccount();
  }
  async function signIn() {
    try {
      const answer = await actions().github.signIn();
      if (!state) return;
      if (answer?.ok === false) {
        state.said = { failed: true, text: [answer.message, answer.hint].filter(Boolean).join(" ") };
        return render();
      }
      if (!answer?.signedIn) {
        state.github.signing = answer;
        render();
        const done = await actions().github.waitSignIn().catch((e) => ({ ok: false, message: e?.message ?? String(e) }));
        if (!state) return;
        state.github.signing = null;
        if (done?.ok === false) state.said = { failed: true, text: [done.message, done.hint].filter(Boolean).join(" ") };
      }
    } catch (e) {
      if (state) state.said = e?.code === NO_GESTURE ? { text: "请再点一次" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
    }
    await loadAccount();
  }

  /** As whom the repository is read: the account, the accounts to choose from, or the code of a sign-in under way. */
  function accountRow() {
    const gh = state.github.account;
    const row = make("div", "create-app-place create-app-account");
    row.innerHTML = icon("user");
    const words = make("span", "path");
    row.append(words);
    if (!gh) words.textContent = "正在获取 GitHub 状态";
    else if (gh.failed || !gh.configured) words.textContent = gh.failed ?? "此功能在当前运行环境不可用：请自行克隆仓库，然后用「打开现有项目」打开。";
    else if (state.github.signing) {
      words.textContent = `在 github.com/login/device 输入 ${state.github.signing.userCode}`;
      const open = button("btn small", "打开 GitHub", () => actions().github.openCodePage().catch(() => {}));
      open.dataset.focus = "open-code";
      row.append(open, button("btn small", "取消", () => actions().github.cancelSignIn().catch(() => {})));
    } else if (gh.signedIn) words.textContent = `以 ${gh.login}（你在模拟器里的 GitHub 账号）读取`;
    else {
      words.textContent = "导入会以你的 GitHub 账号读取该仓库";
      for (const one of (gh.accounts ?? []).slice(0, 3)) {
        const use = button("btn small", `使用 ${one.login}`, () => useAccount(one.login), { title: "本机的 GitHub 账号" });
        use.dataset.focus = `use-${one.login}`;
        row.append(use);
      }
      const sign = button("btn small", (gh.accounts ?? []).length ? "其他账号" : "登录 GitHub", signIn);
      sign.dataset.focus = "sign-in";
      row.append(sign);
    }
    return row;
  }

  let lookTimer = null;
  /** What the repository is, asked of the desktop app as the name is typed (reads only). */
  async function lookUp() {
    const g = state?.github;
    if (!g || !g.repo.trim() || !g.account?.signedIn) return;
    const asked = g.repo;
    g.looking = true;
    render();
    let look;
    try {
      look = await actions().github.lookup(asked.trim());
    } catch (e) {
      look = { ok: false, message: e?.message ?? String(e), hint: e?.hint ?? null };
    }
    if (!state || state.github.repo !== asked) return;
    state.github.looking = false;
    state.github.look = look;
    render();
    findPlace();
  }

  /** Why Import is off now, or null. */
  function importBlocked() {
    const g = state.github;
    if (state.busy) return "正在导入";
    if (!g.account?.signedIn) return "先登录 GitHub";
    if (!g.repo.trim()) return "填写仓库名";
    if (g.looking || !g.look) return "正在查看仓库";
    if (g.look.ok === false) return g.look.message;
    if (!g.look.app) return g.look.release ? null : "该仓库里没有可安装的应用";
    if (!placeNow()?.folder) return "正在确定位置";
    return null;
  }

  /** Import: downloaded into the place, then opened (the trust dialog), then started; or why not. */
  async function importRepo() {
    if (importBlocked()) return;
    if (!state.github.look.app && state.github.look.release) return installRelease();
    const place = placeNow();
    state.busy = `正在读取 github.com/${state.github.look.owner}/${state.github.look.name}`;
    state.said = null;
    render();
    let result = null;
    try {
      result = await actions().github.importRepo({ repo: `${state.github.look.owner}/${state.github.look.name}`, place: { parent: place.parent, folder: place.folder } });
    } catch (e) {
      if (!state) return;
      state.busy = null;
      state.said = e?.code === NO_GESTURE ? { text: "请再点一次导入" } : { failed: true, text: [e?.message ?? String(e), e?.hint].filter(Boolean).join(" ") };
      return render();
    }
    if (!state) return;
    if (result?.ok === false) {
      state.busy = null;
      state.said = { failed: true, text: [result.message, result.hint].filter(Boolean).join(" ") };
      findPlace();
      return render();
    }
    if (!result) {
      state.busy = null;
      state.said = { text: "已下载，但该文件夹未获得信任，未打开。" };
      return render();
    }
    finished(result);
  }

  /** Location: where the new folder goes, with Change. */
  function locationRow(about) {
    const where = make("div", "create-app-place");
    where.innerHTML = icon("folder");
    const path = make("span", "path", state.place?.shownPath ?? (state.place?.problem ? "" : "正在确定位置"));
    path.title = state.place?.path ?? "";
    const change = button("btn small", "更改", changeParent, { title: "选择项目文件夹的上级目录" });
    change.dataset.focus = "change";
    where.append(path, change);
    const row = make("div", `create-app-field${state.place?.problem ? " bad" : ""}`);
    const top = make("span", "label");
    top.append(make("b", "", "位置"));
    row.append(top, where, make("span", state.place?.problem ? "problem" : "about", state.place?.problem ?? about));
    return row;
  }

  // ---- the keyboard: Escape closes, Tab stays inside, the arrows move between the tabs

  function onKey(e) {
    if (root.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault?.();
      e.stopPropagation?.();
      close();
      return;
    }
    if (e.key === "Tab") {
      const all = focusables();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement);
      const next = e.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : at === all.length - 1 || at < 0 ? 0 : at + 1;
      e.preventDefault?.();
      all[next].focus?.();
    }
  }
  const focusables = () => [...(dialog.querySelectorAll?.("button, input, select, textarea, [tabindex='0']") ?? [])].filter((el) => !el.hidden && !el.disabled && el.offsetParent !== null);
  function focusFirst() {
    const tab = dialog.querySelector?.(".create-app-way.on");
    tab?.focus?.();
  }

  // ---------------------------------------------------------------- drawing

  function render() {
    if (!state) return;
    // The pop-up is drawn anew on every change; the field the person is typing in keeps the focus and the caret.
    const active = document.activeElement;
    const focusKey = active && dialog.contains?.(active) ? active.dataset?.focus : null;
    let caret = null;
    try {
      if (focusKey && typeof active.selectionStart === "number") caret = [active.selectionStart, active.selectionEnd];
    } catch {
      // A control without a caret.
    }
    const head = make("header", "create-app-head");
    const doc = make("a", "top-btn create-app-doc");
    doc.href = "/sgp/emulator/docs.html";
    doc.target = "_blank";
    doc.rel = "noopener";
    doc.title = "如何写出一个能在设备上运行的应用：开发规范、API 与发布流程";
    doc.innerHTML = icon("file-document");
    doc.append(make("span", "", "应用开发文档"));
    const title = make("h2", "", "创建应用");
    title.id = "create-app-title";
    const shut = button("icon-btn create-app-close", "", close, { picture: "cross", title: "关闭（Esc）" });
    shut.ariaLabel = "关闭";
    head.append(doc, title, shut);

    // The ways, one row of tabs in the middle; what the chosen one offers below them.
    const rail = make("div", "create-app-rail");
    rail.setAttribute("role", "tablist");
    rail.setAttribute("aria-orientation", "horizontal");
    rail.setAttribute("aria-label", "创建方式");
    WAYS.forEach((way, i) => {
      const tab = make("button", `create-app-way${way.id === state.way ? " on" : ""}`);
      tab.type = "button";
      tab.id = `create-app-way-${way.id}`;
      tab.dataset.way = way.id;
      tab.dataset.focus = `way-${way.id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", way.id === state.way ? "true" : "false");
      tab.setAttribute("aria-controls", "create-app-pane");
      tab.tabIndex = way.id === state.way ? 0 : -1;
      tab.innerHTML = icon(way.icon);
      tab.append(make("span", "", way.title));
      tab.addEventListener("click", () => go(way.id));
      tab.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault?.();
        go(WAYS[(i + step + WAYS.length) % WAYS.length].id, { focus: true });
      });
      rail.append(tab);
    });

    const pane = make("section", `create-app-pane way-${state.way}`);
    pane.id = "create-app-pane";
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", `create-app-way-${state.way}`);
    pane.append(make("p", "create-app-lead", LEADS[state.way]), ...PANES[state.way]());

    const foot = make("footer", "create-app-foot");
    const makes = state.way === "templates" || state.way === "empty";
    const check = makes ? problemsOf(form(), { taken: taken(), place: placeNow(), way: state.way }) : null;
    const firstProblem = check && !check.ok ? Object.entries(check).find(([key, value]) => key !== "ok" && value)?.[1] : null;
    const waiting = state.way === "templates" && !state.chosen ? "先选一个模板" : null;
    const line = make("span", `create-app-said${state.busy ? " working" : state.said?.failed ? " failed" : ""}`, state.busy ?? state.said?.text ?? "");
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    const cancel = button("btn", "取消", close);
    let go_;
    if (state.way === "open") {
      const why = state.busy ? "正在打开应用" : !state.found?.found ? "先选择应用所在文件夹" : null;
      go_ = button("btn solid", "打开", openFound, { picture: "folder", disabled: why });
      go_.dataset.part = "open";
    } else if (state.way === "github") {
      const release = !state.github.look?.app && state.github.look?.release;
      go_ = release ? button("btn solid", "安装", importRepo, { picture: "box-open", disabled: importBlocked() }) : button("btn solid", "导入", importRepo, { picture: "download-cloud", disabled: importBlocked() });
      go_.dataset.part = release ? "install-release" : "import";
    } else if (state.way === "package") {
      go_ = button("btn solid", "选择并安装…", installPackage, { picture: "box-open", disabled: state.busy ? "正在安装" : null, title: "选择应用包，查看内容后安装" });
      go_.dataset.part = "install-package";
    } else {
      const why = state.busy ? "正在创建应用" : (waiting ?? firstProblem);
      go_ = button("btn solid", "创建", create, { picture: "plus", disabled: why ?? null });
      go_.dataset.part = "create";
    }
    go_.dataset.focus = "go";
    foot.append(line, cancel, go_);

    dialog.replaceChildren(head, rail, pane, foot);
    if (!focusKey) return;
    const again = [...(dialog.querySelectorAll?.("[data-focus]") ?? [])].find((el) => el.dataset.focus === focusKey);
    again?.focus?.();
    if (caret) again?.setSelectionRange?.(caret[0], caret[1]);
  }

  function go(way, { focus = false } = {}) {
    if (!state || state.way === way) return;
    state.way = way;
    state.said = null;
    if (way === "github") void loadAccount();
    render();
    if (focus) [...(dialog.querySelectorAll?.(".create-app-way") ?? [])].find((el) => el.dataset.way === way)?.focus?.();
    findPlace();
  }

  const muted = (text) => make("p", "create-app-muted", text);

  /** A field: its label, its control, and the line under it that says what is wrong or what it is for. */
  function field(label, control, { problem = null, about = "", count = null, wide = true } = {}) {
    const row = make("label", `create-app-field${problem ? " bad" : ""}${wide ? "" : " narrow"}`);
    const top = make("span", "label");
    top.append(make("b", "", label));
    if (count) top.append(make("span", "count", count));
    const under = make("span", problem ? "problem" : "about", problem ?? about);
    if (control.id) under.id = `${control.id}-note`;
    if (control.id) control.setAttribute("aria-describedby", under.id);
    control.setAttribute?.("aria-invalid", problem ? "true" : "false");
    row.append(top, control, under);
    return row;
  }

  function textInput(key, value, { placeholder = "", onInput, max = null }) {
    const input = make("input", "input");
    input.type = "text";
    input.id = `create-app-${key}`;
    input.dataset.focus = key;
    input.dataset.part = key;
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.autocomplete = "off";
    if (max) input.maxLength = max;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  /** Name, the id under it (written by hand under Advanced), and Location: what every way that creates asks. */
  function identityFields(way) {
    const f = form();
    const check = problemsOf(f, { taken: taken(), place: state.place, way });
    const id = idOf(f, { taken: taken(), namespace: namespaceFor(f, state.place) });
    const name = textInput("name", f.name, {
      placeholder: "例如：专注计时器",
      max: 64,
      onInput: (value) => {
        f.name = value;
        f.nameTouched = true;
        state.said = null;
        render();
        findPlace({ soon: true });
      },
    });
    const parts = [field("名称", name, { problem: check.name, about: `会显示在模拟器的应用菜单和目录里。限 ${NAME_LIMIT} 个字符。`, count: `${[...f.name].length} / ${NAME_LIMIT}` })];
    // An app of that name is there already: say where, and offer it. Creating another stays possible.
    const twin = sameName(state.context.existing, f.name);
    if (twin) {
      const note = make("p", "create-app-exists");
      note.append(make("span", "", `${twin.shown ?? twin.folder} 里已有一个「${twin.name}」。`));
      if (typeof state.context.openExisting === "function") {
        const openIt = button("btn small", "打开它", () => {
          const { openExisting } = state.context;
          close();
          openExisting(twin.id);
        }, { title: `在应用列表中选中 ${twin.name}` });
        openIt.dataset.focus = "open-existing";
        openIt.dataset.part = "open-existing";
        note.append(openIt, make("span", "", "，或者再建一个新的。"));
      } else note.append(make("span", "", "可以再建一个，或保留原来那个。"));
      parts.push(note);
    }

    // No author known (no GitHub login, and only a name many computers share): asked here, as the id is made from it.
    if (asksAuthor(state.place)) {
      const author = textInput("author", f.author ?? "", {
        placeholder: "your-github-login",
        max: 64,
        onInput: (value) => {
          f.author = value;
          state.said = null;
          render();
        },
      });
      parts.push(field("作者", author, { problem: (f.author ?? "").trim() ? check.author : null, about: "你的 GitHub 用户名或名字：应用 ID 由它生成，目录里也会显示为作者。" }));
    }

    const idRow = make("div", "create-app-id");
    idRow.append(make("span", "", "ID"), make("code", "", id));
    const advanced = button("btn small create-app-advanced", "高级选项", () => {
      f.advanced = !f.advanced;
      if (f.advanced && !f.idEdited) f.id = id;
      render();
    }, { picture: f.advanced ? "chevron-up" : "chevron-down" });
    advanced.setAttribute("aria-expanded", f.advanced ? "true" : "false");
    advanced.dataset.focus = "advanced";
    idRow.append(advanced);
    parts.push(idRow);
    if (!f.advanced && check.id) parts.push(make("p", "create-app-problem", check.id));
    if (f.advanced) {
      const idInput = textInput("id", f.idEdited ? f.id : id, {
        placeholder: "app.you.my_app",
        max: 64,
        onInput: (value) => {
          f.id = value;
          f.idEdited = true;
          render();
        },
      });
      const box = make("div", "create-app-advanced-box");
      const from = state.place?.author?.from === "github" ? `，作者是你的 GitHub 用户名 ${state.place.author.name}` : "，由作者和名称生成";
      box.append(field("应用 ID", idInput, { problem: check.id, about: `app.<作者>.<名称>${from}。在设备和目录里唯一：小写英文字母、数字、_、-，至少两个点。发布后不能再改。` }));
      if (f.idEdited) box.append(button("btn small", "根据名称重新生成", () => ((f.idEdited = false), render())));
      parts.push(box);
    }

    const where = make("div", "create-app-place");
    where.innerHTML = icon("folder");
    const path = make("span", "path", state.place?.shownPath ?? (state.place?.problem ? "" : "正在确定位置"));
    path.title = state.place?.path ?? "";
    const change = button("btn small", "更改", changeParent, { title: "选择项目文件夹的上级目录" });
    change.dataset.focus = "change";
    where.append(path, change);
    const placeRow = make("div", `create-app-field${check.place && state.place?.problem ? " bad" : ""}`);
    const top = make("span", "label");
    top.append(make("b", "", "位置"));
    placeRow.append(top, where, make("span", state.place?.problem ? "problem" : "about", state.place?.problem ?? "项目文件夹会建在这里，应用所需的一切都放进去。"));
    parts.push(placeRow);
    return parts;
  }

  /**
   * A path on one line that keeps its end in view: the folders before the last name are cut with an ellipsis when it
   * is too long, the last name never. `textContent` is the whole path.
   */
  function pathText(full, className) {
    const text = String(full ?? "");
    const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1;
    const box = make("span", `${className} create-app-path`);
    const head = make("span", "head", text.slice(0, cut));
    const tail = make("span", "tail", text.slice(cut));
    box.append(head, tail);
    box.textContent = text;
    box.replaceChildren(head, tail);
    return box;
  }

  const PANES = {
    templates() {
      const parts = [];
      const cards = make("div", "create-app-cards");
      cards.setAttribute("role", "radiogroup");
      cards.setAttribute("aria-label", "Templates");
      for (const one of [TEMPLATE, ...state.examples]) {
        const card = make("button", `create-app-card${(state.chosen?.name ?? undefined) === one.name ? " on" : ""}`);
        card.type = "button";
        card.setAttribute("role", "radio");
        card.setAttribute("aria-checked", (state.chosen?.name ?? undefined) === one.name ? "true" : "false");
        card.dataset.focus = `card-${one.name ?? "template"}`;
        card.dataset.part = "card";
        const screen = make("span", "screen");
        if (one.front) {
          const picture = make("img");
          picture.src = one.front;
          picture.alt = "";
          screen.append(picture);
        } else screen.append(make("span", "hello", one.name === null ? "Hello" : ""));
        const top = make("span", "card-top");
        if (one.icon) {
          const picture = make("img", "card-icon");
          picture.src = one.icon;
          picture.alt = "";
          top.append(picture);
        } else {
          const mark = make("span", "card-icon none");
          mark.innerHTML = icon("busy-bar");
          top.append(mark);
        }
        top.append(make("b", "", one.title ?? one.name ?? ""));
        card.append(screen, top, make("span", "line", one.summary ?? ""));
        card.addEventListener("click", () => {
          state.chosen = one;
          const f = state.forms.templates;
          if (!f.nameTouched) f.name = one.name === null ? DEFAULT_NAME : (one.title ?? one.name);
          if (!f.idEdited) f.id = "";
          state.said = null;
          render();
          findPlace();
        });
        cards.append(card);
      }
      parts.push(cards);
      if (state.chosen) {
        const box = make("div", "create-app-form");
        box.append(make("h3", "", `基于「${state.chosen.title ?? state.chosen.name ?? "模板"}」创建`), ...identityFields("templates"));
        parts.push(box);
      }
      return parts;
    },

    github() {
      const g = state.github;
      const parts = [accountRow()];
      const repo = textInput("repo", g.repo, {
        placeholder: "https://github.com/owner/app or owner/app",
        max: 300,
        onInput: (value) => {
          g.repo = value;
          g.look = null;
          state.said = null;
          clearTimeout(lookTimer);
          lookTimer = setTimeout(() => void lookUp(), 500);
          render();
        },
      });
      repo.type = "url";
      const look = g.look;
      const release = look && look.ok !== false && !look.app ? look.release : null;
      const problem = look?.ok === false ? [look.message, look.hint].filter(Boolean).join(" ") : look && !look.app && !release ? (look.nothing ?? `${look.owner}/${look.name} 里没有可安装的应用：缺少 src/appmeta/manifest.json。`) : null;
      const about = g.looking ? "正在查看仓库" : look?.app ? `${look.app.name ?? look.name}${look.app.version ? ` ${look.app.version}` : ""}，${look.private ? "私有" : "公开"}，来自 ${look.branch} 分支。` : release ? `它不是应用项目，但最新发行版里有应用包。` : "会下载默认分支的最后一次提交，不需要 git。";
      parts.push(field("仓库", repo, { problem: g.repo.trim() ? problem : null, about }));
      if (release) {
        const card = make("div", "create-app-result found");
        card.dataset.part = "release";
        const mark = make("span", "mark");
        mark.innerHTML = icon("box-open");
        const words = make("div", "words");
        words.append(make("span", "kicker", "发行包"), make("b", "", `安装发行包 ${release.asset.name}${release.version ? `（v${release.version.replace(/^v/, "")}）` : ""}`));
        words.append(make("span", "note", `${sizeText(release.asset.size)}，来自 github.com/${look.owner}/${look.name}。模拟器会先检查它，安装前再向你确认：这是别人写的代码。`));
        card.append(mark, words);
        parts.push(card);
        return parts;
      }
      parts.push(locationRow("仓库文件会放进这里新建的同名文件夹。"));
      return parts;
    },

    package() {
      const parts = [];
      const steps = make("div", "create-app-result none");
      steps.innerHTML = icon("box-open");
      steps.append(make("p", "", "选择本机上的 .tgz 应用包。模拟器会像真机一样读取它的清单并校验，然后告诉你应用的名称、ID、版本，安装后直接启动。"));
      parts.push(steps);
      const last = state.installed;
      if (last?.ok) {
        const card = make("div", "create-app-result found");
        const mark = make("span", "mark");
        mark.innerHTML = icon("checkmark-circle");
        const words = make("div", "words");
        words.append(make("span", "kicker", "已从应用包安装"), make("b", "", `${last.name ?? last.id} ${last.version ?? ""}`.trim()));
        if (last.id) words.append(make("code", "", last.id));
        card.append(mark, words);
        parts.push(card);
      }
      parts.push(muted("从应用包安装的应用在本机没有项目文件夹：它在应用列表里标记为「从应用包安装」。要改代码，请打开对应的项目。"));
      return parts;
    },

    open() {
      const found = state.found;
      const where = make("div", "create-app-place create-app-chosen");
      where.innerHTML = icon("folder");
      const path = found ? pathText(found.shownChosen ?? found.chosen, "path") : make("span", "path none", "尚未选择");
      path.title = found?.chosen ?? "";
      where.append(path);
      const busyNow = state.finding || Boolean(state.busy);
      const chooser = (label, pick, title) => {
        const one = button("btn small", label, () => chooseExisting(pick), { title, disabled: busyNow ? "请稍候" : null });
        one.dataset.focus = `choose-${pick}`;
        one.dataset.part = `choose-${pick}`;
        return one;
      };
      if (oneDialog()) where.append(chooser("选择…", "any", "选择应用的文件夹，或其中任意文件"));
      else where.append(chooser("选择文件夹…", "folder", "选择应用的文件夹"), chooser("选择文件…", "file", "选择应用文件夹里的任意文件"));
      const row = make("div", "create-app-field");
      const top = make("span", "label");
      top.append(make("b", "", "文件夹或文件"));
      row.append(top, where, make("span", "about", state.finding ? "正在寻找项目" : "项目文件夹、其中的子文件夹，或其中任意文件（main.js、清单、图片等）都可以。"));
      const parts = [row];
      if (found && !found.found) {
        const none = make("div", "create-app-result none");
        none.innerHTML = icon("alert");
        none.append(make("p", "", found.message));
        parts.push(none);
      } else if (found?.found) {
        const card = make("div", "create-app-result found");
        const mark = make("span", "mark");
        mark.innerHTML = icon("checkmark-circle");
        const words = make("div", "words");
        words.append(make("span", "kicker", "找到应用项目"), make("b", "", found.name ?? found.id ?? "未命名应用"));
        if (found.id) words.append(make("code", "", found.id));
        const folder = pathText(found.shownFolder ?? found.folder, "project-folder");
        folder.title = found.folder;
        words.append(folder);
        if (found.chosen && found.chosen !== found.folder) words.append(make("span", "note", "在你所选位置的上级文件夹中找到。"));
        card.append(mark, words);
        parts.push(card);
        parts.push(muted(found.listed && found.trusted ? "它已经在你的应用列表里：「打开」会选中它并在模拟器上运行。" : found.trusted ? "「打开」会把它加进应用列表并在模拟器上运行。" : "模拟器会先问你是否信任这个文件夹，然后才构建其中的代码并在模拟器上运行。"));
      }
      return parts;
    },

    empty() {
      const f = state.forms.empty;
      const check = problemsOf(f, { taken: taken(), place: state.place, way: "empty" });
      const book = ruleBook();
      const left = make("div", "create-app-form");
      left.append(...identityFields("empty"));

      const short = textInput("short", f.short_description, {
        placeholder: "例：显示本次会议已花掉的时间成本",
        max: 200,
        onInput: (value) => {
          f.short_description = value;
          render();
        },
      });
      left.append(field("一句话简介", short, { problem: check.short_description, about: "目录里应用卡片上的一行介绍，10～120 个字符。也可以在发布时再写。", count: `${[...f.short_description].length} / 10～120` }));

      const category = make("select", "input");
      category.id = "create-app-category";
      category.dataset.focus = "category";
      category.dataset.part = "category";
      category.append(Object.assign(make("option", "", "稍后选择"), { value: "" }));
      for (const one of book.CATEGORIES) category.append(Object.assign(make("option", "", one.name), { value: one.id }));
      category.value = f.category;
      category.addEventListener("change", () => {
        f.category = category.value;
        render();
      });
      const about = book.CATEGORIES.find((one) => one.id === f.category)?.about;
      left.append(field("分类", category, { problem: check.category, about: about ? `${about}。` : "应用在目录里的分类。", wide: false }));

      return [left, iconPanel(f)];
    },
  };

  /** The icons: the icon block (icon-block.js), Front and Back; without an upload the app gets the default icon. */
  function iconPanel(f) {
    const panel = make("div", "create-app-icon");
    const head = make("div", "create-app-icon-head");
    head.append(make("h3", "", "图标"), make("p", "create-app-muted", "会显示在模拟器的应用菜单和目录卡片上。不上传就用默认图标，之后也可以再改。"));
    panel.append(head);
    const block = globalThis.emulatorIconBlock;
    if (!block) return panel;
    f.icons ??= block.emptyModel();
    panel.append(block.render(f.icons, { onChange: () => render(), withDefault: true, busy: state?.busy ? "请稍候" : null }));
    return panel;
  }

  /**
   * A PNG of the person's own for one side, chosen in the system's file dialog and checked by the icon block's rules
   * (the opened app's Icons in window.js use it): { data } (a PNG drawn at the icon's size), { problem } that says
   * which requirement it breaks and what to do, or null when nothing was chosen.
   */
  async function pickIcon(side) {
    const block = globalThis.emulatorIconBlock;
    if (!block) return { problem: "图标规范未能加载。" };
    const file = await block.chooseFile();
    if (!file) return null;
    const taken = await block.take(side, file);
    if (taken.draft) return { data: taken.draft };
    const failed = Object.values(taken.rejected.verdict.results).filter((one) => !one.ok);
    return { problem: `${file.name}：${failed.map((one) => [one.problem, one.next].filter(Boolean).join(" ")).join(" ")}${taken.rejected.verdict.fix ? "也可以在发布时上传，发布流程会自动转换。" : ""}` };
  }

  Object.assign(api, { open, close, isOpen: () => !root.hidden, render: () => render(), pickIcon });
})();
