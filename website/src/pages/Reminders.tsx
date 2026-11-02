import { useState } from "react";
import { Bell, Check, History, Mic, Moon, Plus, Trash2, Undo2 } from "lucide-react";
import { useStore } from "../store/AppStore";
import type { Reminder, ReminderTrigger } from "../domain/types";
import { dateKey, startOfDay } from "../domain/time";
import { Card, CardHeader, EmptyState, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

export function RemindersPage() {
  const { s, actions } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [trigger, setTrigger] = useState<ReminderTrigger>("time");
  const [at, setAt] = useState("17:30");
  const [showOnDevice, setShowOnDevice] = useState(false);
  const [deviceText, setDeviceText] = useState("");
  const today = dateKey(Date.now());
  const yesterday = dateKey(startOfDay(Date.now()) - 1);
  const open = s.reminders.filter((r) => !r.done);
  const todayOpen = open.filter((r) => r.day >= today);
  const leftover = open.filter((r) => r.day < today);
  const done = s.reminders.filter((r) => r.done);

  const add = () => {
    if (!title.trim()) { toast({ message: "先填写提醒内容" }); return; }
    actions.addReminder({ title: title.trim(), trigger, at: trigger === "time" ? at : undefined, showOnDevice, deviceText: deviceText.trim() || undefined, createdBy: "manual" });
    setTitle("");
    toast({ message: "提醒已创建" });
  };

  const dayLabel = (r: Reminder) => (r.day === today ? "今天" : r.day === yesterday ? "昨天" : r.day);
  const desc = (r: Reminder) =>
    `${r.trigger === "afterOffwork" ? "收工后提醒" : `${dayLabel(r)} ${r.at}`} · ${r.showOnDevice ? (r.deviceText ? `设备显示“${r.deviceText}”` : "在设备上显示") : "仅网页和手机可见"}${r.createdBy === "voice" ? " · 语音创建" : ""}${r.firedAt ? " · 已提醒" : ""}`;

  const row = (r: Reminder) => (
    <RowItem
      key={r.id}
      lead={<Tile color={r.createdBy === "voice" ? "pink" : r.trigger === "afterOffwork" ? "violet" : "orange"}>{r.createdBy === "voice" ? <Mic /> : r.trigger === "afterOffwork" ? <Moon /> : <Bell />}</Tile>}
      title={r.title}
      desc={desc(r)}
      meta={
        <div className="row" style={{ gap: 2 }}>
          {r.trigger === "time" && <input className="input" type="time" value={r.at} onChange={(e) => { actions.setReminderAt(r.id, e.target.value); toast({ message: `已改为 ${e.target.value} 提醒` }); }} style={{ width: 96, padding: "5px 8px", fontSize: 12.5 }} aria-label="修改提醒时间" />}
          <button className="btn btn-secondary btn-sm" onClick={() => actions.toggleReminder(r.id)}><Check />完成</button>
          <button className="icon-btn" aria-label="删除" onClick={() => actions.deleteReminder(r.id)}><Trash2 className="i" /></button>
        </div>
      }
    />
  );

  return (
    <>
      <PageHeader title="待办与提醒" desc="简短的提醒，不做完整的任务管理。提醒正文默认不显示在桌牌上，访客看不到。" />
      <div className="cols">
        <div className="stack">
          {leftover.length > 0 && (
            <Card>
              <CardHeader title="昨天遗留" count={leftover.length} icon={<Tile color="violet" size={30}><History /></Tile>} />
              {leftover.map(row)}
            </Card>
          )}
          <Card>
            <CardHeader title="待处理" count={todayOpen.length} />
            {todayOpen.length === 0 && <EmptyState icon={<Check />} title="都处理完了" desc="新的提醒可以在右侧创建，或点右下角用一句话创建。" />}
            {todayOpen.map(row)}
          </Card>
          {done.length > 0 && (
            <Card>
              <CardHeader title="已完成" count={done.length} />
              {done.map((r) => (
                <RowItem key={r.id} className="stale" lead={<Tile color="green"><Check /></Tile>} title={r.title} desc={r.trigger === "afterOffwork" ? "收工后提醒" : `${dayLabel(r)} ${r.at}`}
                  meta={
                    <div className="row" style={{ gap: 2 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => actions.toggleReminder(r.id)}><Undo2 />恢复</button>
                      <button className="icon-btn" aria-label="删除" onClick={() => actions.deleteReminder(r.id)}><Trash2 className="i" /></button>
                    </div>
                  } />
              ))}
            </Card>
          )}
        </div>
        <div className="stack">
          <Card>
            <CardHeader title="新建待办" />
            <div className="card-b form">
              <label>内容<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：提交本周周报" onKeyDown={(e) => e.key === "Enter" && add()} /></label>
              <div className="form-label">什么时候提醒
                <Segmented value={trigger} options={[{ value: "time", label: "指定时间" }, { value: "afterOffwork", label: "收工后" }]} onChange={setTrigger} />
              </div>
              {trigger === "time" && <label>时间<input className="input" type="time" value={at} onChange={(e) => setAt(e.target.value)} /></label>}
              <SettingRow title="在设备上显示" desc="关闭时设备只提示“有 1 条提醒”，正文不上屏"><Toggle checked={showOnDevice} onChange={setShowOnDevice} /></SettingRow>
              {showOnDevice && <label>设备上显示的文字<input className="input" value={deviceText} onChange={(e) => setDeviceText(e.target.value)} placeholder="留空时显示待办内容" /></label>}
              <button className="btn btn-primary" onClick={add}><Plus />创建</button>
            </div>
          </Card>
          <Card>
            <div className="card-b form">
              <SettingRow title="默认在桌牌上显示提醒正文" desc="建议关闭，保护隐私"><Toggle checked={s.settings.showReminderOnDevice} onChange={(v) => actions.updateSettings({ showReminderOnDevice: v })} /></SettingRow>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
