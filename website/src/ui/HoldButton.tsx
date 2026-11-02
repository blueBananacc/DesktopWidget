import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const holdSeconds = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hold-duration"));
  return Number.isFinite(v) ? v : 1.5;
};

/** 按住确认按钮：按满 --hold-duration 触发 onComplete，提前松手取消 */
export function HoldButton({ onComplete, children, done, className = "", disabled }: { onComplete: () => void; children: ReactNode; done?: ReactNode; className?: string; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "holding" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const start = () => {
    if (state !== "idle" || disabled) return;
    setState("holding");
    timer.current = setTimeout(() => {
      setState("done");
      navigator.vibrate?.(30);
      onComplete();
      setTimeout(() => setState("idle"), 600);
    }, holdSeconds() * 1000);
  };
  const cancel = () => {
    if (state !== "holding") return;
    clearTimeout(timer.current);
    setState("idle");
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={`btn hold ${state === "holding" ? "is-holding" : ""} ${state === "done" ? "is-done" : ""} ${className}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && cancel()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="fill" />
      {state === "done" && done ? done : children}
    </button>
  );
}
