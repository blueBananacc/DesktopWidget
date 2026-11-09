import { useEffect, useRef, useState } from "react";
import { BellOff, ChevronLeft, ChevronRight, Mic, MicOff, Pause, PhoneOff, RotateCcw, Play, Sunset, Video, Wifi } from "lucide-react";
import type { ReactNode } from "react";

// ===== 商品图：顶部俯视（纯 CSS，尺寸全部按容器宽度 cqw 缩放，主图与缩略图共用） =====
const TOP_KEYS: [ReactNode, string][] = [[<Sunset />, "收工"], [<BellOff />, "勿扰"], [<ChevronLeft />, "上一个"], [<ChevronRight />, "下一个"]];
export function TopView() {
  return (
    <div className="pd-top" role="img" aria-label="顶部俯视：4 枚按键与最右侧旋钮">
      <div className="pd-top-shadow" />
      <div className="pd-top-spill" />
      <div className="pd-top-body">
        <div className="pd-top-keys">
          {TOP_KEYS.map(([icon, label]) => (
            <div key={label} className="pd-top-key">
              <span className="pd-top-label">{label}</span>
              <i>{icon}</i>
            </div>
          ))}
        </div>
        <span className="pd-top-mark">收工牌</span>
        <div className="pd-top-knob">
          <span className="pd-top-label">旋钮 · 定时</span>
          <i><b /></i>
        </div>
        <div className="pd-top-lip" />
      </div>
    </div>
  );
}

// ===== 72×16 全彩 LED 点阵屏：在 72×16 离屏画布上画内容，再逐像素放大成圆点（进视口才刷新） =====
export const MW = 72, MH = 16;
export type DrawFn = (g: CanvasRenderingContext2D, t: number) => void;
const DOT = 10;
const FPS = 24;

