import { Link } from "react-router-dom";
import {
  Fingerprint, Keyboard, Gauge, Image, Palette, Sparkles, ShieldCheck, Moon, BarChart3, Monitor, ChevronRight, RotateCcw, Sunset,
} from "lucide-react";
import { useStore } from "../store/AppStore";
import { STATUSES, STATUS_ORDER } from "../domain/statuses";
import type { AgentState, KeyAction, LedMode, Settings, StatusId } from "../domain/types";
import { ago } from "../domain/time";
import { Banner, Card, CardHeader, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { StatusScreens } from "./StatusScreens";
import { useToast } from "../ui/Toast";

const KEY_ACTIONS: { value: KeyAction; label: string }[] = [
  { value: "offwork", label: "收工（结束今天）" },
  { value: "focus25", label: "开始 25 分钟专注" },
  { value: "pauseToday", label: "暂停/恢复今日计划" },
  ...STATUS_ORDER.map((id) => ({ value: id as KeyAction, label: `切换为${STATUSES[id].label}` })),
];

const KeySelect = ({ value, onChange }: { value: KeyAction; onChange: (v: KeyAction) => void }) => (
  <select className="input input-sm" value={value} onChange={(e) => onChange(e.target.value as KeyAction)}>
    {KEY_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

export function ControlsPage() {
  const { s, actions } = useStore();
  const set = (p: Partial<Settings>) => actions.updateSettings(p);
  return (
    <>
      <PageHeader title="触摸与快捷键" desc="设置桌牌上的触摸区、自定义快捷键和旋钮。收工键的“长按确认”规则不能被修改。" />
      <div className="grid g-cards">
        <Card>
          <CardHeader icon={<Tile color="blue" size={30}><Keyboard /></Tile>} title="按键映射" extra={<span className="badge b-new">K1–K4</span>} />
          <div className="card-b form">
            <SettingRow title="K1 · 收工键" desc="默认收工；长按确认规则见下方卡片"><KeySelect value={s.settings.keys.k1} onChange={(v) => set({ keys: { ...s.settings.keys, k1: v } })} /></SettingRow>
            <SettingRow title="K2 · 快捷键" desc="单击触发"><KeySelect value={s.settings.keys.k2} onChange={(v) => set({ keys: { ...s.settings.keys, k2: v } })} /></SettingRow>
            <SettingRow title="K3 · 触摸区·左" desc="轻触触发"><KeySelect value={s.settings.keys.k3} onChange={(v) => set({ keys: { ...s.settings.keys, k3: v } })} /></SettingRow>
            <SettingRow title="K4 · 触摸区·右" desc="轻触触发"><KeySelect value={s.settings.keys.k4} onChange={(v) => set({ keys: { ...s.settings.keys, k4: v } })} /></SettingRow>
            <p className="hint" style={{ margin: 0 }}>四个按键都可自定义。当前按下已是目标状态时不会再切换或闪烁屏幕。K3/K4 暂由按键模块代行，触摸电极接好后语义不变。</p>
            <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => set({ keys: { k1: "offwork", k2: "busy", k3: "work", k4: "busy" } })}><RotateCcw />恢复默认</button>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Tile color="orange" size={30}><Gauge /></Tile>} title="旋钮定时" extra={<span className="badge b-warn">硬件待补充</span>} />
          <div className="card-b form">
            <SettingRow title="每格时长"><Segmented value={String(s.settings.knobStep)} options={[{ value: "1", label: "1 分钟" }, { value: "5", label: "5 分钟" }, { value: "10", label: "10 分钟" }]} onChange={(v) => set({ knobStep: Number(v) })} /></SettingRow>
            <SettingRow title="最长时长"><select className="input input-sm" value={s.settings.knobMax} onChange={(e) => set({ knobMax: Number(e.target.value) })}>{[60, 120, 180].map((m) => <option key={m} value={m}>{m} 分钟</option>)}</select></SettingRow>
            <p className="hint" style={{ margin: 0 }}>旋转选择时长，按下开始倒计时。计时结束不会自动改变状态。</p>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Tile color="orange" size={30}><Sunset /></Tile>} title="收工键" />
          <div className="card-b form"><p className="hint" style={{ margin: 0 }}>长按约 2 秒收工（阈值待原型测试）。网页上按住 1.5 秒收工，完成后 10 秒内可撤销。</p></div>
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
  const { s, actions } = useStore();
  return (
    <>
      <PageHeader title="灯效" desc="RGB 灯只用来辅助远距离识别，屏幕文字才是状态的准确信息。灯光默认低亮，可以完全关闭。" />
      <div className="cols">
        <Card>
          <CardHeader icon={<Tile color="pink" size={30}><Palette /></Tile>} title="每个状态的灯光" />
          {STATUS_ORDER.map((id) => (
            <RowItem key={id}
              lead={<span className="swatch-led" style={{ background: s.settings.led[id] === "off" ? "var(--line-2)" : STATUSES[id].color, boxShadow: s.settings.led[id] === "off" ? "none" : `0 0 10px 1px ${STATUSES[id].color}` }} />}
              title={STATUSES[id].label}
              meta={<Segmented value={s.settings.led[id]} options={LED_OPTS} onChange={(v) => actions.updateSettings({ led: { ...s.settings.led, [id]: v } })} />}
            />
          ))}
        </Card>
        <div className="stack">
          <Card>
            <div className="card-b form">
              <SettingRow title="亮度" desc={`${s.settings.ledBrightness}%`}>
                <input type="range" min={5} max={100} step={5} value={s.settings.ledBrightness} onChange={(e) => actions.updateSettings({ ledBrightness: Number(e.target.value) })} />
              </SettingRow>
              <SettingRow title="夜间自动关灯" desc="22:00 – 07:00"><Toggle checked={s.settings.ledNightOff} onChange={(v) => actions.updateSettings({ ledNightOff: v })} /></SettingRow>
              <button className="btn btn-secondary" onClick={() => actions.updateSettings({ led: Object.fromEntries(STATUS_ORDER.map((id) => [id, "off"])) as Settings["led"] })}><Moon />无灯光模式</button>
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
                <SettingRow key={id} title={`进入“${STATUSES[id].label}”时开启手机勿扰`}>
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
