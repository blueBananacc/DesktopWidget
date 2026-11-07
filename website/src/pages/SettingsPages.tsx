import { Link } from "react-router-dom";
import {
  Fingerprint, Keyboard, Gauge, Image, Palette, Sparkles, ShieldCheck, Moon, BarChart3, Monitor, ChevronRight, RotateCcw, Unplug,
} from "lucide-react";
import { useStore } from "../store/AppStore";
import { allStatusIds, statusMeta } from "../domain/statuses";
import type { AgentState, KeyAction, LedMode, Settings, StatusId } from "../domain/types";
import { ago } from "../domain/time";
import { Banner, Card, CardHeader, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { StatusScreens } from "./StatusScreens";
import { useToast } from "../ui/Toast";

const KEY_ACTIONS_BUILTIN: { value: KeyAction; label: string }[] = [
  { value: "offwork", label: "收工（结束今天）" },
  { value: "focus25", label: "开始 25 分钟专注" },
  { value: "pauseToday", label: "暂停/恢复今日计划" },
  { value: "cycleL", label: "上一个状态" },
  { value: "cycleR", label: "下一个状态" },
];
// 状态选项动态生成（含设备注册的自定义状态），KEY_ACTIONS_BUILTIN 前缀保持在前
const keyActionOptions = () => [
  ...KEY_ACTIONS_BUILTIN,
  ...allStatusIds().map((id) => ({ value: id as KeyAction, label: `切换为${statusMeta(id).label}` })),
];

const KeySelect = ({ value, onChange, disabled }: { value: KeyAction; onChange: (v: KeyAction) => void; disabled?: boolean }) => (
  <select className="input input-sm" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as KeyAction)}>
    {keyActionOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

export function ControlsPage() {
  const { s, actions, device } = useStore();
  const toast = useToast();
  const connected = device.state === "connected";
  const set = (p: Partial<Settings>) => actions.updateSettings(p);
  // 规则：K1–K4 中必须保留一个「收工」——想把最后一个收工键改掉时拒绝并提示
  const setKey = (k: "k1" | "k2" | "k3" | "k4", v: KeyAction) => {
    const next = { ...s.settings.keys, [k]: v };
    if (![next.k1, next.k2, next.k3, next.k4].includes("offwork")) {
      toast({ message: "四个实体键中必须保留一个「收工」" });
      return;
    }
    set({ keys: next });
  };
  return (
    <>
      <PageHeader title="触摸与快捷键" desc="设置桌牌上的 4 个实体键、触摸键和旋钮。映射为收工的键需要按住确认，防止误触。" />
      {!connected && <Banner tone="warn" icon={<Unplug />}>设备未连接：按键映射存在设备上，连接后才能查看和修改。</Banner>}
      <div className="grid g-cards">
        <Card>
          <CardHeader icon={<Tile color="blue" size={30}><Keyboard /></Tile>} title="按键映射" extra={<span className="badge b-new">K1–K4 + 触摸</span>} />
          <div className="card-b form">
            {(["k1", "k2", "k3", "k4"] as const).map((k, i) => (
              <SettingRow key={k} title={`K${i + 1} · 实体键`} desc={s.settings.keys[k] === "offwork" ? "映射为收工：按住 1.5 秒才触发" : "按下触发"}>
                <KeySelect disabled={!connected} value={s.settings.keys[k]} onChange={(v) => setKey(k, v)} />
              </SettingRow>
            ))}
            <SettingRow title="触摸键" desc={s.settings.keys.t === "offwork" ? "映射为收工：按住 1.5 秒才触发" : "触摸触发"}>
              <KeySelect disabled={!connected} value={s.settings.keys.t} onChange={(v) => set({ keys: { ...s.settings.keys, t: v } })} />
            </SettingRow>
            <p className="hint" style={{ margin: 0 }}>映射写入设备后断电保留。<b>K1–K4 中必须保留一个「收工」</b>；映射为收工的键需要按住约 1.5 秒才触发，防止误收工。当前已是目标状态时按键不会再切换或闪烁屏幕。</p>
            <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} disabled={!connected} onClick={() => set({ keys: { k1: "offwork", k2: "busy", k3: "cycleL", k4: "cycleR", t: "rest" } })}><RotateCcw />恢复默认</button>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Tile color="orange" size={30}><Gauge /></Tile>} title="旋钮定时" extra={<span className="badge b-new">设备执行</span>} />
          <div className="card-b form">
            <SettingRow title="每格时长"><Segmented disabled={!connected} value={String(s.settings.knobStep)} options={[{ value: "1", label: "1 分钟" }, { value: "5", label: "5 分钟" }, { value: "10", label: "10 分钟" }]} onChange={(v) => set({ knobStep: Number(v) })} /></SettingRow>
            <SettingRow title="最长时长"><select className="input input-sm" disabled={!connected} value={s.settings.knobMax} onChange={(e) => set({ knobMax: Number(e.target.value) })}>{[60, 120, 180].map((m) => <option key={m} value={m}>{m} 分钟</option>)}</select></SettingRow>
            <p className="hint" style={{ margin: 0 }}>配置存在设备上，断电保留。旋转选择时长，按下开始倒计时，长按取消；倒计时由设备独立执行，网页关闭也照常计时，到点只提醒、不会自动改变状态。</p>
          </div>
        </Card>
      </div>
    </>
  );
}

