import type { Schedule, ScheduleNode } from "./types";
import { atToday, dateKey, toMinutes } from "./time";

/** 同一时间多个节点时，以最后保存（数组中靠后）的为准 */
export const sortedNodes = (s: Schedule): ScheduleNode[] => {
  const byTime = new Map<string, ScheduleNode>();
  for (const n of s.nodes) byTime.set(n.time, n);
  return [...byTime.values()].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
};

export const conflicts = (s: Schedule) => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of s.nodes) (seen.has(n.time) ? dup : seen).add(n.time);
  return [...dup];
};

/** 当天生效的计划表：单日计划优先，其次为当前选中的重复计划（且当天在其重复日内） */
export const scheduleForDay = (schedules: Schedule[], activeId: string, now: number) => {
  const today = dateKey(now);
  const dated = schedules.find((s) => s.kind === "date" && s.date === today);
  if (dated) return dated;
  const active = schedules.find((s) => s.id === activeId && s.kind === "repeat");
  return active && active.weekdays.includes(new Date(now).getDay()) ? active : undefined;
};

export const currentNode = (s: Schedule | undefined, now: number) => {
  if (!s) return undefined;
  const nodes = sortedNodes(s);
  let hit: ScheduleNode | undefined;
  for (const n of nodes) if (atToday(n.time, now) <= now) hit = n;
  return hit;
};

export const nextNode = (s: Schedule | undefined, now: number) =>
  s ? sortedNodes(s).find((n) => atToday(n.time, now) > now) : undefined;
