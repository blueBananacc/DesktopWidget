import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BookmarkPlus, Code2, Copy, Eraser, FileUp, Image, LayoutTemplate, Play, Plus, ShieldCheck, Trash2, Upload, Cpu, TriangleAlert, HardDrive, X } from "lucide-react";
import { WAT_TEMPLATES } from "../domain/watTemplates";
import { APP_H, APP_MAX_BYTES, APP_W, clearApp, deployedHashes, drawDefaultScreen, hashBytes, pendingClears, previewScreen, screenBytes, sendApp, setDeployedHash, setPendingClears, u8ToB64, validateApp, type DefaultScreen, type ScreenPreview } from "../device/app";
import { getApi, toStateWrite, useStore } from "../store/AppStore";
import { allStatusIds, statusApiIndex, statusMeta } from "../domain/statuses";
import type { DeviceApp, ScreenDef, ScreenPreset, StatusId } from "../domain/types";
import { atToday, hhmm } from "../domain/time";
import { nextNode, scheduleForDay } from "../domain/schedule";
import { Banner, Card, CardHeader, Modal, StatusChip, Tile, Toggle } from "../ui/Primitives";
import { useToast } from "../ui/Toast";


const fmtSize = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const hasCode = (d?: ScreenDef) => !!d && (d.kind === "wasm" || !!d.src.trim());

/** 某状态屏幕的真实来源：以设备上报的安装清单为准，本机只有草稿时如实说明 */
type Source = { label: string; tone: "muted" | "ok" | "warn" | "new" };
function sourceOf(def: ScreenDef | undefined, app: DeviceApp | undefined, known: boolean, stale = false): Source {
  const local = hasCode(def);
  if (app?.bad) return { label: "已被设备禁用", tone: "warn" };
  if (!known) return local ? { label: "自定义 · 连接后核对", tone: "new" } : { label: "默认屏幕", tone: "muted" };
  if (app && local) return stale ? { label: "自定义 · 有改动未上传", tone: "warn" } : { label: "自定义 · 已装到设备", tone: "ok" };
  if (app) return { label: "设备上有自定义 · 本机无源码", tone: "new" };
  return local ? { label: "自定义 · 未上传", tone: "warn" } : { label: "默认屏幕", tone: "muted" };
}
const TONE_CLASS: Record<Source["tone"], string> = { muted: "scr-tag", ok: "scr-tag ok", warn: "scr-tag warn", new: "scr-tag new" };

