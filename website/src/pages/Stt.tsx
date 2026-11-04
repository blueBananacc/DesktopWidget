import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AudioLines, Bluetooth, ClipboardCopy, KeySquare, Mic, Play, Radio, Sparkles, Square, Usb } from "lucide-react";
import { useStore } from "../store/AppStore";
import { useToast } from "../ui/Toast";
import { Banner, Card, CardHeader, PageHeader, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { adpcmFrameToPcm, b64ToU8, pcmToWav } from "../device/audio";
import { LLM_PROVIDERS, LLM_KEY_URLS, loadLlmCfg, saveLlmCfg, callLlm, llmPresetOf, llmEndpointOf, llmModelOf, llmErrText, type LlmCfg } from "../device/llm";

/** OpenAI 兼容的 /audio/transcriptions 端点；key 仅存浏览器 localStorage，不进仓库 */
const PROVIDERS = [
  { id: "siliconflow", name: "硅基流动（国内可达）", endpoint: "https://api.siliconflow.cn/v1/audio/transcriptions", model: "FunAudioLLM/SenseVoiceSmall" },
  { id: "openai", name: "OpenAI Whisper", endpoint: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
  { id: "groq", name: "Groq Whisper", endpoint: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
  { id: "custom", name: "自定义端点", endpoint: "", model: "" },
] as const;

/** 各服务商申请 API Key 的控制台直达链接 */
const KEY_URLS: Record<string, string> = {
  siliconflow: "https://cloud.siliconflow.cn/account/ak",
  openai: "https://platform.openai.com/api-keys",
  groq: "https://console.groq.com/keys",
};

interface AsrCfg { provider: string; endpoint: string; model: string; key: string }
const CFG_KEY = "stt-asr-cfg";
const loadCfg = (): AsrCfg => {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || "{}");
    return { provider: c.provider || "siliconflow", endpoint: c.endpoint || "", model: c.model || "", key: c.key || "" };
  } catch { return { provider: "siliconflow", endpoint: "", model: "", key: "" }; }
};

type Phase = "idle" | "recording" | "transcribing" | "done" | "error";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 生成 ~0.8s 的 440Hz 测试音（16kHz WAV），给"测试连接"走真实转写链路用 */
const testWav = () => {
  const n = 12800;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 800, (n - i) / 800);
    pcm[i] = Math.round(8000 * fade * Math.sin((2 * Math.PI * 440 * i) / 16000));
  }
  return pcmToWav([pcm], 16000);
};