export function LedMatrix({ draw, className = "" }: { draw: DrawFn; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const off = document.createElement("canvas");
    off.width = MW; off.height = MH;
    const g = off.getContext("2d", { willReadFrequently: true });
    if (!ctx || !g) return;
    cv.width = MW * DOT; cv.height = MH * DOT;
    const t0 = performance.now();
    let raf = 0, last = 0, visible = false;
    const render = (now: number) => {
      g.fillStyle = "#000"; g.fillRect(0, 0, MW, MH);
      drawRef.current(g, (now - t0) / 1000);
      const d = g.getImageData(0, 0, MW, MH).data;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const lit: [number, number, string][] = [];
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#16181B";
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const i = (y * MW + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2], m = Math.max(r, gg, b);
        if (m >= 110) { lit.push([x, y, `rgb(${Math.round(r * 255 / m)},${Math.round(gg * 255 / m)},${Math.round(b * 255 / m)})`]); continue; }
        ctx.beginPath(); ctx.arc(x * DOT + DOT / 2, y * DOT + DOT / 2, DOT * 0.36, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = DOT * 1.1;
      for (const [x, y, c] of lit) {
        ctx.fillStyle = c; ctx.shadowColor = c;
        ctx.beginPath(); ctx.arc(x * DOT + DOT / 2, y * DOT + DOT / 2, DOT * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    };
    const loop = (now: number) => {
      if (now - last > 1000 / FPS) { last = now; render(now); }
      if (visible) raf = requestAnimationFrame(loop);
    };
    render(t0);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(loop);
    });
    io.observe(cv);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} className={`pd-led ${className}`} aria-hidden="true" />;
}

/** 与“点一点看看”同一外壳（pd-dev：顶部 4 键 + 最右旋钮 + 底部光晕），屏幕换成可编程点阵；small = 小尺寸场景（门牌等） */
export function MatrixDevice({ draw, color, small, className = "" }: { draw: DrawFn; color: string; small?: boolean; className?: string }) {
  return (
    <div className={`pd-dev is-matrix ${small ? "is-tiny" : ""} ${className}`} style={{ ["--c" as string]: color }}>
      <div className="pd-dev-keys"><i /><i /><i /><i /><b /></div>
      <div className="pd-dev-body"><div className="pd-dev-screen"><LedMatrix draw={draw} /></div></div>
      <div className="pd-dev-glow" />
    </div>
  );
}

// ===== 点阵绘制小工具 =====
const CN = "'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif";
function txt(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, size = 14, font = CN, align: CanvasTextAlign = "left") {
  g.font = `700 ${size}px ${font}`;
  g.textAlign = align; g.textBaseline = "middle";
  g.fillStyle = color; g.fillText(s, x, y);
}
// 3×5 像素字（数字 / 少量拉丁字母 / 符号），保证小字在点阵上清晰
const GLYPH: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
  ":": "000010000010000", "%": "101001010100101", "°": "010101010000000", "C": "111100100100111", "P": "111101111100100",
  "U": "101101101101111", "R": "110101110101101", "A": "010101111101101", "M": "101111111101101", "I": "111010010010111", " ": "000000000000000",
};
function pix(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale = 1, align: "left" | "right" = "left") {
  const w = s.length * 4 * scale - scale;
  let cx = align === "right" ? x - w : x;
  g.fillStyle = color;
  for (const ch of s) {
    const bits = GLYPH[ch] ?? GLYPH[" "];
    for (let i = 0; i < 15; i++) if (bits[i] === "1") g.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
    cx += 4 * scale;
  }
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function marquee(g: CanvasRenderingContext2D, s: string, t: number, color: string, speed = 18) {
  g.font = `700 14px ${CN}`;
  const w = g.measureText(s).width + 24;
  const x = MW - ((t * speed) % (w + MW));
  txt(g, s, x, 8.5, color);
}

const drawRest: DrawFn = (g, t) => {
  txt(g, "休息", 1, 8.5, "#3BE08F");
  const left = 300 - (t % 300);
  pix(g, mmss(left), 71, 1, "#FFFFFF", 2, "right");
  g.fillStyle = "#3BE08F";
  g.fillRect(34, 13, Math.max(1, Math.round(37 * left / 300)), 2);
};
const drawBlock: DrawFn = (g) => { g.fillStyle = "#E5484D"; g.fillRect(0, 0, MW, MH); txt(g, "请勿打扰", 36, 8.5, "#FFFFFF", 14, CN, "center"); };
const drawDoor: DrawFn = (g, t) => {
  g.fillStyle = "#E5484D"; g.fillRect(0, 0, 15, MH);
  g.fillStyle = "#FFFFFF"; g.fillRect(5, 4, 5, 8); g.fillRect(4, 7, 1, 4);
  for (let x = 16; x < MW; x++) for (let y = 0; y < MH; y++) if ((x + y + Math.floor(t * 6)) % 8 < 2) { g.fillStyle = "#3A0E10"; g.fillRect(x, y, 1, 1); }
  txt(g, "请勿进入", 44, 8.5, "#FFFFFF", 13, CN, "center");
};
const drawCall: DrawFn = (g, t) => marquee(g, "通话中 · 请稍候", t, "#FF4D57");
const drawHeadline: DrawFn = (g, t) => marquee(g, "专注中 · 14:30 后有空", t, "#FF6A3D");

// ===== 核心功能大图块 =====
function Laptop({ code, className = "" }: { code?: boolean; className?: string }) {
  return (
    <div className={`pd-laptop ${className}`} aria-hidden="true">
      <div className="pd-laptop-scr">
        {code
          ? Array.from({ length: 14 }, (_, i) => <span key={i} style={{ width: `${30 + ((i * 37) % 55)}%`, marginLeft: `${(i % 4) * 6}%` }} />)
          : <><b /><span style={{ width: "70%" }} /><span style={{ width: "54%" }} /><span style={{ width: "62%" }} /></>}
      </div>
      <div className="pd-laptop-base" />
    </div>
  );
}

const INTERVALS: [string, number][] = [["专注", 25], ["休息", 5], ["专注", 25], ["休息", 5], ["专注", 25], ["休息", 5]];
function IntervalTrack() {
  return (
    <div className="pd-track" aria-hidden="true">
      {INTERVALS.map(([k, m], i) => (
        <span key={i} className={`${k === "休息" ? "is-rest" : ""} ${i < 1 ? "is-done" : ""} ${i === 1 ? "is-now" : ""}`} style={{ flex: m }}>
          <b>{k}</b><em>{m}′</em>
        </span>
      ))}
    </div>
  );
}

function PhoneLock() {
  return (
    <div className="pd-phone" aria-hidden="true">
      <div className="pd-phone-scr">
        <span className="pd-phone-date">6月6日 星期一</span>
        <span className="pd-phone-time">9:41</span>
        <BellOff className="pd-phone-bell" />
        <div className="pd-phone-note">
          <div><b><i />收工牌</b><span>已屏蔽干扰</span></div>
          <span className="pd-phone-btn"><Pause /></span>
        </div>
      </div>
    </div>
  );
}

function MuteAllArt() {
  return (
    <div className="pd-lineart" aria-hidden="true">
      <div className="pd-la-door"><MatrixDevice draw={drawDoor} color="#FF4D57" small className="pd-la-sign" /></div>
      <div className="pd-la-laptop">
        <div className="pd-la-scr"><i className="pd-la-pill"><MicOff />勿扰</i><span /><span /><span /></div>
        <div className="pd-la-base" />
      </div>
      <div className="pd-la-watch"><BellOff /></div>
      <div className="pd-la-phone"><BellOff /></div>
      <div className="pd-la-badge"><span className="pd-logo-mark" /><div><em>配合使用</em><b>收工牌 App</b></div></div>
    </div>
  );
}

function CallArt() {
  const [sec, setSec] = useState(2);
  useEffect(() => { const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="pd-callart" aria-hidden="true">
      <div className="pd-callwrap">
      <div className="pd-call-hint"><Mic />麦克风一启用，自动切到“通话中”</div>
      <div className="pd-mac">
        <div className="pd-mac-bar">
          <span className="pd-mac-mic"><Mic /></span>
          <span className="pd-mac-oncall">通话中</span>
          <Wifi />
          <span>9:41</span>
        </div>
        <div className="pd-call">
          <div className="pd-call-h"><i>林</i><b>林晓</b><span className="num">{mmss(sec)}</span></div>
          <div className="pd-wave">{Array.from({ length: 40 }, (_, i) => <span key={i} style={{ animationDelay: `${(i * 97) % 900}ms` }} />)}</div>
          <div className="pd-call-btns"><span><Video />视频</span><span><MicOff />静音</span><span className="end"><PhoneOff />挂断</span></div>
        </div>
      </div>
      </div>
      <div className="pd-callart-door"><span className="pd-signal" /><MatrixDevice draw={drawCall} color="#FF4D57" small /></div>
    </div>
  );
}

export function Highlights() {
  return (
    <div className="pd-tiles">
      <article className="pd-tile">
        <div className="pd-tile-txt">
          <h3>显示你的状态</h3>
          <p>别让别人打断你的深度专注。屏幕直接告诉同事：你正在忙，以及什么时候有空。</p>
        </div>
        <div className="pd-tile-art pd-art-status">
          <Laptop className="pd-art-status-laptop" />
          <MatrixDevice draw={drawHeadline} color="#FF6A3D" className="pd-art-status-dev" />
        </div>
      </article>

      <article className="pd-tile">
        <div className="pd-tile-txt">
          <h3>间隔专注计时</h3>
          <p>受番茄工作法启发的专注计时器：把工作拆成一段段短时冲刺，专注 25 分钟、休息 5 分钟，自动循环。转一下旋钮就能开始，随时暂停、跳过或延长；计时结束也不会擅自改变你的状态。</p>
          <dl className="pd-tile-facts">
            <div><dt>5′ / 格</dt><dd>旋钮调时，单次最长 24 小时</dd></div>
            <div><dt>2–35 轮</dt><dd>专注、休息各 5 分钟到 8 小时</dd></div>
            <div><dt>45′</dt><dd>久坐提醒，开会、收工时自动暂停</dd></div>
          </dl>
        </div>
        <div className="pd-tile-art pd-art-timer">
          <Laptop code className="pd-art-timer-laptop" />
          <div className="pd-art-timer-main">
            <MatrixDevice draw={drawRest} color="#3BE08F" />
            <IntervalTrack />
          </div>
        </div>
      </article>

      <div className="pd-tile-pair">
        <article className="pd-tile is-stack">
          <div className="pd-tile-txt">
            <h3>屏蔽干扰</h3>
            <p>切到“勿扰”时，已配对的手机和电脑自动静音通知、进入专注模式，帮你在工作时挡掉分心的事；离开勿扰后，按你的设置恢复原样。</p>
          </div>
          <div className="pd-tile-art pd-art-block">
            <PhoneLock />
            <MatrixDevice draw={drawBlock} color="#FF4D57" className="pd-art-block-dev" />
          </div>
        </article>
        <article className="pd-tile is-stack">
          <div className="pd-tile-txt">
            <h3>所有设备一起静音</h3>
            <p>用免费的收工牌 App 统一管理电脑、手机和手表上的干扰。<b>无需订阅。</b></p>
          </div>
          <div className="pd-tile-art"><MuteAllArt /></div>
        </article>
      </div>

      <article className="pd-tile is-wide">
        <div className="pd-tile-txt">
          <h3>远程控制</h3>
          <p>无论你在隔壁房间还是城市另一头，都能通过互联网更新屏幕：远程改一句留言，或者在接打电话时自动切换状态。</p>
        </div>
        <div className="pd-tile-art"><CallArt /></div>
      </article>
    </div>
  );
}

// ===== 开发者区：示例程序切换 + 代码面板 =====
function hsl(h: number, l = 55) { return `hsl(${h % 360},100%,${l}%)`; }
const cpuHist: number[] = [], ramHist: number[] = [];
const drawCpuRam: DrawFn = (g, t) => {
  const step = Math.floor(t * 6.6);
  while (cpuHist.length <= step) {
    const n = cpuHist.length;
    cpuHist.push(Math.max(5, Math.min(98, 30 + 45 * Math.sin(n / 5) * Math.sin(n / 13) + (n % 7) * 3)));
    ramHist.push(Math.max(10, Math.min(90, 28 + 10 * Math.sin(n / 30) + ((n * 13) % 9))));
  }
  const panel = (hist: number[], x0: number, label: string, c: string, bg: string) => {
    g.fillStyle = bg; g.fillRect(x0, 0, 36, MH);
    const v = Math.round(hist[step]);
    pix(g, label, x0 + 1, 1, c);
    pix(g, `${v}%`, x0 + 35, 1, "#FFFFFF", 1, "right");
    for (let i = 0; i < 35; i++) {
      const h = Math.round((hist[Math.max(0, step - 34 + i)] ?? 0) / 100 * 9);
      g.fillStyle = c; g.fillRect(x0 + i, MH - h, 1, h);
    }
  };
  panel(cpuHist, 0, "CPU", "#FF3958", "#1E0508");
  panel(ramHist, 36, "RAM", "#56ADFF", "#04101E");
};
const drawAgent: DrawFn = (g, t) => {
  const phase = Math.floor(t / 3) % 3;
  const [label, c] = phase === 0 ? ["思考中", "#A88BFF"] : phase === 1 ? ["待确认", "#FFB224"] : ["已完成", "#3BE08F"];
  pix(g, "AI", 1, 3, c, 2);
  txt(g, label, 17, 8.5, c);
  if (phase === 0) for (let i = 0; i < 3; i++) { g.fillStyle = i <= Math.floor(t * 3) % 3 ? c : "#2A2540"; g.fillRect(62 + i * 3, 12, 2, 2); }
};
const drawHello: DrawFn = (g, t) => {
  g.font = `700 14px ${CN}`;
  const s = "你好，世界！";
  let x = MW - ((t * 20) % (g.measureText(s).width + MW + 10));
  for (const ch of s) { txt(g, ch, x, 8.5, hsl(x * 5 + t * 120)); x += g.measureText(ch).width; }
};
const drawWeather: DrawFn = (g, t) => {
  g.fillStyle = "#FFC53D";
  g.beginPath(); g.arc(8, 8, 4, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + t * 0.8;
    g.fillRect(Math.round(8 + Math.cos(a) * 6.5), Math.round(8 + Math.sin(a) * 6.5), 1, 1);
  }
  pix(g, "23°", 18, 3, "#FFFFFF", 2);
  txt(g, "晴", 57, 8.5, "#FFC53D");
};
const drawGame: DrawFn = (g, t) => {
  const bx = 2 + Math.abs(((t * 34) % 132) - 66), by = 1 + Math.abs(((t * 19) % 26) - 13);
  const py = Math.max(0, Math.min(11, by - 2));
  g.fillStyle = "#3BE08F"; g.fillRect(1, Math.max(0, Math.min(11, 6 + Math.sin(t * 3) * 5)), 1, 5);
  g.fillStyle = "#56ADFF"; g.fillRect(70, py, 1, 5);
  for (let y = 0; y < MH; y += 2) { g.fillStyle = "#2A2D33"; g.fillRect(36, y, 1, 1); }
  g.fillStyle = "#FFFFFF"; g.fillRect(Math.round(bx), Math.round(by), 2, 2);
  pix(g, "3", 33, 1, "#3BE08F", 1, "right");
  pix(g, "2", 39, 1, "#56ADFF");
};

const DEMOS: { id: string; label: string; file: string; draw: DrawFn; code: string }[] = [
  { id: "cpu", label: "CPU/RAM", file: "cpu-monitor.ts", draw: drawCpuRam, code: `// CPU 和内存占用画成两条实时曲线：每 150 ms 推入一个新采样，
// 旧数据向左滚动，整块屏幕一直在动。
// 负载是模拟的：换成 fetch() 读取你电脑的真实数据即可。
import { device } from "@shougongpai/sdk";
import { render, row, graph, label } from "@shougongpai/ui";

const PANELS = [
  { id: "cpu", label: "CPU", color: [255, 57, 90] },
  { id: "ram", label: "RAM", color: [86, 173, 255] },
];
const hist = { cpu: [], ram: [] };

setInterval(async () => {
  hist.cpu.push(await sample("cpu"));
  hist.ram.push(await sample("ram"));
  const frame = render(row(PANELS.map((p) =>
    graph(hist[p.id].slice(-35), { color: p.color, title: label(p.label) }))));
  await device.displayDraw(frame);
}, 150);` },
  { id: "agent", label: "AI Agent", file: "agent-status.ts", draw: drawAgent, code: `// 把编码 Agent 的状态同步到桌面：思考中 / 需要确认 / 已完成。
// 在 Agent 的 hooks 里调用 setStatus 即可。
import { device } from "@shougongpai/sdk";

const LOOK = {
  thinking: { text: "思考中…", color: "#A88BFF", led: "breath" },
  input:    { text: "需要你确认", color: "#FFB224", led: "notify" },
  done:     { text: "已完成 ✓", color: "#3BE08F", led: "solid" },
};

export async function setStatus(state: keyof typeof LOOK) {
  const s = LOOK[state];
  await device.displayDraw({ text: s.text, color: s.color, icon: "ai" });
  await device.lights(s.led, s.color);
}` },
  { id: "hello", label: "你好", file: "hello.py", draw: drawHello, code: `# 三行 Python，把一句彩虹色的问候滚动显示在屏幕上。
from shougongpai import Device

bar = Device("10.0.4.20")
bar.scroll("你好，世界！", rainbow=True, speed=20)` },
  { id: "weather", label: "天气", file: "weather.ts", draw: drawWeather, code: `// 每 10 分钟拉一次天气，画成图标 + 温度。
import { device } from "@shougongpai/sdk";
import { render, row, icon, text } from "@shougongpai/ui";

async function refresh() {
  const w = await fetch("https://api.example.com/weather?city=上海").then((r) => r.json());
  await device.displayDraw(render(row([
    icon(w.sunny ? "sun" : "cloud", { spin: true }),
    text(\`\${w.temp}°\`), text(w.desc, { color: "#FFC53D" }),
    text("上海", { size: "xs", align: "right" }),
  ])));
}
refresh();
setInterval(refresh, 10 * 60_000);` },
  { id: "game", label: "小游戏", file: "pong.ts", draw: drawGame, code: `// 72×16 像素上的乒乓球：旋钮控制左拍，右拍由电脑接球。
import { device, listen } from "@shougongpai/sdk";

let ball = { x: 36, y: 8, vx: 1, vy: 0.6 }, me = 6;
listen("input", (e) => { if (e.key === "knob") me += e.delta; });

setInterval(() => {
  ball.x += ball.vx; ball.y += ball.vy;
  if (ball.y <= 0 || ball.y >= 14) ball.vy *= -1;
  if (ball.x <= 2 || ball.x >= 69) ball.vx *= -1;
  device.displayDraw(drawCourt(ball, me));
}, 1000 / 30);` },
];

function CodeLine({ line }: { line: string }) {
  const c = line.trimStart();
  if (c.startsWith("//") || c.startsWith("#")) return <span className="c">{line || " "}</span>;
  const parts = line.split(/("[^"]*"|`[^`]*`|'[^']*')/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="s">{p}</span>
    : <span key={i} dangerouslySetInnerHTML={{ __html: p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\b(import|from|const|let|await|async|function|export|return|if|setInterval)\b/g, '<span class="k">$1</span>') || " " }} />))}</>;
}

