import { pad } from "./time";

export type ParsedCommand =
  | { kind: "timer"; minutes: number; text: string }
  | { kind: "reminder"; title: string; trigger: "afterOffwork" }
  | { kind: "reminder"; title: string; trigger: "time"; at: string }
  | { kind: "unknown"; text: string };

const CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnToNum = (s: string) => {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "半") return 30;
  if (s.length === 1) return CN[s] ?? NaN;
  if (s.startsWith("十")) return 10 + (CN[s[1]] ?? 0);
  if (s.endsWith("十")) return (CN[s[0]] ?? 0) * 10;
  if (s.length === 3 && s[1] === "十") return (CN[s[0]] ?? 0) * 10 + (CN[s[2]] ?? 0);
  return NaN;
};

/**
 * 本地示例解析：仅用于在云端 AI 接入前演示“解析 → 用户确认 → 创建”的流程。
 * 正式版本由手机/网页把语音或文本发到云端解析（PRD 3.14）。
 */
export function parseCommand(input: string): ParsedCommand {
  const text = input.trim().replace(/[。.!！]$/, "");
  const timer = text.match(/([\d一二两三四五六七八九十半]+)\s*(分钟|小时)/);
  if (timer && /专注|倒计时|计时|定时/.test(text)) {
    const n = cnToNum(timer[1]);
    if (Number.isFinite(n)) return { kind: "timer", minutes: timer[2] === "小时" ? n * 60 : n, text };
  }
  const strip = (s: string) =>
    s.replace(/^(请)?(提醒我|帮我|记得)/, "").replace(/^(今天)?(下班后|收工后|下班以后)/, "").replace(/^(今天)?(上午|下午|晚上)?\s*[\d一二两三四五六七八九十]+\s*[点:：时]\s*(半|\d{1,2}分?)?/, "").replace(/^[，, ]+/, "").trim();
  if (/下班后|收工后|下班以后/.test(text)) return { kind: "reminder", title: strip(text.replace(/^(请)?(提醒我|帮我|记得)/, "")) || text, trigger: "afterOffwork" };
  const t = text.match(/(上午|下午|晚上)?\s*([\d一二两三四五六七八九十]+)\s*[点:：时]\s*(半|(\d{1,2})分?)?/);
  if (t) {
    let h = cnToNum(t[2]);
    const m = t[3] === "半" ? 30 : t[4] ? Number(t[4]) : 0;
    if ((t[1] === "下午" || t[1] === "晚上") && h < 12) h += 12;
    if (Number.isFinite(h) && h < 24 && m < 60) {
      const body = strip(text.replace(/^(请)?(提醒我|帮我|记得)/, "").replace(/^今天/, ""));
      return { kind: "reminder", title: body || text, trigger: "time", at: `${pad(h)}:${pad(m)}` };
    }
  }
  return { kind: "unknown", text };
}