export function SttPage() {
  const { s, device, transport, onDeviceMessage } = useStore();
  const toast = useToast();
  const [cfg, setCfg] = useState<AsrCfg>(loadCfg);
  const [llm, setLlm] = useState<LlmCfg>(loadLlmCfg);
  const [handoff, setHandoff] = useState(() => localStorage.getItem("stt-agent-handoff") !== "0");
  const [llmTest, setLlmTest] = useState<{ st: "idle" | "testing" | "ok" | "fail"; msg: string }>({ st: "idle", msg: "" });
  const [llmOut, setLlmOut] = useState<{ st: "idle" | "running" | "ok" | "fail"; text: string }>({ st: "idle", text: "" });
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [test, setTest] = useState<{ st: "idle" | "testing" | "ok" | "fail"; msg: string }>({ st: "idle", msg: "" });
  const [stats, setStats] = useState({ frames: 0, lost: 0, ms: 0 });
  const [audioUrl, setAudioUrl] = useState("");
  const audioUrlRef = useRef("");
  const partsRef = useRef<Int16Array[]>([]);
  const seqRef = useRef(-1);
  const lostRef = useRef(0);
  const rateRef = useRef(16000);
  const recordingRef = useRef(false);
  const timerRef = useRef<number>(0);
  const startAtRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const preset = PROVIDERS.find((p) => p.id === cfg.provider) ?? PROVIDERS[0];
  const endpoint = cfg.provider === "custom" ? cfg.endpoint : preset.endpoint;
  const model = cfg.provider === "custom" ? cfg.model : preset.model;
  const llmPreset = llmPresetOf(llm);
  const llmEndpoint = llmEndpointOf(llm);
  const llmModel = llmModelOf(llm);
  const connected = device.state === "connected";

  const saveCfg = (patch: Partial<AsrCfg>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    localStorage.setItem(CFG_KEY, JSON.stringify(next));
    setTest({ st: "idle", msg: "" });      // 配置变了，旧的测试结果作废
  };

  /** 统一走 OpenAI 兼容 /audio/transcriptions；测试按钮和正式识别共用 */
  const callAsr = async (wav: Blob) => {
    const form = new FormData();
    form.append("file", wav, "audio.wav");
    form.append("model", model);
    const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${cfg.key}` }, body: form });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${j.error?.message || j.message || res.statusText}`);
    return j;
  };

  const testKey = async () => {
    setTest({ st: "testing", msg: "正在发 1 秒测试音…" });
    try {
      const j = await callAsr(testWav());
      const t = typeof j.text === "string" ? j.text.trim() : "";
      setTest({ st: "ok", msg: `连通正常，Key 有效${t ? `——测试音返回：「${t}」` : ""}` });
    } catch (e) {
      setTest({ st: "fail", msg: llmErrText(e) });
    }
  };

  const saveLlm = (patch: Partial<LlmCfg>) => {
    const next = { ...llm, ...patch };
    setLlm(next);
    saveLlmCfg(next);
    setLlmTest({ st: "idle", msg: "" });
  };

  const testLlm = async () => {
    setLlmTest({ st: "testing", msg: "正在发测试消息…" });
    try {
      const j = await callLlm(llm, [{ role: "user", content: "只回复两个字：正常" }], { maxTokens: 16 });
      const t = String(j.choices?.[0]?.message?.content ?? "").trim();
      setLlmTest({ st: "ok", msg: `连通正常，Key 有效${t ? `——模型回复：「${t}」` : ""}` });
    } catch (e) {
      setLlmTest({ st: "fail", msg: llmErrText(e) });
    }
  };

  /** 把转写文本交给 LLM 整理 + 提取意图（提醒/待办/日程） */
  const runLlm = async () => {
    if (!text.trim()) { toast({ message: "先录一段并完成识别", seconds: 4 }); return; }
    if (!llmEndpoint || !llm.key) { toast({ message: "先在右侧配置 LLM 服务商和 Key", seconds: 5 }); return; }
    setLlmOut({ st: "running", text: "" });
    try {
      const j = await callLlm(llm, [
        { role: "system", content: "你是桌面状态牌「收工牌」上的语音助手。把用户的语音转写整理成通顺简洁的中文；若其中有提醒、待办、日程或状态切换意图，另起一行用「意图：」开头，一句话点明（含能推断出的时间）。不要解释，不要寒暄。" },
        { role: "user", content: text },
      ], { maxTokens: 400 });
      setLlmOut({ st: "ok", text: String(j.choices?.[0]?.message?.content ?? "").trim() || "（模型返回为空）" });
    } catch (e) {
      setLlmOut({ st: "fail", text: `LLM 调用失败：${e instanceof Error ? e.message : e}` });
    }
  };

  // 订阅设备消息：aud 帧边到边解码，sttState 更新进度
  useEffect(() => {
    return onDeviceMessage((m) => {
      if (m.type === "aud" && recordingRef.current) {
        const frame = b64ToU8(m.data);
        partsRef.current.push(adpcmFrameToPcm(frame));
        if (seqRef.current >= 0 && m.seq !== seqRef.current + 1) lostRef.current += Math.max(0, m.seq - seqRef.current - 1);
        seqRef.current = m.seq;
        if (partsRef.current.length % 20 === 0) setStats((s) => ({ ...s, frames: partsRef.current.length, lost: lostRef.current }));
      } else if (m.type === "sttState") {
        rateRef.current = m.rate || 16000;
        setStats((s) => ({ ...s, ms: m.ms }));
        if (m.state === "error" && phaseRef.current === "recording") {
          recordingRef.current = false;
          setPhase("error");
          setErr(m.msg || "设备录音出错");
        }
      }
    });
  }, [onDeviceMessage]);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const start = async () => {
    if (!transport || !connected) { toast({ message: "先连接设备", seconds: 4 }); return; }
    partsRef.current = []; seqRef.current = -1; lostRef.current = 0;
    setStats({ frames: 0, lost: 0, ms: 0 });
    setErr(""); setText(""); setAudioUrl("");
    try {
      await transport.send({ type: "stt", op: "start" });
    } catch (e) {
      toast({ message: `发送失败：${e instanceof Error ? e.message : e}`, seconds: 5 });
      return;
    }
    recordingRef.current = true;
    startAtRef.current = Date.now();
    setPhase("recording");
    window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setStats((s) => ({ ...s, ms: Date.now() - startAtRef.current })), 200);
  };

  const stop = async () => {
    recordingRef.current = false;
    window.clearInterval(timerRef.current);
    try { await transport?.send({ type: "stt", op: "stop" }); } catch { /* 断开也能本地收尾 */ }
    await delay(350);                          // 等在途的音频帧
    const parts = partsRef.current;
    partsRef.current = [];
    const samples = parts.reduce((n, p) => n + p.length, 0);
    setStats((s) => ({ ...s, frames: parts.length }));
    if (samples < rateRef.current / 4) {       // 不足 0.25s 基本是空录
      setPhase("error");
      setErr(`只收到 ${samples} 个采样，没录到声音。检查设备麦克风接线（INMP441：SCK47/WS21/SD10）。`);
      return;
    }
    const wav = pcmToWav(parts, rateRef.current);
    setAudioUrl((u) => { if (u) URL.revokeObjectURL(u); const nu = URL.createObjectURL(wav); audioUrlRef.current = nu; return nu; });
    if (!endpoint || !cfg.key) {
      setPhase("done");
      setText("");
      toast({ message: "未配置 ASR：可先在下方补齐服务商和 API Key，录音已可回放", seconds: 6 });
      return;
    }
    setPhase("transcribing");
    try {
      const j = await callAsr(wav);
      const t = typeof j.text === "string" ? j.text.trim() : JSON.stringify(j);
      setText(t);
      setPhase("done");
      // 识别文字回传设备 → 设备上的 agent 循环接管（经本页代理调 LLM，可建设备待办）
      if (t && handoff && transport && connected) transport.send({ type: "sttResult", text: t }).catch(() => {});
    } catch (e) {
      setPhase("error");
      setErr(`识别失败：${e instanceof Error ? e.message : e}（录音仍可回放重试）`);
    }
  };

  const fmtMs = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

  return (
    <>
      <PageHeader title="语音转文字" desc="按住牌面说话：设备麦克风录音，经蓝牙/串口上行，再由你选的 ASR 服务商转成文字。" />
      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader icon={<Tile color="pink" size={30}><Mic /></Tile>} title="录音识别" extra={connected ? <span className="hint">{device.kind === "ble" ? "蓝牙已连接" : device.kind === "serial" ? "串口已连接" : "已连接"}</span> : undefined} />
            <div className="card-b form">
              {!connected && (
                <Banner tone="warn" icon={<Bluetooth />}>
                  还没连接设备——先到 <Link to="/device">我的设备</Link> 用蓝牙或串口连上收工牌。
                </Banner>
              )}
              <div className="row" style={{ justifyContent: "center", padding: "12px 0" }}>
                {phase !== "recording" ? (
                  <button className="btn btn-primary" disabled={!connected || phase === "transcribing"} onClick={start} style={{ minWidth: 160 }}>
                    <Mic />开始说话
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={stop} style={{ minWidth: 160 }}>
                    <Square />说完，停止
                  </button>
                )}
              </div>
              <SettingRow title="识别后交给设备 Agent" desc="文字回传设备，由设备上最小的 agent 循环接管：经本页代理调 LLM，可创建/管理设备待办（需配 LLM Key）">
                <Toggle checked={handoff} onChange={(v) => { setHandoff(v); localStorage.setItem("stt-agent-handoff", v ? "1" : "0"); }} />
              </SettingRow>
              {s.deviceAgent.busy && <Banner tone="info" icon={<Sparkles />}>设备 Agent 思考中——正通过本页代理调用 LLM…</Banner>}
              {phase === "recording" && (
                <Banner tone="rest" icon={<AudioLines />}>
                  <b>录音中 {fmtMs(stats.ms)}</b> · 已收 {stats.frames} 帧{stats.lost > 0 ? ` · 丢 ${stats.lost} 帧（蓝牙拥塞，影响很小）` : ""}
                </Banner>
              )}
              {phase === "transcribing" && <Banner tone="info" icon={<Radio />}>已录 {fmtMs(stats.ms)}，正在送给 ASR 识别…</Banner>}
              {phase === "error" && <Banner tone="warn">{err}</Banner>}
              {phase === "done" && (
                <div className="grid" style={{ gap: 10 }}>
                  <div className="code-box">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div className="hint">识别结果</div>
                      {text && <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(text); toast({ message: "已复制" }); }}><ClipboardCopy />复制</button>}
                    </div>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7 }}>{text || "（空——未配置 ASR 或服务返回空文本）"}</p>
                  </div>
                  {audioUrl && (
                    <div className="row">
                      <Play className="i" />
                      <audio controls src={audioUrl} style={{ height: 32, flex: 1 }} />
                    </div>
                  )}
                  <div className="hint">{stats.frames} 帧 · {fmtMs(stats.ms)}{stats.lost ? ` · 丢 ${stats.lost} 帧` : ""} · {rateRef.current / 1000}kHz ADPCM</div>
                  {text && (
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn btn-ghost btn-sm" disabled={llmOut.st === "running"} onClick={runLlm}>
                        <Sparkles />{llmOut.st === "running" ? "LLM 处理中…" : "AI 整理 / 提取意图"}
                      </button>
                    </div>
                  )}
                  {llmOut.st !== "idle" && (
                    <div className="code-box">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div className="hint">LLM 回复</div>
                        {llmOut.st === "ok" && <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(llmOut.text); toast({ message: "已复制" }); }}><ClipboardCopy />复制</button>}
                      </div>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", color: llmOut.st === "fail" ? "#dc2626" : undefined }}>
                        {llmOut.st === "running" ? "正在等待模型回复…" : llmOut.text}
                      </p>
                    </div>
                  )}
                  {(s.deviceAgent.reply || s.deviceAgent.err) && (
                    <div className="code-box">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div className="hint">设备 Agent 回复</div>
                        {s.deviceAgent.reply && <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(s.deviceAgent.reply!); toast({ message: "已复制" }); }}><ClipboardCopy />复制</button>}
                      </div>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", color: s.deviceAgent.err ? "#dc2626" : undefined }}>
                        {s.deviceAgent.reply || `运行中止：${s.deviceAgent.err}`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader icon={<Tile color="violet" size={30}><KeySquare /></Tile>} title="ASR 服务商" />
            <div className="card-b form">
              <SettingRow title="服务商" desc="OpenAI 兼容的音频转写端点">
                <select className="input input-sm" value={cfg.provider} onChange={(e) => saveCfg({ provider: e.target.value })}>
                  {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </SettingRow>
              {cfg.provider === "custom" && (
                <>
                  <SettingRow title="端点 URL"><input className="input input-sm" placeholder="https://…/v1/audio/transcriptions" value={cfg.endpoint} onChange={(e) => saveCfg({ endpoint: e.target.value })} /></SettingRow>
                  <SettingRow title="模型"><input className="input input-sm" placeholder="whisper-1" value={cfg.model} onChange={(e) => saveCfg({ model: e.target.value })} /></SettingRow>
                </>
              )}
              {cfg.provider !== "custom" && (
                <SettingRow title="端点"><span className="hint" style={{ wordBreak: "break-all" }}>{endpoint}</span></SettingRow>
              )}
              <SettingRow title="API Key" desc="只存在本机浏览器里，不会上传代码仓库">
                <input className="input input-sm" type="password" placeholder="sk-…" value={cfg.key} onChange={(e) => saveCfg({ key: e.target.value })} />
              </SettingRow>
              <div className="row" style={{ justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                {test.msg && (
                  <span className="hint" style={{ color: test.st === "ok" ? "#059669" : test.st === "fail" ? "#dc2626" : "#9ca3af", flex: 1, textAlign: "right" }}>
                    {test.msg}
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" disabled={!cfg.key.trim() || !endpoint || test.st === "testing"} onClick={testKey}>
                  {test.st === "testing" ? "测试中…" : "测试连接"}
                </button>
              </div>
              {KEY_URLS[cfg.provider] && (
                <a className="hint" href={KEY_URLS[cfg.provider]} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-end" }}>
                  → 去{preset.name}控制台申请 Key
                </a>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader icon={<Tile color="blue" size={30}><Sparkles /></Tile>} title="LLM 服务商" />
            <div className="card-b form">
              <SettingRow title="服务商" desc="OpenAI 兼容的对话端点，识别完可一键整理/提取意图">
                <select className="input input-sm" value={llm.provider} onChange={(e) => saveLlm({ provider: e.target.value })}>
                  {LLM_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </SettingRow>
              {llm.provider === "custom" && (
                <>
                  <SettingRow title="端点 URL"><input className="input input-sm" placeholder="https://…/v1/chat/completions" value={llm.endpoint} onChange={(e) => saveLlm({ endpoint: e.target.value })} /></SettingRow>
                  <SettingRow title="模型"><input className="input input-sm" placeholder="gpt-4o-mini" value={llm.model} onChange={(e) => saveLlm({ model: e.target.value })} /></SettingRow>
                </>
              )}
              {llm.provider !== "custom" && (
                <SettingRow title="端点 / 模型"><span className="hint" style={{ wordBreak: "break-all" }}>{llmEndpoint}<br />{llmModel}</span></SettingRow>
              )}
              <SettingRow title="API Key" desc="只存在本机浏览器里，不会上传代码仓库">
                <input className="input input-sm" type="password" placeholder="sk-…" value={llm.key} onChange={(e) => saveLlm({ key: e.target.value })} />
              </SettingRow>
              <div className="row" style={{ justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                {llmTest.msg && (
                  <span className="hint" style={{ color: llmTest.st === "ok" ? "#059669" : llmTest.st === "fail" ? "#dc2626" : "#9ca3af", flex: 1, textAlign: "right" }}>
                    {llmTest.msg}
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" disabled={!llm.key.trim() || !llmEndpoint || llmTest.st === "testing"} onClick={testLlm}>
                  {llmTest.st === "testing" ? "测试中…" : "测试连接"}
                </button>
              </div>
              {LLM_KEY_URLS[llm.provider] && (
                <a className="hint" href={LLM_KEY_URLS[llm.provider]} target="_blank" rel="noreferrer" style={{ alignSelf: "flex-end" }}>
                  → 去{llmPreset.name}控制台申请 Key
                </a>
              )}
            </div>
          </Card>
          <Banner tone="info" icon={<Usb />}>
            <b>隐私说明</b>录音从设备经蓝牙/串口到本页，只在点击停止后发给上面选的服务商一次；本页不保存原始录音。要完全离线转文字，得等 ESP-SR 本地口令方案（见路线图）。
          </Banner>
        </div>
      </div>
    </>
  );
}
