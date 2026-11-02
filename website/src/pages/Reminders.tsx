import { useState } from "react";
import { Bell, Check, Clock, Mic, Moon, Plus, Trash2, Undo2 } from "lucide-react";
import { useStore } from "../store/AppStore";
import type { ReminderTrigger } from "../domain/types";
import { Card, CardHeader, EmptyState, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

export function RemindersPage() {
  const { s, actions } = useStore();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [trigger, setTrigger] = useState<ReminderTrigger>("time");
  const [at, setAt] = useState("17:30");
  const [showOnDevice, setShowOnDevice] = useState(false);
  const open = s.reminders.filter((r) => !r.done);
  const done = s.reminders.filter((r) => r.done);

  const add = () => {
    if (!title.trim()) return;
    actions.addReminder({ title: title.trim(), trigger, at: trigger === "time" ? at : undefined, showOnDevice, createdBy: "manual" });
    setTitle("");
    toast({ message: "提醒已创建" });
  };

  return (
    <>
      <PageHeader title="待办与提醒" desc="简短的提醒，不做完整的任务管理。提醒正文默认不显示在桌牌上，访客看不到。" />
      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader title="待处理" count={open.length} />
            {open.length === 0 && <EmptyState icon={<Check />} title="都处理完了" desc="新的提醒可以在右侧创建，或点右下角用一句话创建。" />}
            {open.map((r) => (
              <RowItem
                key={r.id}
                lead={<Tile color={r.createdBy === "voice" ? "pink" : r.trigger === "afterOffwork" ? "violet" : "orange"}>{r.createdBy === "voice" ? <Mic /> : r.trigger === "afterOffwork" ? <Moon /> : <Bell />}</Tile>}
                title={r.title}
                desc={`${r.trigger === "afterOffwork" ? "收工后提醒" : `今天 ${r.at}`} · ${r.showOnDevice ? "在设备上显示" : "仅网页和手机可见"}${r.createdBy === "voice" ? " · 语音创建" : ""}`}
                meta={
                  <div className="row" style={{ gap: 2 }}>
                    {r.trigger === "time" && <button className="btn btn-ghost btn-sm" onClick={() => { actions.postponeReminder(r.id, 30); toast({ message: "已延后 30 分钟" }); }}><Clock />延后</button>}
                    <button className="btn btn-secondary btn-sm" onClick={() => actions.toggleReminder(r.id)}><Check />完成</button>
                    <button className="icon-btn" aria-label="删除" onClick={() => actions.deleteReminder(r.id)}><Trash2 className="i" /></button>
                  </div>
                }
              />
            ))}
          </Card>
          {done.length > 0 && (
            <Card>
              <CardHeader title="已完成" count={done.length} />
              {done.map((r) => (
                <RowItem key={r.id} className="stale" lead={<Tile color="green"><Check /></Tile>} title={r.title} desc={r.trigger === "afterOffwork" ? "收工后提醒" : `今天 ${r.at}`}
                  meta={<button className="btn btn-ghost btn-sm" onClick={() => actions.toggleReminder(r.id)}><Undo2 />恢复</button>} />
              ))}
            </Card>
          )}
        </div>
        <div className="stack">
          <Card>
            <CardHeader title="新建提醒" />
            <div className="card-b form">
              <label>内容<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：提交本周周报" onKeyDown={(e) => e.key === "Enter" && add()} /></label>
              <label>什么时候提醒
                <Segmented value={trigger} options={[{ value: "time", label: "指定时间" }, { value: "afterOffwork", label: "收工后" }]} onChange={setTrigger} />
              </label>
              {trigger === "time" && <label>时间<input className="input" type="time" value={at} onChange={(e) => setAt(e.target.value)} /></label>}
              <SettingRow title="在设备上显示正文" desc="关闭时设备只显示“有 1 条提醒”"><Toggle checked={showOnDevice} onChange={setShowOnDevice} /></SettingRow>
              <button className="btn btn-primary" disabled={!title.trim()} onClick={add}><Plus />创建</button>
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
