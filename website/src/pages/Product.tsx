import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BatteryCharging, Bluetooth, CalendarClock, Check, ChevronDown, Cloud, Coffee, Cpu, Eye, Hand,
  House, Keyboard, KeyRound, LayoutDashboard, Lightbulb, Lock, Mic, Moon, Palette, Radio, Repeat,
  RotateCcw, ShieldCheck, Smartphone, Sparkles, Sun, Sunset, Truck, Usb, Users, Volume2, Wifi, X,
} from "lucide-react";
import { STATUSES } from "../domain/statuses";
import type { StatusId } from "../domain/types";
import { HoldButton } from "../ui/HoldButton";
import { DevPlayground, Highlights, TopView } from "./ProductScenes";
import "../styles/product.css";

// ===== 可直接改的商品信息（价格/配色为占位，正式开售前替换） =====
const PRICE = { now: 99, was: 399, tag: "早鸟价" };
const COLORS = [
  { id: "graphite", name: "石墨黑", swatch: "#2B2E33" },
  { id: "mist", name: "云雾白", swatch: "#E9E7E2" },
];

const BASE = import.meta.env.BASE_URL;
const EXTS = ["png", "jpg", "jpeg", "webp"];

/** 产品图位：按 public/product/<name>.(png|jpg|jpeg|webp) 依次尝试，全部缺失时显示占位框（文件放进去刷新即生效） */
function Shot({ name, alt, hint, ratio = "4 / 3", className = "" }: { name: string; alt: string; hint?: string; ratio?: string; className?: string }) {
  const [i, setI] = useState(0);
  const [prevName, setPrevName] = useState(name);
  if (prevName !== name) {
    setPrevName(name);
    setI(0);
  }
  const missing = i >= EXTS.length;
  return (
    <div className={`pd-shot ${missing ? "is-missing" : ""} ${className}`} style={{ aspectRatio: ratio }}>
      {missing ? (
        <div className="pd-shot-ph">
          <span className="pd-shot-tag">待补图</span>
          <b>{alt}</b>
          {hint && <span>{hint}</span>}
          <code>public/product/{name}.png</code>
        </div>
      ) : (
        <img src={`${BASE}product/${name}.${EXTS[i]}`} alt={alt} loading="lazy" onError={() => setI((v) => v + 1)} />
      )}
    </div>
  );
}

/** 截图：网页控制台真实界面 */
function AppShot({ name, alt }: { name: string; alt: string }) {
  return (
    <figure className="pd-appshot">
      <div className="pd-appshot-bar"><i /><i /><i /><span>收工牌 · 控制台</span></div>
      <img src={`${BASE}product/${name}.png`} alt={alt} loading="lazy" />
    </figure>
  );
}

/** 视频图位：public/product/<name>.mp4，进视口自动静音循环播放、出视口暂停，文件缺失时显示占位框；children 为叠加在视频上的介绍文字 */
function VideoShot({ name, alt, ratio = "16 / 9", className = "", children }: { name: string; alt: string; ratio?: string; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [missing, setMissing] = useState(false);
  const [on, setOn] = useState(false);
  const [ar, setAr] = useState(ratio);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    }, { threshold: 0.2 });
    io.observe(v);
    return () => io.disconnect();
  }, [missing]);
  return (
    <div className={`pd-shot pd-vshot ${missing ? "is-missing" : ""} ${className}`} style={{ aspectRatio: ar }}>
      {missing ? (
        <div className="pd-shot-ph">
          <span className="pd-shot-tag">待补视频</span>
          <b>{alt}</b>
          <code>public/product/{name}.mp4</code>
        </div>
      ) : (
        <>
          <video ref={ref} src={`${BASE}product/${name}.mp4`} muted loop playsInline preload="metadata" aria-label={alt} className={on ? "is-on" : ""}
            onError={() => setMissing(true)}
            onPlaying={() => setOn(true)}
            onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setAr(`${v.videoWidth} / ${v.videoHeight}`); }} />
          {children && <div className="pd-vshot-txt">{children}</div>}
        </>
      )}
    </div>
  );
}