const DEMO_GLOW: Record<string, string> = { cpu: "#FF3958", agent: "#A88BFF", hello: "#FF6A3D", weather: "#FFC53D", game: "#3BE08F" };

export function DevPlayground() {
  const [idx, setIdx] = useState(0);
  const [run, setRun] = useState(0);
  const demo = DEMOS[idx];
  const lines = demo.code.split("\n");
  return (
    <div className="pd-devbox">
      <h2>开发者和 Vibe Coder 都能玩</h2>
      <div className="pd-devbox-dev">
        <MatrixDevice key={`${demo.id}-${run}`} draw={demo.draw} color={DEMO_GLOW[demo.id]} />
      </div>
      <div className="pd-devtabs" role="tablist">
        {DEMOS.map((d, i) => (
          <button key={d.id} type="button" role="tab" aria-selected={i === idx} className={i === idx ? "on" : ""} onClick={() => setIdx(i)}>{d.label}</button>
        ))}
      </div>
      <div className="pd-devgrid">
        <div className="pd-code">
          <div className="pd-code-h">
            <span>{demo.file}</span>
            <div>
              <button type="button" onClick={() => setRun((r) => r + 1)}><RotateCcw />重置</button>
              <button type="button" className="on" onClick={() => setRun((r) => r + 1)}><Play />运行</button>
            </div>
          </div>
          <pre>{lines.map((l, i) => <div key={i}><i>{i + 1}</i><code><CodeLine line={l} /></code></div>)}</pre>
          <div className="pd-code-f">POST /api/display/draw → 200 OK</div>
        </div>
        <div className="pd-devpts">
          <div><h3>开放 HTTP API</h3><p>从任何脚本、应用或智能家居系统，把文字和图片发到屏幕上。</p></div>
          <div><h3>TypeScript 与 Python 库</h3><p>几行代码，就能用自己的程序画出自定义消息和图像。</p></div>
          <div><h3>AI Agent 状态联动</h3><p>电脑上的 Agent 在跑、等你输入、已完成还是出错了，抬头看一眼就知道；不显示任何代码和 Prompt。</p></div>
          <div><h3>装上更多小应用</h3><p>内置 JavaScript 应用引擎，时钟、天气一键安装；自己写的应用经 USB 或 Wi-Fi 装进设备，在沙箱里独立运行。</p></div>
          <div><h3>开源固件</h3><p>出厂的就是这份代码：Fork 一份，刷入你自己的版本。</p></div>
        </div>
      </div>
    </div>
  );
}
