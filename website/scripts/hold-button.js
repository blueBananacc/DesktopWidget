// 收工牌：按住确认按钮 + 撤销提示（不依赖任何框架）
// 用法：<button class="btn hold" data-hold>…</button>
//       el.addEventListener("hold:complete", () => {...})

const readSeconds = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith("ms") ? n / 1000 : n) : fallback;
};

export function initHoldButton(el) {
  let timer = null;

  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    el.classList.remove("is-holding");
  };

  const start = () => {
    if (timer || el.classList.contains("is-done") || el.disabled) return;
    el.classList.add("is-holding");
    timer = setTimeout(() => {
      timer = null;
      el.classList.remove("is-holding");
      el.classList.add("is-done");
      navigator.vibrate?.(30);
      el.dispatchEvent(new CustomEvent("hold:complete", { bubbles: true }));
    }, readSeconds("--hold-duration", 1.5) * 1000);
  };

  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture?.(e.pointerId);
    start();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => el.addEventListener(t, cancel));
  el.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  el.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") cancel();
  });
  el.addEventListener("click", (e) => e.preventDefault());
  el.addEventListener("contextmenu", (e) => e.preventDefault());

  return { reset: () => el.classList.remove("is-done", "is-holding") };
}

export function showUndoToast({ message, onUndo, seconds = readSeconds("--undo-window", 10) }) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("role", "status");
    document.body.append(host);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  const text = document.createElement("span");
  text.textContent = message;
  const undo = document.createElement("a");
  undo.href = "#";
  toast.append(text, undo);
  host.append(toast);

  let left = Math.round(seconds);
  const render = () => (undo.textContent = `撤销 (${left}s)`);
  render();
  const tick = setInterval(() => (--left <= 0 ? close() : render()), 1000);
  function close() {
    clearInterval(tick);
    toast.remove();
  }
  undo.addEventListener("click", (e) => {
    e.preventDefault();
    close();
    onUndo?.();
  });
  return close;
}

export function initAllHoldButtons(root = document) {
  return [...root.querySelectorAll("[data-hold]")].map((el) => ({ el, ...initHoldButton(el) }));
}