/** 128×64 OLED 画布：有程序就跑 wasm，否则画固件默认屏 */
function OledCanvas({ def, status, screen, keyboard, nonce = 0, onReady, onError, style, segStart, nodeMin }: {
  def?: ScreenDef; status: StatusId; screen: DefaultScreen; keyboard?: boolean; nonce?: number;
  onReady?: (p: ScreenPreview | null) => void; onError?: (msg: string) => void; style?: CSSProperties;
  segStart?: number; nodeMin?: () => number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const running = hasCode(def);
  const srcKey = def ? (def.kind === "wat" ? def.src : def.b64) : "";
  useEffect(() => {
    if (!running || !def) return;
    let alive = true;
    let p: ScreenPreview | null = null;
    const t = setTimeout(async () => {
      try {
        const bytes = await screenBytes(def);
        if (!alive || !ref.current) return;
        p = await previewScreen(bytes, ref.current, { status: statusApiIndex(status), keyboard, onError, segStart, nodeMin });
        if (!alive) { p.stop(); return; }
        onError?.("");
        onReady?.(p);
      } catch (e) {
        if (alive) { onError?.(e instanceof Error ? e.message : String(e)); onReady?.(null); }
      }
    }, keyboard ? 450 : 0); // 编辑器里边写边预览：停手 450ms 再编译
    return () => { alive = false; clearTimeout(t); p?.stop(); onReady?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, running, status, keyboard, nonce, segStart]);
  useEffect(() => {
    if (!running && ref.current) drawDefaultScreen(ref.current, screen);
  }, [running, screen.main, screen.sub, screen.clock, screen.connected, screen.layout]);
  return (
    <div className="scr-oled" style={style}>
      <canvas ref={ref} width={APP_W} height={APP_H} />
    </div>
  );
}

/** 新状态调色板：沿用设计语言的状态色系 + 两个扩展色 */
const CUST_COLORS = ["#22A06B", "#E5484D", "#B4232C", "#7C5CFA", "#0EA5B7", "#D97706", "#DB2777", "#4C5CF6", "#6B7280"];

/** 新建自定义状态：写进设备注册表（stdef），之后每个状态的屏幕格/按键/计划表都能用它 */
function AddStatusDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (d: { id: string; zh: string; hint?: string; c: number; work: boolean }) => void }) {
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");
  const [color, setColor] = useState(CUST_COLORS[3]);
  const [work, setWork] = useState(false);
  const valid = name.trim().length > 0 && name.trim().length <= 6;
  return (
    <Modal title="新建自定义状态" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!valid}
          onClick={() => onCreate({ id: `c${Math.random().toString(36).slice(2, 6)}`, zh: name.trim(), hint: hint.trim() || undefined, c: parseInt(color.slice(1), 16), work })}>
          创建
        </button>
      </>}>
      <div className="form">
        <label>名称（屏幕大字，建议 ≤4 个汉字）<input className="input" value={name} maxLength={6} placeholder="例如：直播中" autoFocus onChange={(e) => setName(e.target.value)} /></label>
        <label>说明行（可选）<input className="input" value={hint} maxLength={10} placeholder="例如：下播后找我" onChange={(e) => setHint(e.target.value)} /></label>
        <div>
          <div className="form-label">状态颜色（网页与 RGB 灯共用）</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {CUST_COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} className={`cust-swatch${color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
            <input type="color" className="cust-color" value={color} onChange={(e) => setColor(e.target.value)} title="自选颜色" />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div><b style={{ fontSize: 14 }}>计入工作时长</b><div className="hint">开着时累计“工作类”时长，到点触发休息提醒</div></div>
          <Toggle checked={work} onChange={setWork} />
        </div>
        <p className="hint" style={{ margin: 0 }}>状态定义存进设备注册表（最多 8 个）。创建后可以给它写自定义屏幕、绑按键、排进计划表，断电不丢。</p>
      </div>
    </Modal>
  );
}

const Keys = ({ preview }: { preview: ScreenPreview | null }) => (
  <div className="scr-keys" aria-label="模拟设备按键">
    {[0, 1, 2, 3].map((i) => (
      <button key={i} type="button" disabled={!preview}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); preview?.press(i, true); }}
        onPointerUp={() => preview?.press(i, false)} onPointerCancel={() => preview?.press(i, false)}>
        K{i + 1}
      </button>
    ))}
  </div>
);

export function StatusScreens() {
  const { s, now, device, actions } = useStore();
  const toast = useToast();
  const connected = device.state === "connected";
  const known = connected && device.apps !== undefined;
  const [id, setId] = useState<StatusId>(s.current.id);
  const def = s.settings.customScreens[id];
  const app = known ? device.apps?.[id] : undefined;
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ScreenPreview | null>(null);
  const [size, setSize] = useState(0);
  const [hash, setHash] = useState("");
  const [deployed, setDeployed] = useState(deployedHashes);
  const [sent, setSent] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const isCustom = s.customStatuses.some((c) => c.id === id);

  const screenFor = (x: StatusId): DefaultScreen => ({
    main: statusMeta(x).screen,
    sub: x === s.current.id ? (toStateWrite(s).sub ?? "") : statusMeta(x).hint,
    clock: hhmm(now),
    connected: connected && device.kind === "ble",
    layout: s.settings.screenLayout,
  });

  // nodeMin() 预览值：按网页侧计划表算"距下个节点分钟数"（与固件同规则：暂停/已收工 → -1）
  const nodeMinFor = () => {
    if (s.pausedToday || s.offworkToday) return -1;
    const n = nextNode(scheduleForDay(s.schedules, s.activeScheduleId, Date.now()), Date.now());
    return n ? Math.max(0, Math.round((atToday(n.time, Date.now()) - Date.now()) / 60000)) : -1;
  };
  const segStartFor = (x: StatusId) => (x === s.current.id ? s.current.since : undefined);

  const setDef = (d: ScreenDef | undefined) => {
    const { [id]: _drop, ...rest } = s.settings.customScreens;
    actions.updateSettings({ customScreens: d ? { ...rest, [id]: d } : rest });
  };

  useEffect(() => {
    setError("");
    if (!hasCode(def)) { setSize(0); setHash(""); return; }
    let alive = true;
    screenBytes(def!).then((b) => { if (alive) { setSize(b.length); setHash(hashBytes(b)); } }, () => { if (alive) { setSize(0); setHash(""); } });
    return () => { alive = false; };
  }, [def, id]);

  const select = (x: StatusId) => { setId(x); if (window.innerWidth < 1100) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const upload = async () => {
    const api = getApi();
    if (!api || !def) return;
    setSent(0);
    try {
      const bytes = await screenBytes(def);
      const bad = await validateApp(bytes, statusApiIndex(id)); // 先在本机完整跑约 10 帧，有错不写进设备
      if (bad) { setError(bad); toast({ message: `代码运行出错，没有上传：${bad}`, seconds: 8 }); return; }
      await sendApp(api, id, bytes, setSent);
      setDeployedHash(id, hashBytes(bytes)); setDeployed(deployedHashes());
      toast({ message: `已写入设备「${statusMeta(id).label}」屏幕：进入该状态自动运行，断电不丢`, seconds: 8 });
    } catch (e) {
      toast({ message: `上传失败：${e instanceof Error ? e.message : e}`, seconds: 8 });
    } finally {
      setSent(null);
    }
  };

  const pickFile = async (f: File) => {
    if (f.size > APP_MAX_BYTES) { setError(`文件超过 ${APP_MAX_BYTES / 1024} KB 上限`); return; }
    setDef({ kind: "wasm", b64: u8ToB64(new Uint8Array(await f.arrayBuffer())), name: f.name });
  };

  const restore = async () => {
    setDef(undefined);
    const api = getApi();
    if (api && connected) {
      await clearApp(api, id).catch(() => {});
    } else {
      setPendingClears([...new Set([...pendingClears(), id])]); // 记住这次清除，连上设备后真正发 clear
    }
    setDeployedHash(id); setDeployed(deployedHashes());
    toast({ message: `「${statusMeta(id).label}」已恢复默认屏幕${connected ? "" : "；设备上的程序会在下次连接时一并清除"}`, seconds: 6 });
  };

  /** 把当前 WAT 改动存成一块"我的屏幕块"：之后在任何状态的模板区都能选它复用 */
  const savePreset = () => {
    if (!def || def.kind !== "wat") return;
    const name = (def.name ?? "").trim() || "未命名屏幕";
    const p: ScreenPreset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      desc: (def.desc ?? "").trim(),
      src: def.src,
    };
    actions.updateSettings({ screenPresets: [...s.settings.screenPresets, p] });
    toast({ message: `已存为新的块「${name}」：在任何状态的模板区都能选它`, seconds: 6 });
  };

  const copyForAgent = async () => {
    const text = [
      `请为一块智能桌牌（收工牌）写一个小屏幕程序。这份程序将装到状态「${statusMeta(id).label}」（status()=${statusApiIndex(id)}），设备每次进入该状态就自动运行它。我会把产出的代码贴进配套网页，由网页编译并上传到设备执行。你不需要了解这个项目的其他背景，下面就是全部契约。`,
      "",
      "【屏幕】",
      "128×64 单色 OLED：每像素只有亮/灭，没有灰度和颜色。坐标原点左上角，x 向右 0–127，y 向下 0–63。小屏建议：文字 ≥10px，元素间隙 ≥2px，避免大面积常亮（OLED 烧屏）。",
      "",
      "【交付物】",
      "首选：WebAssembly 文本格式（WAT）源码，可以直接粘贴进网页编辑器。",
      "或：给出 C 源码 + clang 编译命令，产物为 .wasm 二进制（上限 48 KB），由我在网页里「导入 .wasm」。",
      "",
      "【程序模型】",
      "- 必须导出 run()（无参、无返回）。设备进入对应状态后约每 33ms 调一次（≈30fps）——循环是设备做的，不要在 run() 里写长循环或死循环，否则设备看门狗会复位并禁用该程序。",
      "- 每一帧自己负责：clear() 清帧缓冲 → 绘制 → show() 刷上屏。没有帧号参数；动画节奏用 millis() 自取（比如 millis()/125 当 tick）。",
      "- 需要存字符串/位图/数组时：(memory (export \"memory\") 1) 加 (data (i32.const N) \"...\") 数据段；线性内存最多 64KB。memory 必须以 \"memory\" 名字导出——网页预览靠它读文本/位图的字节，不导出则预览报错。",
      "- 数据段字符串支持中文直接写 UTF-8 字面量；不可见字节用 \\hh 十六进制转义（如 \\00）。各数据段地址不要重叠。",
      "",
      "【宿主 API】（全部 import \"env\" \"<名字>\"，参数和返回值均为 i32）",
      "clear()                   清整个帧缓冲（每帧开头调用）",
      "show()                    帧缓冲刷上 OLED（每帧结尾调用）",
      "px(x, y)                  置一个像素（受 color 模式影响）；越界自动裁剪",
      "color(m)                  绘制模式：0=灭(擦除) 1=亮 2=反色XOR；对之后所有绘制函数生效（矩形、文字、位图都吃），每帧开始时是 1。做高亮块/反白文字：color(2) 再画实心矩形/圆",
      "rect(x, y, w, h, fill)    矩形；fill≠0 实心，fill=0 描边",
      "line(x1, y1, x2, y2)      直线",
      "circle(cx, cy, r, fill)   圆；fill≠0 实心",
      "ellipse(cx, cy, rx, ry, fill)  椭圆；rx/ry 两轴半径",
      "rrect(x, y, w, h, r, fill)     圆角矩形；r 圆角半径",
      "bitmap(x, y, w, h, ptr)   1bpp 位图：从线性内存 ptr 读，行主序、每行 (w+7)/8 字节、bit 低位先（即 XBM 格式）。任意图标、非标准字形都可以这样画",
      "text(x, y, ptr, len)      6×10 ASCII 字体；从线性内存 ptr 处读 len 字节（len≤64）；y 是文字基线，想让文字贴着顶部就传 y≈8–10",
      "textC(x, y, ptr, len)     wqy12 UTF-8 中文小字（与默认屏说明行同字体）；ptr 指向 UTF-8 字节",
      "bigText(x, y, ptr, len)   wqy16 UTF-8 中文大字（与默认屏状态名同字体）",
      "textW(ptr, len, font) -> i32   文字像素宽：font 0=6x10 1=wqy12 2=wqy16；居中/右对齐用它量",
      "textA(x, y, ptr, len, font, align)   锚点文本：一次说清字体+对齐。font 0/1/2 同上；align 0–8 九宫格：0左上 1上中 2右上 3左中 4正中 5右中 6左下 7下中 8右下，(x,y) 就是该锚点的位置——想居中一段文字直接 align=4、x=64、y=32，不用自己算宽",
      "millis() -> i32           设备毫秒计数（动画的时钟来源）",
      "buttons() -> i32          K1–K4 按键位掩码：bit0=K1，bit1=K2，bit2=K3，bit3=K4；按下为 1，可做交互。注意：K1 长按 1.5 秒是\"收工\"（切到已下班状态），这是系统行为，程序拦不住——交互建议用短按和其他键",
      "status() -> i32           当前状态下标：0=工作中 1=勿扰 2=专注 3=会议 4=休息 5=已下班。程序按状态装载，对这份程序来说它是个常量（装到哪个状态就是哪个下标）",
      "clock() -> i32            本地时钟：今日已过分钟数 0–1439（/60 取小时、%60 取分钟）；设备未校时返回 -1，请做好该分支的显示",
      "segSec() -> i32           当前状态已持续的秒数（做\"专注 12:30\"这类状态计时用它；未校时也可用）",
      "nodeMin() -> i32          距今日下一个计划节点的分钟数（例如\"会议还 X 分钟结束\"）；-1=没有节点/今日计划暂停/已收工/未校时",
      "",
      "【WAT 骨架】",
      "(module",
      "  (import \"env\" \"clear\" (func $clear))",
      "  (import \"env\" \"show\" (func $show))",
      "  (import \"env\" \"text\" (func $text (param i32 i32 i32 i32)))",
      "  (import \"env\" \"millis\" (func $millis (result i32)))",
      "  (memory (export \"memory\") 1)",
      "  (data (i32.const 16) \"HELLO\")",
      "  (func $run (export \"run\")",
      "    call $clear",
      "    (call $text (i32.const 30) (i32.const 36) (i32.const 16) (i32.const 5))",
      "    call $show))",
      "",
      "【常用技巧】",
      "- 显示数字：没有 itoa/sprintf。把数值 /10、%10 拆位，加 48（'0'）后 i32.store8 写进内存缓冲区，再当字符串画出来。",
      "- 反白高亮：color(2) 后画一个实心形状（rect/circle/rrect），覆盖到的像素全部翻转，画完用 color(1) 调回。",
      "- 图标/自定义字形：用 bitmap()，数据按行主序、每行 (w+7)/8 字节、bit 低位先排成 XBM 字节数组写进数据段。",
      "- 构图建议：顶部小字时钟/标题 + 中部 wqy16 大字（最多 4 个汉字）+ 底部 wqy12 说明行；textA 的九宫格对齐让定位不用算宽度。",
      "",
      "【限制与坑】",
      "- 字体只有三档：6×10 ASCII / wqy12 中文小字 / wqy16 中文大字；文字首选 textA()（自带九宫格对齐），需要精确控位再用 text()/textC()/bigText()+textW() 自己算。其他字形/图标用 bitmap() 从内存位图画。",
      "- import 声明的签名必须与上面一致：标了 \"-> i32\" 的函数在 import 里必须写 (result i32)，否则设备加载时报 missing imported function。",
      "- 文本绘制每次最多读 64 字节（中文 3 字节/字，约 21 字上限），超长拆成多次画。",
      "- run() 必须很快返回；每帧做完整重绘，不要增量累积。",
      "- 上传前网页会先把二进制完整跑约 10 帧做校验，跑不通的代码不会写入设备。",
      "",
      "【我想要的画面】",
      "（在这里向 Agent 描述你想要的画面或动画，例如：“已下班”时一行英文字从右往左滚动）",
    ].join("\n");
    await navigator.clipboard.writeText(text).then(() => toast({ message: "已复制给 Agent 的说明，粘贴给它即可" }), () => toast({ message: "复制失败，请手动查看 doc/display-app-spec.md" }));
  };

  const customCount = allStatusIds().filter((x) => hasCode(s.settings.customScreens[x]) || (known && device.apps?.[x])).length;
  const appErr = device.appErr && device.appErr.status === id ? device.appErr : undefined;
  const uploading = sent !== null;
  // 设备只报大小：大小不同必然没装；大小相同再比本机记录的上传指纹（没有记录则按大小判断）
  const dirty = hasCode(def) && known && (!app || app.bad || app.size !== size || (!!deployed[id] && deployed[id] !== hash));
  const src = sourceOf(def, app, known, dirty);

  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <CardHeader icon={<Tile color="violet" size={30}><Image /></Tile>} title="各状态屏幕" count={customCount || undefined} />
        <div className="card-b">
          <div className="scr-grid">
            {allStatusIds().map((x) => {
              const d = s.settings.customScreens[x];
              const a = known ? device.apps?.[x] : undefined;
              const so = x === id ? src : sourceOf(d, a, known); // 选中项用编辑器里带指纹比对的结果，保持两处一致
              return (
                <button key={x} type="button" className={`scr-cell ${x === id ? "on" : ""}`} onClick={() => select(x)} aria-pressed={x === id}>
                  {a && !hasCode(d) ? (
                    <div className="scr-oled scr-unknown"><Cpu /><span>设备上的自定义程序</span></div>
                  ) : (
                    <OledCanvas def={a?.bad ? undefined : d} status={x} screen={screenFor(x)} segStart={segStartFor(x)} nodeMin={nodeMinFor} />
                  )}
                  <div className="scr-cap">
                    <StatusChip id={x} />
                    {x === s.current.id && <span className="badge b-new">当前</span>}
                    {s.customStatuses.some((c) => c.id === x) && <span className="badge b-new" title="设备注册表 /stdefs.json 中的自定义状态">自定义</span>}
                  </div>
                  <span className={TONE_CLASS[so.tone]}>{so.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="scr-cell scr-add"
              disabled={!connected || s.customStatuses.length >= 8}
              title={!connected ? "状态注册表在设备上，连接后才能新建" : s.customStatuses.length >= 8 ? "最多 8 个自定义状态（设备注册表容量上限）" : "新建一个自定义状态（写入设备注册表）"}
              onClick={() => setAddOpen(true)}
            >
              <div className="scr-oled scr-add-oled"><Plus /><span>新状态</span></div>
              <div className="scr-cap"><span className="chip s-custom">自定义</span></div>
              <span className="scr-tag">{connected ? "写入设备" : "需连接设备"}</span>
            </button>
          </div>
          <p className="hint" style={{ margin: "16px 0 0" }}>
            点任意一格可在下方编辑。自定义屏幕的画面完全由程序决定；待办提醒和休息提醒会临时盖住任何屏幕。
            自定义状态有自己的名字、颜色和说明行，可以像内建状态一样被按键/计划表/语音切换。
            {!connected && " 设备未连接：屏幕内容和状态定义都以设备为准，这里显示的是上次同步的镜像；新建/删除状态需连接设备。"}
            {connected && device.apps === undefined && " 设备没有上报安装清单，固件需要升级到 0.5 以上才能核对。"}
          </p>
        </div>
      </Card>

      <div ref={editorRef} style={{ scrollMarginTop: 20 }}>
        <Card style={{ marginBottom: 20 }}>
          <CardHeader icon={<Tile color="blue" size={30}><Code2 /></Tile>} title={<>编辑屏幕 · {statusMeta(id).label}</>}
            extra={<>
              <span className={TONE_CLASS[src.tone]}>{src.label}</span>
              {isCustom && (
                <button className="btn btn-danger btn-sm"
                  disabled={!connected}
                  title={connected ? "从设备注册表删除这个自定义状态" : "状态注册表在设备上，连接后才能删除"}
                  onClick={() => {
                    const meta = statusMeta(id);
                    const usedBy = s.schedules.filter((sc) => sc.nodes.some((n) => n.status === id)).length;
                    const usedTip = usedBy ? `\n有 ${usedBy} 张计划表正在使用它，删除后这些表需修正状态才能设为当前计划。` : "";
                    if (!confirm(`删除自定义状态「${meta.label}」？设备注册表和它的自定义屏幕都会移除；正在使用时会退回“工作中”。${usedTip}\n历史回顾里的记录会保留原名。`)) return;
                    actions.stdefDel(id);
                    select("work");
                    toast({ message: `已删除「${meta.label}」` });
                  }}><Trash2 />删除状态</button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => void copyForAgent()}><Copy />复制给 Agent</button>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><FileUp />导入 .wasm</button>
              <input ref={fileRef} type="file" accept=".wasm" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }} />
            </>} />
          <div className="card-b scr-edit">
            <div className="scr-side">
              <OledCanvas def={def} status={id} screen={screenFor(id)} keyboard nonce={nonce} onReady={setPreview} onError={setError} style={{ maxWidth: 360 }} segStart={segStartFor(id)} nodeMin={nodeMinFor} />
              {hasCode(def) ? (
                <>
                  <Keys preview={preview} />
                  <p className="hint" style={{ margin: 0, textAlign: "center" }}>按住上面的按键或键盘 1–4，模拟设备 K1–K4</p>
                  <div className="scr-meter">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>程序体积</span><b>{fmtSize(size)} / {APP_MAX_BYTES / 1024} KB</b>
                    </div>
                    <div className="scr-bar"><i style={{ width: `${Math.min(100, (size / APP_MAX_BYTES) * 100)}%` }} /></div>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>设备上</span>
                      <b>{!known ? "未知" : app?.bad ? `已禁用 · ${fmtSize(app.size)}` : app ? `已安装 · ${fmtSize(app.size)}` : "未安装"}</b>
                    </div>
                  </div>
                </>
              ) : (
                <p className="hint" style={{ margin: 0, textAlign: "center" }}>这是设备当前的默认屏幕（字体为近似效果）</p>
              )}
            </div>

            <div className="scr-main">
              {!hasCode(def) ? (
                <div className="scr-empty">
                  <Tile color="violet" size={48}><LayoutTemplate /></Tile>
                  <b>「{statusMeta(id).label}」还在用默认屏幕</b>
                  <p>{app ? "设备上装过这个状态的程序，但本机没有源码——重新写一个会覆盖它。" : "默认屏幕是设备自带画面，不用装程序。"}想换花样：选一个模板开始改，或导入本地 .wasm。程序装进设备后，每次进入「{statusMeta(id).label}」都会自动运行，网页关掉也照常显示。</p>
                  <div className="scr-tpls">
                    {app ? (
                      <button type="button" className="scr-tpl scr-def" onClick={() => void restore()}>
                        <b>默认屏幕</b><span>设备自带画面 · 点此恢复</span>
                      </button>
                    ) : (
                      <div className="scr-tpl scr-def on cur">
                        <b>默认屏幕</b><span>设备自带画面 · 使用中</span>
                      </div>
                    )}
                    {WAT_TEMPLATES.map((t) => (
                      <button key={t.id} type="button" className="scr-tpl"
                        onClick={() => setDef({ kind: "wat", src: t.code, name: t.name, desc: t.desc })}>
                        <b>{t.name}</b><span>{t.desc}</span>
                      </button>
                    ))}
                    {s.settings.screenPresets.map((p) => (
                      <div key={p.id} className="scr-tpl scr-mine" role="button" tabIndex={0}
                        onClick={() => setDef({ kind: "wat", src: p.src, name: p.name, desc: p.desc })}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}>
                        <b>{p.name}</b><span>{p.desc || "我的屏幕块"}</span>
                        <button type="button" className="scr-tpl-del" title={`删除「${p.name}」`} aria-label={`删除「${p.name}」`}
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.updateSettings({ screenPresets: s.settings.screenPresets.filter((x) => x.id !== p.id) });
                          }}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {app && <Banner tone="info" icon={<Cpu className="i" />}>设备上已经装了这个状态的程序（{fmtSize(app.size)}），但本机没有源码。可以重新写一份覆盖，或点“恢复默认”删除它。</Banner>}
                </div>
              ) : def!.kind === "wasm" ? (
                <div className="code-box scr-file">
                  <div className="row" style={{ gap: 8 }}><HardDrive className="i" /><b>{def!.name || "screen.wasm"}</b><span className="hint">{fmtSize(size)} · 预编译二进制</span></div>
                  <p className="hint" style={{ margin: "8px 0 0" }}>导入的二进制不能在这里编辑。要改内容，请在本地修改后重新导入，或从模板加载 WAT 覆盖。</p>
                </div>
              ) : (
                <>
                  <div className="scr-meta">
                    <label className="scr-mn">名称<input className="input" value={def!.name ?? ""} maxLength={20} placeholder="例如：我的专注屏"
                      onChange={(e) => setDef({ ...def!, name: e.target.value })} /></label>
                    <label>简介<input className="input" value={def!.desc ?? ""} maxLength={40} placeholder="一句话说明这块屏幕显示什么（可选）"
                      onChange={(e) => setDef({ ...def!, desc: e.target.value })} /></label>
                  </div>
                  <p className="hint" style={{ margin: 0 }}>名称和简介会显示在选项卡上。写完代码点「保存」，这块屏幕会存成一张可复用的块，之后在任何状态的模板区都能选它。</p>
                  <textarea className="input scr-code" value={def!.src} spellCheck={false} aria-label="WAT 源码"
                    onChange={(e) => setDef({ ...def!, src: e.target.value })} />
                </>
              )}

              {error && <Banner tone="warn" icon={<TriangleAlert className="i" />}><b>预览没有跑通</b>{error}</Banner>}
              {appErr && (
                <Banner tone="warn" icon={<TriangleAlert className="i" />}>
                  <b>设备上运行出错，已回到默认屏幕</b>{appErr.msg} · {hhmm(appErr.at)}。修改后重新上传即可。
                </Banner>
              )}
              {app?.bad && (
                <Banner tone="warn" icon={<ShieldCheck className="i" />}>
                  <b>这个程序曾让设备重启，已被自动禁用</b>检查代码里有没有死循环或特别耗时的计算，修改后重新上传会自动解除禁用。
                </Banner>
              )}

              {uploading && (
                <div className="scr-meter">
                  <div className="row" style={{ justifyContent: "space-between" }}><span>正在写入设备</span><b>{Math.round(sent! * 100)}%</b></div>
                  <div className="scr-bar"><i style={{ width: `${sent! * 100}%` }} /></div>
                </div>
              )}

              {(hasCode(def) || app) && (
                <div className="row" style={{ gap: 8 }}>
                  {hasCode(def) && <button className="btn btn-primary btn-sm" disabled={!connected || uploading || !!error || !size} onClick={() => void upload()}><Upload />{app && !app.bad ? "更新设备上的程序" : "上传到设备"}</button>}
                  {hasCode(def) && <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => setNonce((n) => n + 1)}><Play />重新运行预览</button>}
                  {def?.kind === "wat" && hasCode(def) && <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={savePreset}><BookmarkPlus />保存</button>}
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} disabled={uploading} onClick={() => void restore()}><Eraser />恢复默认</button>
                </div>
              )}
              {hasCode(def) && (
                <p className="hint" style={{ margin: 0 }}>
                  {!connected ? "设备未连接：代码会保存在本机，连接后再上传。"
                    : dirty ? "预览里的版本还没装到设备上。"
                    : known ? "设备上的版本与预览一致。" : "上传后存进设备 flash，进入该状态自动运行。"}
                  {connected && id === s.current.id && " 设备当前就在这个状态，上传后立即生效。"}
                </p>
              )}
            </div>
          </div>

          <div className="scr-notes">
            <p className="hint" style={{ margin: 0 }}>
              不会写代码？点右上角「复制给 Agent」，把它和你想要的画面一起发给 Agent，让它写好代码贴回编辑器——上传前会先在这里完整跑一遍，确认没问题才写进设备。
            </p>
          </div>
        </Card>
      </div>
      {addOpen && (
        <AddStatusDialog
          onClose={() => setAddOpen(false)}
          onCreate={(d) => {
            actions.stdefSet(d);
            setAddOpen(false);
            select(d.id);
            toast({ message: `已创建状态「${d.zh}」并写入设备注册表`, seconds: 5 });
          }}
        />
      )}
    </>
  );
}
