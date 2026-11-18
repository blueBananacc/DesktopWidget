// window.busyShell in a plain browser: the same three members the Electron preload gives the window
// (window-preload.cjs), backed by the dev server's /emu-shell middleware instead of IPC. It is only
// injected into this page where that middleware exists (vite.config), so a static copy of this page
// simply has no shell, exactly as a browser with no app would.
//
// action(name, arg) → POST /emu-shell/call; the answer streams NDJSON: { job } lines go to the job
// listeners (progress the window draws while it waits), the last line is the action's answer
// ({ ok:true, value } or { ok:false, error:{ code, message, hint } }).
(() => {
  const jobListeners = new Set();
  const menuListeners = new Set();
  const fire = (set, value) => {
    for (const listener of [...set]) {
      try {
        listener(value);
      } catch (e) {
        console.error(e);
      }
    }
  };

  async function action(name, arg) {
    let resp;
    try {
      resp = await fetch("/emu-shell/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, arg }),
      });
    } catch {
      return { ok: false, error: { code: "bridge_down", message: "模拟器工具桥没有响应（开发服务器的 /emu-shell 未启用）。", hint: null } };
    }
    if (!resp.ok || !resp.body) {
      return { ok: false, error: { code: "bridge_down", message: `模拟器工具桥返回 HTTP ${resp.status}。`, hint: null } };
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let rest = "";
    let answer = null;
    const take = (line) => {
      const text = line.trim();
      if (!text) return;
      try {
        const message = JSON.parse(text);
        if (message && message.job) fire(jobListeners, message.job);
        else answer = message;
      } catch {
        // a partial line is left for the next chunk; an unparseable one is skipped
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      let at;
      while ((at = rest.indexOf("\n")) >= 0) {
        take(rest.slice(0, at));
        rest = rest.slice(at + 1);
      }
    }
    take(rest);
    return answer ?? { ok: false, error: { code: "bridge_down", message: "模拟器工具桥没有返回结果。", hint: null } };
  }

  window.busyShell = {
    action,
    onJob: (listener) => {
      if (typeof listener === "function") jobListeners.add(listener);
    },
    onMenu: (listener) => {
      if (typeof listener === "function") menuListeners.add(listener);
    },
  };
})();
