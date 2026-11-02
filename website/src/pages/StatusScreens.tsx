import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Clapperboard, Eraser, FileCode2, Unplug, Upload, Wand2 } from "lucide-react";
import { ANIM_TEMPLATES } from "../domain/animTemplates";
import { clearAnim, drawFrameTo, runAnimation, sendAnim, type AnimResult } from "../device/anim";
import { getTransport, useStore } from "../store/AppStore";
import { STATUSES, STATUS_ORDER } from "../domain/statuses";
import type { StatusId } from "../domain/types";
import { Banner, Card, CardHeader, Segmented } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

const MONO: CSSProperties = { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontSize: 12.5, lineHeight: 1.65, minHeight: 240, resize: "vertical", whiteSpace: "pre", overflowWrap: "normal" };

/** 按状态自定义屏幕：为每个状态写一段 JS（display-app-spec.md），上传后设备进入该状态自动播放动画 */
export function StatusScreens() {
  const { s, device, actions } = useStore();
  const toast = useToast();
  const connected = device.state === "connected";
  const [id, setId] = useState<StatusId>("work");
  const code = s.settings.customScreens[id] ?? "";
  const [result, setResult] = useState<AnimResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "gen" | "up">("");
  const [sent, setSent] = useState(0);
  const [frame, setFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const setCode = (v: string) => actions.updateSettings({ customScreens: { ...s.settings.customScreens, [id]: v } });

  const generate = async (src: string) => {
    if (!src.trim()) { setError("先写代码或从模板加载一个"); return false; }
    setBusy("gen"); setError("");
    try {
      setResult(await runAnimation(src));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
      return false;
    } finally {
      setBusy("");
    }
  };

  const upload = async () => {
    const t = getTransport();
    if (!t) return;
    setBusy("up"); setError("");
    try {
      const r = result ?? (await runAnimation(code));
      setResult(r);
      setSent(0);
      await sendAnim(t, id, r, (i, n) => setSent(i / n));
      toast({ message: `已写入设备「${STATUSES[id].label}」屏幕：进入该状态即播放，断电不丢`, seconds: 8 });
    } catch (e) {
      toast({ message: `上传失败：${e instanceof Error ? e.message : e}`, seconds: 8 });
    } finally {
      setBusy("");
    }
  };

  const clear = async () => {
    const { [id]: _drop, ...rest } = s.settings.customScreens;
    actions.updateSettings({ customScreens: rest });
    setResult(null); setError("");
    const t = getTransport();
    if (t) await clearAnim(t, id).catch(() => {});
    toast({ message: `「${STATUSES[id].label}」已恢复默认屏幕`, seconds: 6 });
  };

  // 预览循环：和上传到设备的是同一份 1bpp 帧数据
  useEffect(() => { setResult(null); setError(""); }, [id]);
  useEffect(() => {
    if (!result) return;
    setFrame(0);
    const timer = setInterval(() => setFrame((f) => (result.loop ? (f + 1) % result.frames.length : Math.min(f + 1, result.frames.length - 1))), 1000 / result.fps);
    return () => clearInterval(timer);
  }, [result]);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && result && result.frames.length) drawFrameTo(ctx, result.frames[frame % result.frames.length]);
  }, [frame, result]);

  const customCount = STATUS_ORDER.filter((x) => s.settings.customScreens[x]?.trim()).length;
  return (
    <Card>
      <CardHeader title="按状态自定义屏幕" count={customCount || undefined} icon={<FileCode2 style={{ width: 18, height: 18, color: "var(--ink-2)" }} />}
        extra={
          <select className="input input-sm" value="" onChange={(e) => { const t = ANIM_TEMPLATES.find((x) => x.id === e.target.value); if (t) { setCode(t.code); void generate(t.code); } e.target.value = ""; }} aria-label="从模板加载">
            <option value="">从模板加载…</option>
            {ANIM_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>} />
      <div className="card-b form">
        <Segmented value={id} options={STATUS_ORDER.map((x) => ({ value: x, label: STATUSES[x].label + (s.settings.customScreens[x]?.trim() ? " ✦" : "") }))} onChange={setId} />
        {!code.trim() && !result && (
          <p className="hint" style={{ margin: 0 }}>「{STATUSES[id].label}」还没自定义屏幕，用的是默认显示。右上角选一个模板开始，或粘贴 Agent 按 <code>doc/display-app-spec.md</code> 生成的代码。</p>
        )}
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
          <div className="oled" style={{ width: "100%", maxWidth: 320, display: "block", padding: 0, overflow: "hidden" }}>
            {result
              ? <canvas ref={canvasRef} width={128} height={64} style={{ display: "block", width: "100%", height: "auto", imageRendering: "pixelated" }} />
              : <div style={{ padding: "22px 16px", textAlign: "center", color: "#9fb4d8", fontSize: 13 }}>生成预览后显示「{STATUSES[id].label}」的屏幕效果</div>}
          </div>
        </div>
        <textarea className="input" style={MONO} value={code} spellCheck={false} placeholder={`为「${STATUSES[id].label}」写一段动效代码…`} onChange={(e) => setCode(e.target.value)} />
        {error && <Banner tone="warn">代码没有跑通：{error}</Banner>}
        {busy === "up" && (
          <div className="hint" style={{ margin: 0 }}>正在写入设备 {Math.round(sent * 100)}%…
            <div style={{ height: 4, borderRadius: 4, background: "var(--line)", marginTop: 6 }}><div style={{ height: "100%", width: `${sent * 100}%`, borderRadius: 4, background: "var(--primary)", transition: "width .15s" }} /></div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" disabled={!code.trim() || busy !== ""} onClick={() => void generate(code)}><Clapperboard />{busy === "gen" ? "生成中…" : "生成预览"}</button>
          <button className="btn btn-primary btn-sm" disabled={!connected || !code.trim() || busy !== ""} onClick={() => void upload()}><Upload />上传到设备</button>
          <button className="btn btn-ghost btn-sm" disabled={!code.trim() && !s.settings.customScreens[id]} onClick={() => void clear()}><Eraser />恢复默认</button>
        </div>
        <p className="hint" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {!connected && <><Unplug className="i" style={{ width: 13, height: 13 }} />设备未连接：代码可以先写好，连接后再上传。</>}
          {connected && <>上传后存进设备 flash：进入「{STATUSES[id].label}」自动播放，断连和重启都在。任意按键或状态切换退出。</>}
        </p>
        <p className="hint" style={{ margin: 0 }}><Wand2 className="i" style={{ width: 13, height: 13, verticalAlign: -2 }} /> 想让 Agent 写新动效：把 <code>doc/display-app-spec.md</code> 和想要的图发给它，代码贴回来即可。</p>
      </div>
    </Card>
  );
}
