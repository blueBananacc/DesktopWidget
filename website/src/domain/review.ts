import type { StatusId, StatusSegment } from "./types";
import { dateKey, startOfDay } from "./time";

export type Totals = Partial<Record<StatusId, number>>;

export const DAY_MS = 86_400_000;

/** 计入"有状态"时长的状态（下班不计） */
export const TRACKED: StatusId[] = ["work", "focus", "busy", "meet", "rest"];

export const totalsForSegments = (segments: StatusSegment[], now: number): Totals => {
  const t: Totals = {};
  for (const s of segments) t[s.status] = (t[s.status] ?? 0) + Math.max(0, (s.end ?? now) - s.start);
  return t;
};

export const trackedSum = (t: Totals) => TRACKED.reduce((a, k) => a + (t[k] ?? 0), 0);

/** 相邻区间之间的空档 = 未记录（不推断） */
export const unrecordedMs = (segments: StatusSegment[]) =>
  segments.reduce((a, seg, i) => (i && segments[i - 1].end ? a + Math.max(0, seg.start - segments[i - 1].end!) : a), 0);

/** 当天首个非下班区间的开始；以下班结尾时最后一段的开始即收工时间（中途下班又回来不算） */
export const dayBounds = (segments: StatusSegment[]) => {
  const last = segments.at(-1);
  return {
    first: segments.find((s) => s.status !== "off")?.start,
    offAt: segments.length > 1 && last?.status === "off" ? last.start : undefined,
  };
};

/** 往前 n 天（含今天）的日期 key，从旧到新 */
export const lastDays = (now: number, n: number) => {
  const d0 = startOfDay(now);
  return Array.from({ length: n }, (_, i) => {
    const ts = d0 - (n - 1 - i) * DAY_MS + 12 * 3600_000;
    return { key: dateKey(ts), ts };
  });
};

export const keyToTs = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};
