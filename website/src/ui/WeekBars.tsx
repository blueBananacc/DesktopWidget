import type { StatusId, StatusSegment } from "../domain/types";
import { STATUSES } from "../domain/statuses";
import { WEEK_SHORT, duration } from "../domain/time";
import { TRACKED, lastDays, totalsForSegments, trackedSum } from "../domain/review";

export { totalsForSegments };

/** 最近 N 天（含今天）的状态时长堆叠柱；传 onSelect 时柱子可点击选中某天 */
export function WeekBars({ history, segments, now, todayKey, days = 5, selected, onSelect, height }: {
  history: Record<string, Partial<Record<StatusId, number>>>;
  segments: StatusSegment[];
  now: number;
  todayKey: string;
  days?: number;
  selected?: string;
  onSelect?: (key: string) => void;
  height?: number;
}) {
  const cols = lastDays(now, days).map(({ key, ts }) => {
    const totals = key === todayKey ? totalsForSegments(segments, now) : history[key] ?? {};
    return { key, ts, totals, sum: trackedSum(totals) };
  });
  const max = Math.max(1, ...cols.map((c) => c.sum));
  const dense = days > 14;
  const gap = dense ? 4 : 14;
  const label = (c: (typeof cols)[number], i: number) => {
    if (c.key === todayKey) return "今天";
    if (!dense) return WEEK_SHORT[new Date(c.ts).getDay()];
    const d = new Date(c.ts);
    return (days - 1 - i) % 5 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : "";
  };
  return (
    <>
      <div className={`bars${onSelect ? " bars-pick" : ""}`} style={{ gridTemplateColumns: `repeat(${days}, 1fr)`, gap, ...(height ? { height } : {}) }}>
        {cols.map((c) => {
          const h = `${c.sum ? Math.max(4, (c.sum / max) * 100) : 3}%`;
          const title = `${c.key} · ${c.sum ? duration(c.sum) : "无记录"}`;
          const stack = TRACKED.map((k) => (c.totals[k] ? <i key={k} style={{ flex: c.totals[k], background: STATUSES[k].color }} /> : null));
          return onSelect ? (
            <button type="button" key={c.key} className={`bar-col${selected === c.key ? " on" : ""}`} onClick={() => onSelect(c.key)} title={title} aria-label={title} aria-pressed={selected === c.key}>
              <span className={`bar${c.sum ? "" : " empty"}`} style={{ height: h }}>{stack}</span>
            </button>
          ) : (
            <div key={c.key} className="bar" style={{ height: h }} title={title}>{stack}</div>
          );
        })}
      </div>
      <div className="bar-x" style={{ gridTemplateColumns: `repeat(${days}, 1fr)`, gap }}>
        {cols.map((c, i) => (
          <span key={c.key} className={selected === c.key ? "on" : ""}>{label(c, i)}</span>
        ))}
      </div>
      <div className="legend">
        {TRACKED.map((k) => (
          <span key={k} style={{ ["--c" as string]: STATUSES[k].color }}>{STATUSES[k].label}</span>
        ))}
      </div>
    </>
  );
}
