import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, CirclePlay, Clapperboard, FileCode2, Film, StopCircle, Unplug, Upload, Wand2 } from "lucide-react";
import { ANIM_TEMPLATES } from "../domain/animTemplates";
import { drawFrameTo, runAnimation, sendAnim, stopAnim, type AnimResult } from "../device/anim";
import { getTransport, useStore } from "../store/AppStore";
import { Banner, Card, CardHeader, PageHeader, RowItem, Tile } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

const MONO: CSSProperties = { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontSize: 12.5, lineHeight: 1.65, minHeight: 300, resize: "vertical", whiteSpace: "pre", overflowWrap: "normal" };

export function EffectsPage() {
  const { device } = useStore();
  const toast = useToast();
  const connected = device.state === "connected";
  const [tplId, setTplId] = useState(ANIM_TEMPLATES[0].id);
  const [code, setCode] = useState(ANIM_TEMPLATES[0].code);
  const [result, setResult] = useState<AnimResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "gen" | "up">("");
  const [sent, setSent] = useState(0);
  const [frame, setFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generate = async (src: string) => {
    setBusy("gen"); setError(""); setResult(null);
    try {
      setResult(await runAnimation(src));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const pick = (id: string) => {
    const t = ANIM_TEMPLATES.find((x) => x.id === id)!;
    setTplId(id);
    setCode(t.code);
    void generate(t.code);
  };
  // 模板加载时自动生成一次预览
  useEffect(() => { void generate(code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // 预览循环：按 result.fps 逐帧画到 canvas（与设备同一份 1bpp 数据，所见即所得）
  useEffect(() => {
    if (!result) return;
    setFrame(0);
    const id = setInterval(() => setFrame((f) => (result.loop ? (f + 1) % result.frames.length : Math.min(f + 1, result.frames.length - 1))), 1000 / result.fps);
    return () => clearInterval(id);
  }, [result]);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && result && result.frames.length)
      drawFrameTo(ctx, result.frames[frame % result.frames.length]);
  }, [frame, result]);

  const upload = async () => {
    const t = getTransport();
    if (!t || !result) return;
    setBusy("up"); setSent(0);
    try {
      await sendAnim(t, result, (i, n) => setSent(i / n));
      toast({ message: `已上传，设备正在播放「${result.name || "自定义动效"}」`, seconds: 6 });
    } catch (e) {
      toast({ message: `上传失败：${e instanceof Error ? e.message : e}`, seconds: 8 });
    } finally {
      setBusy("");
    }
  };
  const stop = async () => {
    const t = getTransport();
    if (!t) return;
    await stopAnim(t).catch(() => {});
    toast({ message: "已停止播放，设备回到状态显示", seconds: 5 });
  };

  return (
    <>
      <PageHeader title="动效" desc="把一段 JS 转成桌牌屏幕上的像素动画：选模板直接上传，或把规范文档发给 Agent 生成新代码。" />
      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader title="模板库" icon={<Tile color="violet" size={30}><Film /></Tile>} />
            {ANIM_TEMPLATES.map((t) => (
              <RowItem key={t.id} onClick={() => pick(t.id)}
                lead={<Tile color={t.id === "custom" ? "orange" : "violet"}>{t.id === "custom" ? <FileCode2 /> : <Wand2 />}</Tile>}
                title={t.name} desc={t.desc}
                meta={t.id === tplId ? <Check style={{ color: "var(--primary)" }} /> : undefined} />
            ))}
          </Card>
          <Card>
            <CardHeader title="让 Agent 写新动效" icon={<Tile color="teal" size={30}><CirclePlay /></Tile>} />
            <div className="card-b form">
              <p className="hint" style={{ margin: 0 }}>1. 把 <code>doc/display-app-spec.md</code> 的内容发给 Agent</p>
              <p className="hint" style={{ margin: 0 }}>2. 附上想要的图案或描述（128×64 单色像素屏）</p>
              <p className="hint" style={{ margin: 0 }}>3. 生成的代码粘贴到右侧编辑器，点「重新生成预览」，满意后上传</p>
              <p className="hint" style={{ margin: 0 }}>代码只在本机浏览器里求值出帧数据，设备不执行代码、只当播放器——写错了最多预览报错，弄不坏设备。</p>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="设备上的样子" count={result ? result.frames.length : undefined}
              extra={result && <span className="hint" style={{ margin: 0 }}>{result.fps} fps · {result.loop ? "循环" : "单次"}</span>} />
            <div className="card-b" style={{ display: "grid", placeItems: "center", paddingTop: 18, paddingBottom: 18 }}>
              <div className="oled" style={{ width: "100%", maxWidth: 340, display: "block", padding: 0, overflow: "hidden" }}>
                <canvas ref={canvasRef} width={128} height={64} style={{ display: "block", width: "100%", height: "auto", imageRendering: "pixelated" }} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title={`代码 · ${ANIM_TEMPLATES.find((t) => t.id === tplId)?.name ?? ""}`}
              extra={<button className="btn btn-secondary btn-sm" disabled={busy === "gen"} onClick={() => void generate(code)}><Clapperboard />{busy === "gen" ? "生成中…" : "重新生成预览"}</button>} />
            <div className="card-b">
              <textarea className="input" style={MONO} value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} />
              {error && <Banner tone="warn">代码没有跑通：{error}</Banner>}
            </div>
          </Card>

          <Card>
            <CardHeader title="上传到设备" icon={<Tile color="blue" size={30}><Upload /></Tile>} />
            <div className="card-b form">
              {!connected && <p className="hint" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 4 }}><Unplug className="i" style={{ width: 13, height: 13 }} />设备未连接：连接后才能上传播放。</p>}
              {busy === "up" && (
                <div className="hint" style={{ margin: 0 }}>正在上传帧数据 {Math.round(sent * 100)}%…
                  <div style={{ height: 4, borderRadius: 4, background: "var(--line)", marginTop: 6 }}><div style={{ height: "100%", width: `${sent * 100}%`, borderRadius: 4, background: "var(--primary)", transition: "width .15s" }} /></div>
                </div>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary" disabled={!connected || !result || busy !== ""} onClick={() => void upload()}><Upload />上传并播放</button>
                <button className="btn btn-ghost" disabled={!connected} onClick={() => void stop()}><StopCircle />停止播放</button>
              </div>
              <p className="hint" style={{ margin: 0 }}>设备上任意按键退出播放回到状态显示；帧存在设备内存里，断电后需要重新上传。提醒和休息通知会临时盖住动画。</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
