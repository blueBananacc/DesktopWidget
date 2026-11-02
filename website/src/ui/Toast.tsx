import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  seconds: number;
  countdown?: boolean;
}

type Show = (t: Omit<ToastItem, "id" | "seconds"> & { seconds?: number }) => void;

const Ctx = createContext<Show>(() => {});

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [left, setLeft] = useState(item.seconds);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) closeRef.current();
  }, [left]);
  return (
    <div className="toast">
      <span>{item.message}</span>
      {item.action && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            item.action!.onClick();
            onClose();
          }}
        >
          {item.action.label}
          {item.countdown && ` (${left}s)`}
        </a>
      )}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback<Show>((t) => {
    setItems((xs) => [...xs, { ...t, id: Date.now() + Math.random(), seconds: t.seconds ?? 4 }]);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toast-host" role="status">
        {items.map((it) => (
          <Toast key={it.id} item={it} onClose={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
