import { useState } from "react";
import { X } from "lucide-react";

export function MinuteChips({ values, selected, onSelect, onChange, disabled }: { values: number[]; selected: number; onSelect: (m: number) => void; onChange: (v: number[]) => void; disabled?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const m = Math.round(Number(draft));
    if (m >= 1 && m <= 240 && !values.includes(m)) onChange([...values, m].sort((a, b) => a - b));
    setDraft("");
    setAdding(false);
  };
  return (
    <div className="mchips">
      {values.map((m) => (
        <span key={m} className={`mchip${m === selected ? " on" : ""}`}>
          <button className="mchip-main" disabled={disabled} onClick={() => onSelect(m)}>{m} 分钟</button>
          {m !== selected && <button className="mchip-x" aria-label={`删除 ${m} 分钟`} onClick={() => onChange(values.filter((x) => x !== m))}><X /></button>}
        </span>
      ))}
      {adding ? (
        <input
          className="mchip-input"
          autoFocus
          type="number"
          min={1}
          max={240}
          placeholder="分钟"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(""); setAdding(false); }
          }}
        />
      ) : (
        <button className="mchip mchip-add" onClick={() => setAdding(true)}>自定义</button>
      )}
    </div>
  );
}