export function ScreenPage() {
  return (
    <>
      <PageHeader title="屏幕内容" desc="桌牌屏幕默认显示状态名、时间和一句说明。也可以给任意状态换成自己写的屏幕程序，装进设备后网页关掉也照常运行。" />
      <StatusScreens />
    </>
  );
}

const LED_OPTS: { value: LedMode; label: string }[] = [
  { value: "solid", label: "常亮" },
  { value: "breath", label: "呼吸" },
  { value: "off", label: "关闭" },
];

export function LightingPage() {
  const { s, actions, device } = useStore();
  const connected = device.state === "connected";
  return (
    <>
      <PageHeader title="灯效" desc="RGB 灯只用来辅助远距离识别，屏幕文字才是状态的准确信息。灯光默认低亮，可以完全关闭。" />
      {!connected && <Banner tone="warn" icon={<Unplug />}>设备未连接：灯效设置存在设备上，连接后才能查看和修改。</Banner>}
      <div className="cols">
        <Card>
          <CardHeader icon={<Tile color="pink" size={30}><Palette /></Tile>} title="每个状态的灯光" />
          {allStatusIds().map((id) => (
            <RowItem key={id}
              lead={<span className="swatch-led" style={{ background: s.settings.led[id] === "off" ? "var(--line-2)" : statusMeta(id).color, boxShadow: s.settings.led[id] === "off" ? "none" : `0 0 10px 1px ${statusMeta(id).color}` }} />}
              title={statusMeta(id).label}
              meta={<Segmented disabled={!connected} value={s.settings.led[id] ?? "solid"} options={LED_OPTS} onChange={(v) => actions.updateSettings({ led: { ...s.settings.led, [id]: v } })} />}
            />
          ))}
        </Card>
        <div className="stack">
          <Card>
            <div className="card-b form">
              <SettingRow title="亮度" desc={`${s.settings.ledBrightness}%`}>
                <input type="range" min={5} max={100} step={5} value={s.settings.ledBrightness} disabled={!connected} onChange={(e) => actions.updateSettings({ ledBrightness: Number(e.target.value) })} />
              </SettingRow>
              <SettingRow title="夜间自动关灯" desc="22:00 – 07:00"><Toggle checked={s.settings.ledNightOff} disabled={!connected} onChange={(v) => actions.updateSettings({ ledNightOff: v })} /></SettingRow>
              <button className="btn btn-secondary" disabled={!connected} onClick={() => actions.updateSettings({ led: Object.fromEntries(allStatusIds().map((id) => [id, "off"])) as Settings["led"] })}><Moon />无灯光模式</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const AGENT_LABEL: Record<AgentState, string> = { idle: "空闲", running: "运行中 / Thinking", needsInput: "需要你的输入", done: "已完成", error: "发生错误" };

export function AgentPage() {
  const { s, now, actions } = useStore();
  return (
    <>
      <PageHeader title="Agent 联动" desc="电脑上的 Agent 运行时，在桌牌上显示概括状态。不显示 Prompt、代码、文件或仓库名。" />
      <div className="cols">
        <Card>
          <CardHeader icon={<Tile color="blue" size={30}><Sparkles /></Tile>} title="当前 Agent 状态" extra={<span className="badge b-beta">测试版</span>} />
          <div className="card-b form">
            <SettingRow title="启用 Agent 联动"><Toggle checked={s.settings.agentEnabled} onChange={(v) => actions.updateSettings({ agentEnabled: v })} /></SettingRow>
            <SettingRow title={`任务：${s.agent.task}`} desc={`更新于 ${ago(s.agent.updatedAt, now)}`}><span className={`badge ${s.agent.state === "needsInput" || s.agent.state === "error" ? "b-warn" : "b-new"}`}>{AGENT_LABEL[s.agent.state]}</span></SettingRow>
            <div className="row">
              {(Object.keys(AGENT_LABEL) as AgentState[]).map((st) => (
                <button key={st} className={`btn btn-sm ${s.agent.state === st ? "btn-primary" : "btn-secondary"}`} onClick={() => actions.setAgent(st)}>{AGENT_LABEL[st]}</button>
              ))}
            </div>
            <p className="hint" style={{ margin: 0 }}>上面的按钮用于演示。正式版本由电脑伴侣程序通过官方 API 或 CLI hooks 上报，不读取屏幕或键盘。</p>
          </div>
        </Card>
        <Banner tone="info" icon={<Monitor className="i" />}>“已完成 / 需要输入 / 发生错误”会让灯闪一次提醒，可以在“灯效”里关闭。长时间运行不会持续闪烁。</Banner>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { s, actions } = useStore();
  const toast = useToast();
  const set = (p: Partial<Settings>) => actions.updateSettings(p);
  return (
    <>
      <PageHeader title="隐私与设置" desc="收工牌是个人边界工具，不用于考勤、监控或绩效评估。" />
      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader title="计划表与手动切换" />
            <div className="card-b form">
              <SettingRow title="手动切换状态时" desc="计划表到点会自动切换">
                <Segmented value={s.settings.overrideMode} options={[{ value: "untilNextNode", label: "只覆盖到下一个节点" }, { value: "pauseToday", label: "暂停今日计划" }]} onChange={(v) => set({ overrideMode: v })} />
              </SettingRow>
            </div>
          </Card>
          <Card>
            <CardHeader title="手机勿扰联动" extra={<span className="badge b-warn">需手机 App</span>} />
            <div className="card-b form">
              {(["work", "busy", "focus", "meet"] as StatusId[]).map((id) => (
                <SettingRow key={id} title={`进入“${statusMeta(id).label}”时开启手机勿扰`}>
                  <Toggle checked={!!s.settings.phoneDnd[id]} onChange={(v) => set({ phoneDnd: { ...s.settings.phoneDnd, [id]: v } })} />
                </SettingRow>
              ))}
              <p className="hint" style={{ margin: 0 }}>网页无法控制手机的勿扰或专注模式。这些设置会在手机 App 中、经系统授权后生效；iOS 可能需要用快捷指令代替。</p>
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card>
            <CardHeader icon={<Tile color="teal" size={30}><ShieldCheck /></Tile>} title="隐私" />
            <div className="card-b form">
              <RowItem lead={<Tile color="green"><ShieldCheck /></Tile>} title="数据保存在本机浏览器" desc="状态记录、计划表和提醒不会上传" />
              <RowItem lead={<Tile color="green"><BarChart3 /></Tile>} title="不做效率评分和排名" desc="状态时长只反映你设置的状态" />
              <RowItem lead={<Tile color="green"><Moon /></Tile>} title="共享只包含当前状态" desc="不分享计划、待办、历史" />
              <button className="btn btn-danger" onClick={() => { if (confirm("清除本机所有数据并恢复演示数据？此操作不可撤销。")) { actions.resetDemo(); toast({ message: "已恢复演示数据" }); } }}><RotateCcw />清除本机数据</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const ME_LINKS = [
  { to: "/review", label: "状态回顾", icon: BarChart3, color: "violet" },
  { to: "/agent", label: "Agent 联动", icon: Sparkles, color: "blue" },
  { to: "/device", label: "我的设备", icon: Monitor, color: "violet" },
  { to: "/controls", label: "触摸与快捷键", icon: Fingerprint, color: "blue" },
  { to: "/screen", label: "屏幕内容", icon: Image, color: "violet" },
  { to: "/lighting", label: "灯效", icon: Palette, color: "pink" },
  { to: "/settings", label: "隐私与设置", icon: ShieldCheck, color: "teal" },
] as const;

export function MePage() {
  const { s } = useStore();
  return (
    <>
      <PageHeader title="我的" desc={`${s.user.name} · ${s.user.team}`} />
      <Card>
        {ME_LINKS.map((l) => (
          <Link key={l.to} to={l.to} style={{ color: "inherit" }}>
            <RowItem lead={<Tile color={l.color}><l.icon /></Tile>} title={l.label} meta={<ChevronRight className="i" style={{ color: "var(--ink-3)" }} />} onClick={() => {}} />
          </Link>
        ))}
      </Card>
    </>
  );
}