// ===== 点阵屏设备（CSS 绘制，与产品渲染图同形：横条机身 + 顶部 4 键 + 最右旋钮） =====
const LED: Record<string, { color: string; sub: string }> = {
  work: { color: "#3BE08F", sub: "可以找我" },
  busy: { color: "#FF4D57", sub: "非紧急请稍后" },
  focus: { color: "#FF6A3D", sub: "还剩 24:59" },
  meet: { color: "#A88BFF", sub: "至 15:30" },
  rest: { color: "#34D7EE", sub: "稍后回来" },
  off: { color: "#F3E6CF", sub: "明天见" },
};
const DEMO_ORDER: StatusId[] = ["work", "busy", "focus", "meet", "rest", "off"];

function DotDevice({ status, small }: { status: StatusId; small?: boolean }) {
  const led = LED[status];
  return (
    <div className={`pd-dev ${small ? "is-small" : ""}`} style={{ ["--c" as string]: led.color }}>
      <div className="pd-dev-keys"><i /><i /><i /><i /><b /></div>
      <div className="pd-dev-body">
        <div className="pd-dev-screen" key={status}>
          <span className="pd-dev-big">{STATUSES[status].screen}</span>
          <span className="pd-dev-sub">{led.sub}</span>
        </div>
      </div>
      <div className="pd-dev-glow" />
    </div>
  );
}

