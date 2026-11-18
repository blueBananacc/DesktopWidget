import { Link } from "react-router-dom";
import {
  ShieldCheck, Moon, BarChart3, Monitor, MonitorPlay, ChevronRight, RotateCcw,
} from "lucide-react";
import { useStore } from "../store/AppStore";
import { statusMeta } from "../domain/statuses";
import type { Settings, StatusId } from "../domain/types";
import { Card, CardHeader, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { Emulator } from "./Emulator";
import { useToast } from "../ui/Toast";

export function ScreenPage() {
  return <Emulator />;
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
  { to: "/device", label: "我的设备", icon: Monitor, color: "violet" },
  { to: "/screen", label: "模拟器", icon: MonitorPlay, color: "violet" },
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
