import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Code2, Copy, Eraser, FileUp, Image, LayoutTemplate, Play, ShieldCheck, Upload, Cpu, TriangleAlert, RotateCcw, Moon, BellRing, HardDrive } from "lucide-react";
import { HOST_API, WAT_TEMPLATES } from "../domain/watTemplates";
import { APP_H, APP_MAX_BYTES, APP_W, clearApp, deployedHashes, drawDefaultScreen, hashBytes, previewScreen, screenBytes, sendApp, setDeployedHash, u8ToB64, type DefaultScreen, type ScreenPreview } from "../device/app";
import { getTransport, toOutbound, useStore } from "../store/AppStore";
import { STATUSES, STATUS_ORDER } from "../domain/statuses";
import type { DeviceApp, ScreenDef, ScreenLayout, StatusId } from "../domain/types";
import { hhmm } from "../domain/time";
import { Banner, Card, CardHeader, RowItem, Segmented, StatusChip, Tile } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

const LAYOUTS: { value: ScreenLayout; label: string }[] = [
  { value: "full", label: "状态 + 时间 + 说明" },
  { value: "clock", label: "状态 + 时间" },
  { value: "status", label: "仅状态" },
];

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
function OledCanvas({ def, status, screen, keyboard, nonce = 0, onReady, onError, style }: {
  def?: ScreenDef; status: StatusId; screen: DefaultScreen; keyboard?: boolean; nonce?: number;
  onReady?: (p: ScreenPreview | null) => void; onError?: (msg: string) => void; style?: CSSProperties;
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
        p = await previewScreen(bytes, ref.current, { status: STATUS_ORDER.indexOf(status), keyboard, onError });
        if (!alive) { p.stop(); return; }
        onError?.("");
        onReady?.(p);
      } catch (e) {
        if (alive) { onError?.(e instanceof Error ? e.message : String(e)); onReady?.(null); }
      }
    }, keyboard ? 450 : 0); // 编辑器里边写边预览：停手 450ms 再编译
    return () => { alive = false; clearTimeout(t); p?.stop(); onReady?.(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, running, status, keyboard, nonce]);
  useEffect(() => {
    if (!running && ref.current) drawDefaultScreen(ref.current, screen);
  }, [running, screen.main, screen.sub, screen.clock, screen.connected, screen.layout]);
  return (
    <div className="scr-oled" style={style}>
      <canvas ref={ref} width={APP_W} height={APP_H} />
    </div>
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
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const screenFor = (x: StatusId): DefaultScreen => ({
    main: STATUSES[x].screen,
    sub: x === s.current.id ? toOutbound(s).sub : STATUSES[x].hint,
    clock: hhmm(now),
    connected: connected && device.kind === "ble",
    layout: s.settings.screenLayout,
  });

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
    const t = getTransport();
    if (!t || !def) return;
    setSent(0);
    try {
      const bytes = await screenBytes(def);
      await sendApp(t, id, bytes, setSent);
      setDeployedHash(id, hashBytes(bytes)); setDeployed(deployedHashes());
      toast({ message: `已写入设备「${STATUSES[id].label}」屏幕：进入该状态自动运行，断电不丢`, seconds: 8 });
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
    const t = getTransport();
    if (t && connected) { await clearApp(t, id).catch(() => {}); setDeployedHash(id); setDeployed(deployedHashes()); }
    toast({ message: `「${STATUSES[id].label}」已恢复默认屏幕${connected ? "" : "；设备上的程序会在下次连接后再清除"}`, seconds: 6 });
  };

  const copyForAgent = async () => {
    const text = [
      "请为「收工牌」桌牌写一个自定义屏幕程序，输出 WebAssembly 文本格式（WAT）。",
      "屏幕：128×64 单色 OLED，坐标原点左上角。程序必须导出 run()，设备约每 33ms 调用一次（~30fps）。",
      "每帧先 clear()，画完再 show()。线性内存 1 页即可，二进制不超过 48 KB。",
      "可用宿主函数（全部从 \"env\" 导入，参数/返回值均为 i32）：",
      ...HOST_API.map((a) => `- ${a.sig}：${a.desc}`),
      "约束：只能画 ASCII 文本；不要死循环（run 必须很快返回）；避免长时间全屏常亮以减少烧屏。",
    ].join("\n");
    await navigator.clipboard.writeText(text).then(() => toast({ message: "已复制给 Agent 的说明，粘贴给它即可" }), () => toast({ message: "复制失败，请手动查看 doc/display-app-spec.md" }));
  };

  const customCount = STATUS_ORDER.filter((x) => hasCode(s.settings.customScreens[x]) || (known && device.apps?.[x])).length;
  const appErr = device.appErr && device.appErr.status === id ? device.appErr : undefined;
  const uploading = sent !== null;
  // 设备只报大小：大小不同必然没装；大小相同再比本机记录的上传指纹（没有记录则按大小判断）
  const dirty = hasCode(def) && known && (!app || app.bad || app.size !== size || (!!deployed[id] && deployed[id] !== hash));
  const src = sourceOf(def, app, known, dirty);

  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <CardHeader icon={<Tile color="violet" size={30}><Image /></Tile>} title="各状态屏幕" count={customCount || undefined}
          extra={<Segmented value={s.settings.screenLayout} options={LAYOUTS} onChange={(v) => actions.updateSettings({ screenLayout: v })} />} />
        <div className="card-b">
          <div className="scr-grid">
            {STATUS_ORDER.map((x) => {
              const d = s.settings.customScreens[x];
              const a = known ? device.apps?.[x] : undefined;
              const so = x === id ? src : sourceOf(d, a, known); // 选中项用编辑器里带指纹比对的结果，保持两处一致
              return (
                <button key={x} type="button" className={`scr-cell ${x === id ? "on" : ""}`} onClick={() => select(x)} aria-pressed={x === id}>
                  {a && !hasCode(d) ? (
                    <div className="scr-oled scr-unknown"><Cpu /><span>设备上的自定义程序</span></div>
                  ) : (
                    <OledCanvas def={a?.bad ? undefined : d} status={x} screen={screenFor(x)} />
                  )}
                  <div className="scr-cap">
                    <StatusChip id={x} />
                    {x === s.current.id && <span className="badge b-new">当前</span>}
                  </div>
                  <span className={TONE_CLASS[so.tone]}>{so.label}</span>
                </button>
              );
            })}
          </div>
          <p className="hint" style={{ margin: "16px 0 0" }}>
            布局只影响默认屏幕，会存进设备。自定义屏幕的画面完全由程序决定；待办提醒和休息提醒会临时盖住任何屏幕。
            {!connected && " 设备未连接：标记是本机记录，连接后以设备上报为准。"}
            {connected && device.apps === undefined && " 设备没有上报安装清单，固件需要升级到 0.5 以上才能核对。"}
          </p>
        </div>
      </Card>

      <div ref={editorRef} style={{ scrollMarginTop: 20 }}>
        <Card style={{ marginBottom: 20 }}>
          <CardHeader icon={<Tile color="blue" size={30}><Code2 /></Tile>} title={<>编辑屏幕 · {STATUSES[id].label}</>}
            extra={<>
              <span className={TONE_CLASS[src.tone]}>{src.label}</span>
              <select className="input input-sm" value="" aria-label="从模板加载"
                onChange={(e) => { const t = WAT_TEMPLATES.find((x) => x.id === e.target.value); if (t) setDef({ kind: "wat", src: t.code }); e.target.value = ""; }}>
                <option value="">从模板加载…</option>
                {WAT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><FileUp />导入 .wasm</button>
              <input ref={fileRef} type="file" accept=".wasm" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }} />
            </>} />
          <div className="card-b scr-edit">
            <div className="scr-side">
              <OledCanvas def={def} status={id} screen={screenFor(id)} keyboard nonce={nonce} onReady={setPreview} onError={setError} style={{ maxWidth: 360 }} />
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
                  <b>「{STATUSES[id].label}」还在用默认屏幕</b>
                  <p>选一个模板开始改，或导入本地编译好的 .wasm。程序装进设备后，每次进入「{STATUSES[id].label}」都会自动运行，网页关掉也照常显示。</p>
                  <div className="scr-tpls">
                    {WAT_TEMPLATES.map((t) => (
                      <button key={t.id} type="button" className="scr-tpl" onClick={() => setDef({ kind: "wat", src: t.code })}>
                        <b>{t.name}</b><span>{t.desc}</span>
                      </button>
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
                <textarea className="input scr-code" value={def!.src} spellCheck={false} aria-label="WAT 源码"
                  onChange={(e) => setDef({ kind: "wat", src: e.target.value })} />
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
        </Card>
      </div>

      <div className="grid g-cards">
        <Card>
          <CardHeader icon={<Tile color="blue" size={30}><Code2 /></Tile>} title="宿主 API 速查"
            extra={<button className="btn btn-secondary btn-sm" onClick={() => void copyForAgent()}><Copy />复制给 Agent</button>} />
          <div className="card-b" style={{ paddingTop: 8 }}>
            <table className="scr-api">
              <tbody>
                {HOST_API.map((a) => <tr key={a.sig}><td><code>{a.sig}</code></td><td>{a.desc}</td></tr>)}
              </tbody>
            </table>
            <p className="hint" style={{ margin: "12px 0 0" }}>程序导出 <code>run()</code>，设备约每 33ms 调用一次。完整规范见 <code>doc/display-app-spec.md</code>；用 C 写的话本地编译成 .wasm 再导入。</p>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Tile color="teal" size={30}><ShieldCheck /></Tile>} title="在设备上怎么运行" />
          <RowItem lead={<Tile color="violet"><HardDrive /></Tile>} title="存在设备里，离线照常运行" desc={`每个状态一个程序，最大 ${APP_MAX_BYTES / 1024} KB，断电重启不丢`} />
          <RowItem lead={<Tile color="orange"><RotateCcw /></Tile>} title="出错自动回默认屏" desc="越界、除零等错误会停掉程序，网页会收到提示" />
          <RowItem lead={<Tile color="orange"><TriangleAlert /></Tile>} title="卡死会被自动禁用" desc="程序让设备重启后不会再加载，重新上传即可恢复" />
          <RowItem lead={<Tile color="green"><BellRing /></Tile>} title="提醒优先" desc="待办和休息提醒临时盖住屏幕，按任意键关闭" />
          <RowItem lead={<Tile color="teal"><Moon /></Tile>} title="留意烧屏" desc="OLED 长时间显示同一画面会老化，画面最好有移动或多留黑" />
        </Card>
      </div>
    </>
  );
}
