import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Clapperboard, Eraser, FileCode2, FileUp, Unplug, Upload, Wand2 } from "lucide-react";
import { WAT_TEMPLATES } from "../domain/watTemplates";
import { APP_H, APP_MAX_BYTES, APP_W, b64ToU8, clearApp, compileWat, previewScreen, sendApp, u8ToB64, type ScreenPreview } from "../device/app";
import { getTransport, useStore } from "../store/AppStore";
import { STATUSES, STATUS_ORDER } from "../domain/statuses";
import type { ScreenDef, StatusId } from "../domain/types";
import { Banner, Card, CardHeader, Segmented } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

const MONO: CSSProperties = { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", fontSize: 12.5, lineHeight: 1.65, minHeight: 240, resize: "vertical", whiteSpace: "pre", overflowWrap: "normal" };

/** 按状态自定义屏幕：为每个状态写一段 WAT（或上传 .wasm），设备 wasm3 在该状态下沙箱执行 */
export function StatusScreens() {
  const { s, device, actions } = useStore();
  const toast = useToast();
  const connected = device.state === "connected";
  const [id, setId] = useState<StatusId>("work");
  const def: ScreenDef | undefined = s.settings.customScreens[id];
  const code = def?.kind === "wat" ? def.src : "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "gen" | "up">("");
  const [sent, setSent] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<ScreenPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setDef = (d: ScreenDef | undefined) => {
    const { [id]: _drop, ...rest } = s.settings.customScreens;
    actions.updateSettings({ customScreens: d ? { ...rest, [id]: d } : rest });
  };

  const stopPreview = () => { previewRef.current?.stop(); previewRef.current = null; };

  /** 编译（如需）并返回 wasm 字节；d 缺省用当前 def（模板/文件加载时显式传入避免闭包拿旧值） */
  const makeBytes = async (d?: ScreenDef): Promise<Uint8Array> => {
    const src = d ?? def;
    if (src?.kind === "wasm") return b64ToU8(src.b64);
    if (src?.kind === "wat" && src.src.trim()) return compileWat(src.src);
    throw new Error("先写 WAT 代码、从模板加载，或上传 .wasm 文件");
  };

  const generate = async (d?: ScreenDef) => {
    setBusy("gen"); setError("");
    try {
      const bytes = await makeBytes(d);
      const cv = canvasRef.current;
      if (!cv) return false;
      stopPreview();
      previewRef.current = await previewScreen(bytes, cv, (msg) => setError(`运行出错（wasm trap）：${msg}`));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      const bytes = await makeBytes();
      setSent(0);
      await sendApp(t, id, bytes, setSent);
      toast({ message: `已写入设备「${STATUSES[id].label}」屏幕：进入该状态自动执行，断电不丢`, seconds: 8 });
    } catch (e) {
      toast({ message: `上传失败：${e instanceof Error ? e.message : e}`, seconds: 8 });
    } finally {
      setBusy("");
    }
  };

  const pickFile = async (f: File) => {
    if (f.size > APP_MAX_BYTES) { setError(`文件超过 ${APP_MAX_BYTES / 1024}KB 上限`); return; }
    const d: ScreenDef = { kind: "wasm", b64: u8ToB64(new Uint8Array(await f.arrayBuffer())), name: f.name };
    setDef(d);
    setError("");
    await generate(d);
  };

  const clear = async () => {
    setDef(undefined);
    stopPreview(); setError("");
    const t = getTransport();
    if (t) await clearApp(t, id).catch(() => {});
    toast({ message: `「${STATUSES[id].label}」已恢复默认屏幕`, seconds: 6 });
  };

  // 切状态/卸载时停掉预览
  useEffect(() => () => stopPreview(), []);
  useEffect(() => { stopPreview(); setError(""); }, [id]);

  const customCount = STATUS_ORDER.filter((x) => s.settings.customScreens[x]).length;
  const hasDef = !!def && (def.kind === "wasm" || !!def.src.trim());
  return (
    <Card>
      <CardHeader title="按状态自定义屏幕" count={customCount || undefined} icon={<FileCode2 style={{ width: 18, height: 18, color: "var(--ink-2)" }} />}
        extra={
          <select className="input input-sm" value="" onChange={(e) => { const t = WAT_TEMPLATES.find((x) => x.id === e.target.value); if (t) { const d: ScreenDef = { kind: "wat", src: t.code }; setDef(d); void generate(d); } e.target.value = ""; }} aria-label="从模板加载">
            <option value="">从模板加载…</option>
            {WAT_TEMPLATES.map((t) => <option key={t.id} value={t.id} title={t.desc}>{t.name}</option>)}
          </select>} />
      <div className="card-b form">
        <Segmented value={id} options={STATUS_ORDER.map((x) => ({ value: x, label: STATUSES[x].label + (s.settings.customScreens[x] ? " ✦" : "") }))} onChange={setId} />
        {!hasDef && (
          <p className="hint" style={{ margin: 0 }}>「{STATUSES[id].label}」还没自定义屏幕，用的是默认显示。右上角选一个模板开始，粘贴 Agent 按 <code>doc/display-app-spec.md</code> 写的 WAT，或上传本地编译的 .wasm。</p>
        )}
        {def?.kind === "wasm" && (
          <p className="hint" style={{ margin: 0 }}>已上传编译好的 app：<code>{def.name || "screen.wasm"}</code>（{Math.round(b64ToU8(def.b64).length / 102.4) / 10}KB）。想改代码请粘贴 WAT 源码覆盖。</p>
        )}
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
          <div className="oled" style={{ width: "100%", maxWidth: 320, display: "block", padding: 0, overflow: "hidden" }}>
            <canvas ref={canvasRef} width={APP_W} height={APP_H} style={{ display: "block", width: "100%", height: "auto", imageRendering: "pixelated" }} />
          </div>
        </div>
        <textarea className="input" style={MONO} value={code} spellCheck={false} placeholder={`为「${STATUSES[id].label}」写一段 WAT 屏幕程序…`} onChange={(e) => setDef({ kind: "wat", src: e.target.value })} />
        {error && <Banner tone="warn">代码没有跑通：{error}</Banner>}
        {busy === "up" && (
          <div className="hint" style={{ margin: 0 }}>正在写入设备 {Math.round(sent * 100)}%…
            <div style={{ height: 4, borderRadius: 4, background: "var(--line)", marginTop: 6 }}><div style={{ height: "100%", width: `${sent * 100}%`, borderRadius: 4, background: "var(--primary)", transition: "width .15s" }} /></div>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" disabled={!hasDef || busy !== ""} onClick={() => void generate()}><Clapperboard />{busy === "gen" ? "运行中…" : "生成预览"}</button>
          <button className="btn btn-primary btn-sm" disabled={!connected || !hasDef || busy !== ""} onClick={() => void upload()}><Upload />上传到设备</button>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><FileUp />上传 .wasm</button>
          <input ref={fileRef} type="file" accept=".wasm" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }} />
          <button className="btn btn-ghost btn-sm" disabled={!hasDef} onClick={() => void clear()}><Eraser />恢复默认</button>
        </div>
        <p className="hint" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {!connected && <><Unplug className="i" style={{ width: 13, height: 13 }} />设备未连接：代码可以先写好，连接后再上传。</>}
          {connected && <>上传后存进设备 flash：进入「{STATUSES[id].label}」由 wasm3 沙箱执行，断连和重启都在。预览里按数字键 1-4 可模拟 K1-K4。</>}
        </p>
        <p className="hint" style={{ margin: 0 }}><Wand2 className="i" style={{ width: 13, height: 13, verticalAlign: -2 }} /> 想让 Agent 写新屏幕：把 <code>doc/display-app-spec.md</code> 发给它；产物可以是 WAT（直接贴）或 .wasm（点"上传 .wasm"）。</p>
      </div>
    </Card>
  );
}
