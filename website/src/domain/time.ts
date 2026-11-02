export const pad = (n: number) => String(n).padStart(2, "0");

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const dateKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const atToday = (time: string, now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + toMinutes(time) * 60_000;
};

export const startOfDay = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const clock = (ms: number, withHours = true) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return withHours || h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

export const duration = (ms: number) => {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
};

export const ago = (ts: number, now: number) => {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  return `${hhmm(ts)}`;
};

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const weekday = (ts: number) => WEEK[new Date(ts).getDay()];
export const WEEK_SHORT = ["日", "一", "二", "三", "四", "五", "六"];

export const greeting = (ts: number) => {
  const h = new Date(ts).getHours();
  if (h < 6) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
};

export const uid = () => Math.random().toString(36).slice(2, 10);