function Section({ id, eyebrow, title, desc, children, className = "" }: { id?: string; eyebrow?: string; title: ReactNode; desc?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`pd-sec ${className}`}>
      <div className="pd-wrap">
        <header className="pd-sec-h">
          {eyebrow && <span className="pd-eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
          {desc && <p>{desc}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

function Feature({ icon, eyebrow, title, children, media, flip }: { icon: ReactNode; eyebrow: string; title: string; children: ReactNode; media: ReactNode; flip?: boolean }) {
  return (
    <div className={`pd-feat ${flip ? "is-flip" : ""}`}>
      <div className="pd-feat-txt">
        <span className="pd-feat-ico">{icon}</span>
        <span className="pd-eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        {children}
      </div>
      <div className="pd-feat-media">{media}</div>
    </div>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="pd-bullets">{items.map((t) => <li key={t}><Check />{t}</li>)}</ul>
);

// ===== 计划表 / 回顾 小样（不依赖设备连接，展示完整产品形态） =====
const PLAN: [string, StatusId][] = [["09:00", "work"], ["10:30", "meet"], ["11:30", "work"], ["12:00", "rest"], ["13:30", "focus"], ["15:00", "work"], ["18:00", "off"]];
function PlanMock() {
  return (
    <div className="pd-mock">
      <div className="pd-mock-tabs"><span className="on">标准工作日</span><span>居家办公</span><span>周五短工作日</span></div>
      <ol className="pd-plan">
        {PLAN.map(([t, s], idx) => (
          <li key={t} className={idx === 1 ? "is-next" : ""}>
            <span className="num">{t}</span>
            <i style={{ background: STATUSES[s].color }} />
            <b>{STATUSES[s].label}</b>
            {idx === 1 && <em>下一次切换</em>}
          </li>
        ))}
      </ol>
      <div className="pd-mock-foot"><CalendarClock />工作日重复 · 手动切换只覆盖到下一个节点</div>
    </div>
  );
}

const DAY: { s: StatusId | "none"; m: number }[] = [
  { s: "work", m: 90 }, { s: "meet", m: 60 }, { s: "work", m: 30 }, { s: "rest", m: 60 }, { s: "none", m: 30 },
  { s: "focus", m: 90 }, { s: "work", m: 120 }, { s: "busy", m: 45 }, { s: "work", m: 15 },
];
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60 ? `${m % 60} 分` : ""}` : `${m} 分`);
function ReviewMock() {
  const total = DAY.reduce((a, b) => a + b.m, 0);
  const sums = DAY.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.s]: (acc[d.s] ?? 0) + d.m }), {});
  return (
    <div className="pd-mock">
      <div className="pd-mock-h"><b>今天 · 09:00 – 18:00</b><span>切换 9 次</span></div>
      <div className="pd-daybar">
        {DAY.map((d, i) => <span key={i} className={d.s === "none" ? "pd-none" : ""} style={{ flex: d.m, background: d.s === "none" ? undefined : STATUSES[d.s].color }} />)}
      </div>
      <div className="pd-daylegend">
        {Object.entries(sums).map(([s, m]) => (
          <div key={s}>
            <i className={s === "none" ? "pd-none" : ""} style={{ background: s === "none" ? undefined : STATUSES[s].color }} />
            <span>{s === "none" ? "未记录" : STATUSES[s].label}</span>
            <b className="num">{fmt(m)}</b>
            <em className="num">{Math.round((m / total) * 100)}%</em>
          </div>
        ))}
      </div>
      <div className="pd-mock-foot"><ShieldCheck />只统计你设置的状态，不代表效率，也不做排名</div>
    </div>
  );
}

function OffworkMock() {
  const [done, setDone] = useState(false);
  return (
    <div className="card offwork pd-offwork">
      <div className="card-b">
        <div className="lbl"><Sunset />计划 18:00 收工</div>
        <div className="big">{done ? "今天辛苦了" : "00:42:10"}</div>
        <p>{done ? "已结束今天的状态记录，明天 09:00 见。" : "试试看：按住下面的按钮 1.5 秒。"}</p>
        {done
          ? <button type="button" className="btn hold" onClick={() => setDone(false)}><RotateCcw />撤销</button>
          : <HoldButton onComplete={() => setDone(true)}><Sunset />按住 1.5 秒收工</HoldButton>}
        <div className="foot">收工后计划表不会再把你切回“工作中”</div>
      </div>
    </div>
  );
}

const FAQ: [string, string][] = [
  ["收工牌会录音或者监控我吗？", "不会。麦克风只在你按下语音键时工作，录音仅用于把这句话解析成提醒，解析完即丢弃，不保存原始音频。机身有物理静音开关，关掉后麦克风在硬件上断开。收工牌也不检测你是否在座位上、是否真的在工作。"],
  ["同事能看到我的待办和日程吗？", "看不到。桌牌默认只显示状态名、预计结束时间和一句短提示；待办正文、会议标题、参会人都不会上屏。共享看板也只共享“当前状态”，计划表和历史只有你自己能看。"],
  ["手机不在身边，计划表还会执行吗？", "会。计划表同步后保存在设备里，按设备本地时钟执行。手机重新连上后，设备会把这段时间实际发生的切换同步回来，不会重复记录。"],
  ["收工之后，计划表会不会又把我切回“工作中”？", "不会。按下收工后，当天后续的工作节点不再自动生效；除非你自己重新开始工作，系统会提醒你这将开启新的状态区间。"],
  ["灯光会不会太亮、打扰别人？", "灯光默认低亮度，可以按状态单独设置常亮、呼吸或关闭，也可以设置夜间自动关灯，或者直接开启“无灯光模式”。屏幕文字始终是状态的权威信息。"],
  ["需要装 App 吗？支持哪些系统？", "Windows、macOS、ChromeOS 上用 Chrome / Edge 打开网页控制台即可，通过蓝牙或 USB 连接，不用安装任何东西。手机端提供 iOS 与 Android App，用于随身切换状态、语音提醒和专注模式联动。"],
  ["可以自己设计屏幕吗？", "可以。每个状态都能换成自己的屏幕：选模板改文字、上传图片，或者做简短的帧动画。进阶用户还可以用受限的 SDK 编写屏幕程序，装进设备后在沙箱里运行。"],
  ["团队里每个人都要有一台吗？", "单台就能完整使用。多台收工牌放在同一区域时，可以组成共享看板，彼此看到对方是否方便沟通；是否分享完全由每个人自己决定，默认关闭。"],
  ["能接入米家、HomeKit 这类智能家居吗？", "可以。收工牌支持 Matter 协议，扫码即可加入支持 Matter 的智能家居平台，作为一个开关出现：进入专注时自动打开，休息或结束时自动关闭，你可以用它联动门口的提示灯、关掉音箱等；反过来，在智能家居里打开这个开关，也能直接开始一轮专注。该功能可随时在设置里关闭。"],
  ["除了状态牌，还能装别的应用吗？", "可以。收工牌内置 JavaScript 应用引擎，可以安装时钟、天气等小应用，也可以用官方工具链自己写一个：打包、安装、启动都能通过网页或一条命令完成。应用运行在沙箱里，只能调用开放给它的接口，访问不到你的计划和记录。"],
  ["固件怎么升级？", "设备联网后会自动检查新版本，也可以在网页管理界面里手动上传更新包，或者用 USB 连接后一键刷写。升级包会先完整校验再安装，设备还内置恢复模式。"],
];

export function ProductPage() {
  const [demo, setDemo] = useState<StatusId>("meet");
  const [auto, setAuto] = useState(true);
  const [color, setColor] = useState(COLORS[0].id);
  const [shot, setShot] = useState(0);
  const [reserved, setReserved] = useState(false);

  useEffect(() => {
    document.title = "收工牌 · 让同事一眼看懂你现在方不方便";
    return () => { document.title = "收工牌"; };
  }, []);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setDemo((s) => DEMO_ORDER[(DEMO_ORDER.indexOf(s) + 1) % DEMO_ORDER.length]), 2600);
    return () => clearInterval(t);
  }, [auto]);

  const gallery: { name: string; alt: string; hint: string; render?: ReactNode }[] = [
    { name: color === "mist" ? "g-white" : "hero", alt: color === "mist" ? "云雾白配色 3/4 视角" : "收工牌 3/4 视角", hint: "与主图同角度的浅色版本" },
    { name: "g-front", alt: "正面平视", hint: "展示点阵屏与机身比例" },
    { name: "g-top", alt: "顶部俯视", hint: "4 枚按键 + 最右侧旋钮", render: <TopView /> },
    { name: "g-side", alt: "侧面与接口", hint: "USB-C 接口、静音开关" },
    { name: "scene-desk", alt: "桌面场景", hint: "放在显示器下方的工位" },
  ];

  return (
    <div className="pd">
      <nav className="pd-nav">
        <div className="pd-wrap pd-nav-in">
          <a href="#top" className="pd-logo"><span className="pd-logo-mark" />收工牌</a>
          <div className="pd-nav-links">
            <a href="#highlights">功能</a><a href="#app">配套软件</a><a href="#dev">开发者</a><a href="#specs">规格</a><a href="#faq">常见问题</a>
          </div>
          <div className="pd-nav-cta">
            <Link to="/" className="btn btn-ghost">打开控制台</Link>
            <a href="#buy" className="btn btn-primary">立即预约</a>
          </div>
        </div>
      </nav>

      {/* ===== 首屏：商品购买区 ===== */}
      <header id="top" className="pd-hero">
        <div className="pd-wrap pd-hero-in">
          <div className="pd-gallery">
            {gallery[shot].render
              ? <div className="pd-shot pd-gallery-main" style={{ aspectRatio: "16 / 10" }}>{gallery[shot].render}</div>
              : <Shot name={gallery[shot].name} alt={gallery[shot].alt} hint={gallery[shot].hint} ratio="16 / 10" className="pd-gallery-main" />}
            <div className="pd-thumbs">
              {gallery.map((g, i) => (
                <button key={g.name} type="button" className={i === shot ? "on" : ""} onClick={() => setShot(i)} aria-label={g.alt}>
                  {g.render
                    ? <div className="pd-shot" style={{ aspectRatio: "16 / 10" }}>{g.render}</div>
                    : <Shot name={g.name} alt={g.alt} ratio="16 / 10" />}
                </button>
              ))}
            </div>
          </div>

          <div id="buy" className="pd-buy">
            <span className="pd-eyebrow">桌面状态牌 · 首批预约中</span>
            <h1>收工牌</h1>
            <p className="pd-lede">一块放在工位上的状态牌。让同事一眼看懂你现在方不方便，也让你每天有一个明确的“收工”时刻。</p>
            <div className="pd-price">
              <b className="num">¥{PRICE.now}</b>
              <s className="num">¥{PRICE.was}</s>
              <span className="pd-price-tag">{PRICE.tag} · 省 ¥{PRICE.was - PRICE.now}</span>
            </div>
            <div className="pd-opt">
              <span className="pd-opt-l">配色：<b>{COLORS.find((c) => c.id === color)?.name}</b></span>
              <div className="pd-swatches">
                {COLORS.map((c) => (
                  <button key={c.id} type="button" className={c.id === color ? "on" : ""} style={{ background: c.swatch }} aria-label={c.name}
                    onClick={() => { setColor(c.id); setShot(0); }} />
                ))}
              </div>
            </div>
            <ul className="pd-hi">
              <li><Eye />大字点阵屏 + 状态灯，3 米外也看得清</li>
              <li><CalendarClock />时间计划表，到点自动切换状态</li>
              <li><Sunset />长按一键收工，自动生成当日回顾</li>
              <li><Repeat />番茄钟：工作 / 休息自动循环，最多 35 轮</li>
              <li><House />支持 Matter，专注时联动智能家居</li>
              <li><ShieldCheck />隐私优先：不录音存档，不做效率排名</li>
            </ul>
            <div className="pd-buy-btns">
              <button type="button" className="btn btn-primary pd-btn-lg" onClick={() => setReserved(true)} disabled={reserved}>
                {reserved ? <><Check />已预约，开售时通知你</> : <>立即预约 · 首批发货</>}
              </button>
              <a href="#features" className="btn btn-secondary pd-btn-lg">了解更多</a>
            </div>
            <ul className="pd-assure">
              <li><Truck />全国包邮，下单后 3 日内发货</li>
              <li><RotateCcw />30 天无理由退换</li>
              <li><ShieldCheck />整机 1 年质保</li>
            </ul>
          </div>
        </div>
      </header>

      {/* ===== 状态演示条 ===== */}
      <section className="pd-demo">
        <div className="pd-wrap pd-demo-in">
          <div className="pd-demo-txt">
            <span className="pd-eyebrow is-dark">点一点看看</span>
            <h2>你现在方不方便，<br />它替你说。</h2>
            <p>六种预设状态，每种都有独立的文字、图标与灯色。颜色只是辅助，文字才是答案，色弱的同事也能一眼看懂。</p>
            <div className="pd-demo-tabs" role="tablist">
              {DEMO_ORDER.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={demo === s} className={demo === s ? "on" : ""}
                  style={{ ["--c" as string]: LED[s].color }} onClick={() => { setAuto(false); setDemo(s); }}>
                  <i />{STATUSES[s].label}
                </button>
              ))}
            </div>
          </div>
          <DotDevice status={demo} />
        </div>
      </section>

      {/* ===== 痛点 ===== */}
      <Section eyebrow="为什么需要它" title="被打断一次，要花二十分钟才能找回状态" desc="戴耳机、贴便利贴、改聊天软件签名……这些办法要么没人注意，要么你自己也忘了改回来。">
        <div className="pd-pains">
          <div className="pd-pain"><Hand /><b>“方便问个事吗？”</b><span>同事不知道你在专注，只能当面打断你确认。</span></div>
          <div className="pd-pain"><Coffee /><b>“你还没下班？”</b><span>工作和生活没有边界，人走了，脑子还在工位。</span></div>
          <div className="pd-pain"><Users /><b>“他在开会吗？”</b><span>开放办公区里，谁在忙、谁有空，全靠猜。</span></div>
        </div>
        <div className="pd-vs pd-vs-inline">
          <div className="pd-vs-col">
            <h3>便利贴 / 耳机 / 聊天软件签名</h3>
            <ul>
              <li><X />状态写上去就忘了改</li>
              <li><X />同事看不见，或者看见了也不确定</li>
              <li><X />下班没有仪式，工作一直拖着</li>
              <li><X />不知道一天的时间花在了哪里</li>
            </ul>
          </div>
          <div className="pd-vs-col is-us">
            <h3>收工牌：便利贴会被忽略，它不会</h3>
            <ul>
              <li><Check />计划表到点自动切换，不用记</li>
              <li><Check />大字 + 灯光，远处也一眼看懂</li>
              <li><Check />长按收工，给一天画上句号</li>
              <li><Check />自动生成状态回顾，只给你自己看</li>
            </ul>
          </div>
        </div>
        <VideoShot name="scene-office" alt="开放办公区工位场景：同事路过，看到桌上的收工牌显示“会议中”" className="pd-wide">
          <h3>他在忙吗？抬头看一眼</h3>
          <p>开放工位里，同事路过时自己找答案——不用开口问，也不会真的打断你。</p>
        </VideoShot>
      </Section>

      {/* ===== 核心功能 ===== */}
      <Section id="highlights" eyebrow="核心功能" title="从专注到收工，它都替你照看" className="pd-alt">
        <Highlights />
      </Section>

      {/* ===== 功能 ===== */}
      <Section id="features" eyebrow="更多功能" title="一块状态牌，管好你的一整天">
        <Feature icon={<CalendarClock />} eyebrow="时间计划表" title="提前排好，到点自动切换"
          media={<PlanMock />}>
          <p>把一天的节奏写成计划表：9:00 工作中、10:30 会议中、12:00 休息中……到点后桌牌自己切换，你不用记得去改。</p>
          <Bullets items={["支持重复计划与单日计划，可建多套一键切换", "手动切换默认只覆盖到下一个节点，也可暂停今日计划", "手机离线时按设备本地时钟照常执行"]} />
        </Feature>

        <Feature flip icon={<Sunset />} eyebrow="一键收工" title="给每一天一个明确的结束"
          media={<div className="pd-stack"><OffworkMock /><VideoShot name="scene-offwork" alt="傍晚收工场景：夕阳下的工位，桌牌显示“已收工”" ratio="16 / 10" /></div>}>
          <p>长按收工键或在手机上按住 1.5 秒，桌牌切换为“已收工”，今天的状态记录到此为止。误触了？10 秒内可以撤销。</p>
          <Bullets items={["收工后计划表不会再把你切回工作状态", "可以设置“下班后提醒”，收工时才弹出", "手机没连上也能收工，重连后自动同步"]} />
        </Feature>

        <Feature icon={<LayoutDashboard />} eyebrow="状态回顾" title="看看今天的时间去了哪里"
          media={<ReviewMock />}>
          <p>每种状态的累计时长、占比、切换次数和起止时间一目了然。没有记录的时段就写“未记录”，不会替你猜是工作还是休息。</p>
          <Bullets items={["支持修正明显错误的区间", "数据只保存在你自己的设备和浏览器里", "不出现“效率”“绩效”“排名”"]} />
        </Feature>

        <Feature flip icon={<Lightbulb />} eyebrow="RGB 状态灯 · 自定义按键" title="远远看一眼，颜色就告诉你"
          media={<div className="pd-stack"><Shot name="scene-night" alt="夜间氛围" hint="暗光桌面，状态灯带泛出柔和光晕" ratio="16 / 10" /><AppShot name="app-lighting" alt="灯效设置界面" /></div>}>
          <p>屏幕下方的 RGB 灯带让状态在远处也能被识别。每个状态都可以单独设置灯色和模式，四枚按键也都可以重新映射。</p>
          <Bullets items={["常亮 / 呼吸 / 渐变 / 彩虹 / 闪烁 / 通知灯效，亮度可调", "环境光传感器自动调节亮度，暗处不刺眼", "夜间自动关灯，或开启无灯光模式；也可只在工作状态亮屏", "收工键的长按确认规则不可被覆盖，防止误触"]} />
        </Feature>

        <Feature icon={<Users />} eyebrow="共享状态看板" title="整个团队谁有空，一屏看清"
          media={<div className="pd-stack"><Shot name="scene-team" alt="团队办公场景：多张相邻工位上各放一台收工牌，分别显示不同状态" ratio="2560 / 1425" /><AppShot name="app-board" alt="共享看板界面" /></div>}>
          <p>团队里的收工牌通过 Wi-Fi 和云端彼此同步。加入团队后，在手机或网页上就能看到每位成员的当前状态和最后更新时间。</p>
          <Bullets items={["分享默认关闭，只分享“当前状态”", "邀请链接 / 二维码加入，随时退出或撤销", "离线成员标记“可能已过期”，不伪装成实时"]} />
        </Feature>
      </Section>

      {/* ===== 更多能力 ===== */}
      <Section eyebrow="还有更多" title="小身材，能做的事不少" className="pd-alt">
        <div className="pd-cards">
          <div className="pd-card">
            <span className="pd-card-ico" style={{ background: "var(--t-pink)", color: "var(--t-pink-i)" }}><Mic /></span>
            <h3>说一句话，创建提醒</h3>
            <p>“提醒我下班后带狗狗看医生”——AI 解析出时间和内容，你确认后才同步到桌牌。</p>
            <AppShot name="app-reminders" alt="待办与提醒界面" />
          </div>
          <div className="pd-card">
            <span className="pd-card-ico" style={{ background: "var(--t-violet)", color: "var(--t-violet-i)" }}><Palette /></span>
            <h3>屏幕想怎么显示都行</h3>
            <p>选模板、改文字、放图片、做简单的帧动画；进阶玩家还能写自己的屏幕程序。</p>
            <AppShot name="app-screen" alt="屏幕内容编辑界面" />
          </div>
          <div className="pd-card">
            <span className="pd-card-ico" style={{ background: "var(--t-orange)", color: "var(--t-orange-i)" }}><House /></span>
            <h3>接入智能家居</h3>
            <p>支持 Matter 协议，扫码加入智能家居后，收工牌就是一个“专注开关”：开始专注时门口提示灯自动亮起，休息时熄灭；在智能家居里打开它，也能直接开始一轮专注。</p>
          </div>
        </div>
      </Section>

      {/* ===== 配套软件 ===== */}
      <Section id="app" eyebrow="配套软件" title="打开浏览器就能用的控制台" desc="用 Chrome / Edge 打开控制台，蓝牙或 USB 连上收工牌即可，不用安装任何东西。手机端 App 同步上线。">
        <AppShot name="app-overview" alt="控制台总览" />
        <div className="pd-app-pts">
          <div><Bluetooth /><b>蓝牙 / USB 直连</b><span>Web Bluetooth 与 Web Serial，免驱动</span></div>
          <div><Smartphone /><b>手机 App</b><span>iOS / Android，随身切换状态</span></div>
          <div><Lock /><b>数据在本地</b><span>计划、待办、回顾都存在设备与浏览器</span></div>
          <div><Sparkles /><b>持续更新</b><span>固件与屏幕程序可在线升级</span></div>
          <div><Usb /><b>USB 即网卡</b><span>插上 USB 就能打开设备内置的管理页面</span></div>
          <div><Cloud /><b>Wi-Fi 与账号绑定</b><span>输入 4 位配对码绑定账号，离开工位也能查看</span></div>
          <div><KeyRound /><b>开放 HTTP API</b><span>附 OpenAPI 文档，访问令牌与密码保护</span></div>
          <div><Sun /><b>自动亮度</b><span>环境光传感器按周围亮度调节屏幕与灯光</span></div>
        </div>
        <div className="pd-center"><Link to="/" className="btn btn-primary pd-btn-lg">打开网页控制台<ArrowRight /></Link></div>
      </Section>

      {/* ===== 开发者 ===== */}
      <section id="dev" className="pd-sec">
        <div className="pd-wrap"><DevPlayground /></div>
      </section>

      {/* ===== 幕后 ===== */}
      <section className="pd-sec pd-story">
        <div className="pd-wrap pd-story-in">
          <img src={`${BASE}product/prototype.jpg`} alt="收工牌早期面包板原型" loading="lazy" />
          <div>
            <span className="pd-eyebrow">幕后</span>
            <h2>从一块面包板开始</h2>
            <p>收工牌最初只是一块面包板：一颗 ESP32-S3、一块小屏幕、几个按键和一个旋钮。我们每天把它放在自己的工位上，改了几十版交互，直到“按一下、旋一下、长按收工”变成不需要思考的动作。</p>
            <p>现在它有了正式的外壳，但初衷没变：做一个由你自己掌控的小工具，帮你守住专注，也帮你按时下班。</p>
          </div>
        </div>
      </section>

      {/* ===== 规格 ===== */}
      <Section id="specs" eyebrow="技术规格" title="规格参数" className="pd-alt">
        <div className="pd-specs">
          <div><h4><Eye />屏幕</h4><ul><li>正面 72×16 全彩 RGB LED 点阵屏</li><li>背面 160×80 灰阶副屏，看计时与菜单</li><li>大字状态名 + 图标 + 预计结束时间</li><li>自动调光、定时熄屏、像素位移防烧屏</li><li>环境光传感器，0–15 级自动亮度</li></ul></div>
          <div><h4><Keyboard />操作</h4><ul><li>4 枚实体按键（收工键 + 3 枚可自定义）</li><li>金属旋钮，带按压确认，每格 5 分钟</li><li>机身电容触摸区</li></ul></div>
          <div><h4><Lightbulb />灯光</h4><ul><li>RGB 状态灯带</li><li>常亮 / 呼吸 / 闪烁，亮度可调</li><li>渐变、彩虹、通知等预设灯效</li><li>夜间关闭时段、无灯光模式</li></ul></div>
          <div><h4><Volume2 />声音</h4><ul><li>MEMS 数字麦克风</li><li>物理麦克风静音开关 + 录音指示</li><li>提示音扬声器，音量可调</li></ul></div>
          <div><h4><Cpu />处理器</h4><ul><li>STM32U5 主控 · Cortex-M33 160 MHz</li><li>SiWG917 独立无线协处理器</li><li>屏幕程序沙箱运行</li><li>JavaScript 应用引擎</li></ul></div>
          <div><h4><Radio />连接</h4><ul><li>Bluetooth LE 5.0</li><li>2.4 GHz Wi-Fi 6</li><li>USB-C 数据连接 · USB 虚拟网卡</li><li>Matter 智能家居 · MQTT（TLS）云连接</li><li>mDNS 局域网自动发现</li></ul></div>
          <div><h4><BatteryCharging />供电</h4><ul><li>内置可充电锂电池</li><li>USB-C 充电</li><li>低电量时才在屏幕提示</li><li>空闲自动进入低功耗模式，支持软关机</li></ul></div>
          <div><h4><Wifi />软件</h4><ul><li>网页控制台：Chrome / Edge</li><li>手机 App：iOS / Android</li><li>固件在线升级</li><li>设备内置网页管理界面与 HTTP API</li></ul></div>
        </div>
      </Section>

      {/* ===== FAQ ===== */}
      <Section id="faq" eyebrow="常见问题" title="你可能想知道">
        <div className="pd-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}<ChevronDown /></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ===== 收尾 CTA ===== */}
      <section className="pd-final">
        <div className="pd-wrap pd-final-in">
          <div>
            <h2>今天，准时收工。</h2>
            <p>首批 {PRICE.tag} ¥{PRICE.now}，预约后开售第一时间通知你。</p>
            <div className="pd-buy-btns">
              <a href="#buy" className="btn pd-btn-lg pd-btn-light">立即预约<ArrowRight /></a>
              <Link to="/" className="btn pd-btn-lg pd-btn-outline">先试试控制台</Link>
            </div>
          </div>
          <DotDevice status="off" small />
        </div>
      </section>

      <footer className="pd-foot">
        <div className="pd-wrap pd-foot-in">
          <span className="pd-logo"><span className="pd-logo-mark" />收工牌</span>
          <span><Moon />由你自己掌控的桌面状态牌</span>
          <span>© 2026 收工牌</span>
        </div>
      </footer>
    </div>
  );
}
