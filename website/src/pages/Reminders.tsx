import { useRef, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { ArrowRight, Bell, Check, History, Mic, Moon, Plus, Trash2, Undo2, Unplug } from "lucide-react";
import { useStore } from "../store/AppStore";
import type { Reminder, ReminderTrigger } from "../domain/types";
import { atToday, dateKey, hhmm, startOfDay } from "../domain/time";
import { scheduleForDay, sortedNodes } from "../domain/schedule";
import { Card, CardHeader, EmptyState, Modal, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

/** 设备屏一行可显示的字数上限（128px 宽、12px 中文字体） */
const DEVICE_TEXT_MAX = 10;

interface Draft {
  title: string;
  trigger: ReminderTrigger;
  at: string;
  showOnDevice: boolean;
  deviceText: string;
}

/** 下一个整半点，作为新建待办的默认时间 */
const nextHalfHour = (now: number) => hhmm(Math.ceil((now + 60_000) / 1_800_000) * 1_800_000);

/** 新建与编辑共用的字段：内容 / 触发 / 时间快捷项 / 设备显示与预览 */
function ReminderFields({ d, set, now, offAt, offworkToday, connected, titleRef, onEnter }: {
  d: Draft; set: (p: Partial<Draft>) => void; now: number; offAt?: string; offworkToday: boolean; connected: boolean;
  titleRef?: RefObject<HTMLInputElement | null>; onEnter?: () => void;
}) {
  const quick = [
    { label: "30 分钟后", at: hhmm(now + 30 * 60_000) },
    { label: "1 小时后", at: hhmm(now + 60 * 60_000) },
    ...(offAt ? [{ label: "收工前 15 分钟", at: hhmm(atToday(offAt, now) - 15 * 60_000) }] : []),
  ].filter((q) => atToday(q.at, now) > now && atToday(q.at, now) < startOfDay(now) + 86_400_000);
  const passed = d.trigger === "time" && atToday(d.at, now) <= now;
  const screenText = d.showOnDevice ? d.deviceText.trim() || d.title.trim() || "待办内容" : "有 1 条待办";
  return (
    <>
      <label>内容
        <input ref={titleRef} className="input" value={d.title} maxLength={40} onChange={(e) => set({ title: e.target.value })} placeholder="例如：提交本周周报" onKeyDown={(e) => e.key === "Enter" && onEnter?.()} />
      </label>
      <div className="form-label">什么时候提醒
        <Segmented value={d.trigger} options={[{ value: "time", label: "指定时间" }, { value: "afterOffwork", label: "收工后" }]} onChange={(trigger) => set({ trigger })} />
      </div>
      {d.trigger === "time" ? (
        <div className="form-label">时间
          <input className="input" type="time" value={d.at} onChange={(e) => set({ at: e.target.value })} />
          {quick.length > 0 && (
            <div className="mchips">
              {quick.map((q) => (
                <span key={q.label} className={`mchip${q.at === d.at ? " on" : ""}`}><button type="button" className="mchip-main" onClick={() => set({ at: q.at })}>{q.label}</button></span>
              ))}
            </div>
          )}
          {passed && <span className="hint" style={{ color: "#B7791F", fontWeight: 500 }}>这个时间今天已经过了，保存后会立即提醒。</span>}
        </div>
      ) : (
        <span className="hint" style={{ fontWeight: 500 }}>{offworkToday ? "今天已收工，保存后会立即提醒。" : "进入“已下班”状态时提醒，适合下班路上要办的事。"}</span>
      )}
      <SettingRow title="在设备上显示" desc="关闭时设备只提示“有 1 条待办”，正文不上屏"><Toggle checked={d.showOnDevice} onChange={(showOnDevice) => set({ showOnDevice })} /></SettingRow>
      {d.showOnDevice && (
        <div className="form-label">
          <span style={{ display: "flex", justifyContent: "space-between" }}>设备上显示的文字<span className="hint num">{d.deviceText.length}/{DEVICE_TEXT_MAX}</span></span>
          <input className="input" value={d.deviceText} maxLength={DEVICE_TEXT_MAX} onChange={(e) => set({ deviceText: e.target.value })} placeholder="留空时显示待办内容（超出部分会被截断）" />
        </div>
      )}
      <div className="form-label">设备上的样子
        <div className="oled" style={{ width: "100%", maxWidth: 260 }} aria-label={`设备预览：有新待办，${screenText}`}>
          <div>
            <div className="big">有新待办</div>
            <div className="sub">{screenText.slice(0, DEVICE_TEXT_MAX)}</div>
          </div>
          <div className="ico" />
          <div className="led glow" style={{ background: "#F2643A", color: "#F2643A" }} />
        </div>
        <span className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {connected ? "到点时屏幕显示 15 秒，灯光闪烁 3 秒，按任意键关闭。" : <><Unplug className="i" style={{ width: 13, height: 13 }} />设备未连接：到点只在网页提醒。</>}
        </span>
      </div>
    </>
  );
}

export function RemindersPage() {
  const { s, now, device, actions } = useStore();
  const toast = useToast();
  const connected = device.state === "connected";
  const titleRef = useRef<HTMLInputElement>(null);
  const blank = (): Draft => ({ title: "", trigger: "time", at: nextHalfHour(Date.now()), showOnDevice: s.settings.showReminderOnDevice, deviceText: "" });
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null);
  const [moving, setMoving] = useState<{ ids: string[]; at: string } | null>(null);

  const today = dateKey(now);
  const yesterday = dateKey(startOfDay(now) - 1);
  const sched = scheduleForDay(s.schedules, s.activeScheduleId, now);
  const offAt = sched ? sortedNodes(sched).find((n) => n.status === "off")?.time : undefined;
  const open = s.reminders.filter((r) => !r.done);
  const sortKey = (r: Reminder) => (r.trigger === "time" && r.at ? atToday(r.at, now) : Number.MAX_SAFE_INTEGER);
  const todayOpen = open.filter((r) => r.day >= today).sort((a, b) => sortKey(a) - sortKey(b));
  const leftover = open.filter((r) => r.day < today).sort((a, b) => a.day.localeCompare(b.day) || sortKey(a) - sortKey(b));
  const done = s.reminders.filter((r) => r.done);
  const overdue = (r: Reminder) => r.day === today && r.trigger === "time" && !!r.at && atToday(r.at, now) <= now;
  const next = todayOpen.find((r) => r.trigger === "time" && !overdue(r));

  const add = () => {
    if (!draft.title.trim()) { toast({ message: "先填写待办内容" }); titleRef.current?.focus(); return; }
    actions.addReminder({ title: draft.title.trim(), trigger: draft.trigger, at: draft.trigger === "time" ? draft.at : undefined, showOnDevice: draft.showOnDevice, deviceText: draft.deviceText.trim() || undefined, createdBy: "manual" });
    toast({ message: draft.trigger === "time" ? `已创建，${draft.at} 提醒` : "已创建，收工后提醒" });
    setDraft({ ...blank(), trigger: draft.trigger, showOnDevice: draft.showOnDevice });
    titleRef.current?.focus();
  };
  const save = () => {
    if (!editing) return;
    if (!editing.title.trim()) { toast({ message: "待办内容不能为空" }); return; }
    actions.updateReminder(editing.id, { title: editing.title.trim(), trigger: editing.trigger, at: editing.trigger === "time" ? editing.at : undefined, showOnDevice: editing.showOnDevice, deviceText: editing.deviceText.trim() || undefined });
    setEditing(null);
    toast({ message: "已保存" });
  };
  const complete = (ids: string[], label: string) => {
    actions.completeReminders(ids);
    toast({ message: label, action: { label: "撤销", onClick: () => ids.forEach((id) => actions.toggleReminder(id)) }, seconds: 10, countdown: true });
  };
  const remove = (ids: string[], label: string) => {
    const removed = actions.deleteReminders(ids);
    setEditing(null);
    toast({ message: label, action: { label: "撤销", onClick: () => actions.restoreReminders(removed) }, seconds: 10, countdown: true });
  };
  const edit = (r: Reminder) => setEditing({ id: r.id, title: r.title, trigger: r.trigger, at: r.at ?? nextHalfHour(now), showOnDevice: r.showOnDevice, deviceText: r.deviceText ?? "" });
  // 移到今天：定时待办必须先选新时间；只有收工后触发的可以直接移
  const askMove = (rs: Reminder[]) => {
    if (rs.every((r) => r.trigger === "afterOffwork")) {
      actions.moveRemindersToToday(rs.map((r) => r.id));
      toast({ message: `${rs.length} 条已移到今天` });
    } else {
      setMoving({ ids: rs.map((r) => r.id), at: nextHalfHour(now) });
    }
  };
  const doMove = () => {
    if (!moving) return;
    actions.moveRemindersToToday(moving.ids, moving.at);
    toast({ message: `已移到今天，${moving.at} 提醒` });
    setMoving(null);
  };

  const dayLabel = (r: Reminder) => (r.day === today ? "今天" : r.day === yesterday ? "昨天" : `${Number(r.day.slice(5, 7))} 月 ${Number(r.day.slice(8))} 日`);
  const desc = (r: Reminder) => [
    r.trigger === "afterOffwork" ? "收工后提醒" : `${dayLabel(r)} ${r.at}`,
    r.showOnDevice ? (r.deviceText ? `设备显示“${r.deviceText}”` : "在设备上显示") : "桌牌不显示正文",
    ...(r.createdBy === "voice" ? ["语音创建"] : []),
  ].join(" · ");
  const lead = (r: Reminder) => (
    <Tile color={r.createdBy === "voice" ? "pink" : r.trigger === "afterOffwork" ? "violet" : "orange"}>
      {r.createdBy === "voice" ? <Mic /> : r.trigger === "afterOffwork" ? <Moon /> : <Bell />}
    </Tile>
  );
  const titleOf = (r: Reminder) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
      {r.day === today && (overdue(r) ? <span className="badge b-warn">已过时间</span> : r === next ? <span className="badge b-new">下一条</span> : r.trigger === "afterOffwork" && r.firedAt ? <span className="badge b-warn">已提醒</span> : null)}
    </span>
  );
  // 行内控件不触发整行的“编辑”
  const stop = (e: MouseEvent) => e.stopPropagation();

  const todayRow = (r: Reminder) => (
    <RowItem key={r.id} lead={lead(r)} title={titleOf(r)} desc={desc(r)} onClick={() => edit(r)}
      meta={
        <div className="row" style={{ gap: 4 }} onClick={stop}>
          {r.trigger === "time" && <input className="input num" type="time" value={r.at} onChange={(e) => e.target.value && actions.updateReminder(r.id, { at: e.target.value })} style={{ width: 96, padding: "5px 8px", fontSize: 12.5 }} aria-label="修改提醒时间" title="直接改提醒时间" />}
          <button className="btn btn-secondary btn-sm" onClick={() => complete([r.id], `已完成“${r.title}”`)}><Check />完成</button>
          <button className="icon-btn" aria-label="删除" onClick={() => remove([r.id], `已删除“${r.title}”`)}><Trash2 className="i" /></button>
        </div>
      } />
  );
  const leftoverRow = (r: Reminder) => (
    <RowItem key={r.id} lead={lead(r)} title={titleOf(r)} desc={desc(r)} onClick={() => edit(r)}
      meta={
        <div className="row" style={{ gap: 4 }} onClick={stop}>
          <button className="btn btn-ghost btn-sm" onClick={() => askMove([r])}><ArrowRight />移到今天</button>
          <button className="btn btn-secondary btn-sm" onClick={() => complete([r.id], `已完成“${r.title}”`)}><Check />完成</button>
          <button className="icon-btn" aria-label="删除" onClick={() => remove([r.id], `已删除“${r.title}”`)}><Trash2 className="i" /></button>
        </div>
      } />
  );

  const summary = todayOpen.length === 0
    ? leftover.length ? `今天的待办都处理完了，还有 ${leftover.length} 条昨天遗留。` : "今天的待办都处理完了。"
    : `今天还有 ${todayOpen.length} 条待办${next ? `，下一条 ${next.at}「${next.title}」` : ""}${leftover.length ? `；另有 ${leftover.length} 条昨天遗留` : ""}。`;

  return (
    <>
      <PageHeader title="待办与提醒" desc={summary} />
      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader title="昨天遗留" count={leftover.length} icon={<Tile color="violet" size={30}><History /></Tile>}
              extra={leftover.length > 0 && <>
                <button className="btn btn-ghost btn-sm" onClick={() => askMove(leftover)}><ArrowRight />全部移到今天</button>
                <button className="btn btn-ghost btn-sm" onClick={() => complete(leftover.map((r) => r.id), `${leftover.length} 条遗留已完成`)}><Check />全部完成</button>
              </>} />
            {leftover.length === 0
              ? <EmptyState icon={<History />} title="没有遗留内容" desc="昨天没处理完的待办会出现在这里，处理完就不会留到下一天。" />
              : <>
                  {leftover.map(leftoverRow)}
                  <p className="hint" style={{ margin: 0, padding: "10px 22px 14px" }}>昨天没完成的待办会留在这里，不会自动删除。移到今天后重新参与到点提醒。</p>
                </>}
          </Card>
          <Card>
            <CardHeader title="待处理" count={todayOpen.length} />
            {todayOpen.length === 0
              ? <EmptyState icon={<Check />} title="都处理完了" desc="新的待办可以在右侧创建，或点右下角用一句话创建。" action={<button className="btn btn-primary btn-sm" onClick={() => titleRef.current?.focus()}><Plus />新建待办</button>} />
              : todayOpen.map(todayRow)}
          </Card>
          {done.length > 0 && (
            <Card>
              <CardHeader title="已完成" count={done.length}
                extra={<button className="btn btn-ghost btn-sm" onClick={() => remove(done.map((r) => r.id), `已清空 ${done.length} 条已完成`)}><Trash2 />清空</button>} />
              {done.map((r) => (
                <RowItem key={r.id} className="stale" lead={<Tile color="green"><Check /></Tile>} title={<s style={{ textDecorationColor: "var(--ink-3)" }}>{r.title}</s>} desc={r.trigger === "afterOffwork" ? "收工后提醒" : `${dayLabel(r)} ${r.at}`}
                  meta={
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => actions.toggleReminder(r.id)}><Undo2 />恢复</button>
                      <button className="icon-btn" aria-label="删除" onClick={() => remove([r.id], `已删除“${r.title}”`)}><Trash2 className="i" /></button>
                    </div>
                  } />
              ))}
              <p className="hint" style={{ margin: 0, padding: "10px 22px 14px" }}>已完成的待办会在明天自动清除。</p>
            </Card>
          )}
        </div>
        <div className="stack">
          <Card>
            <CardHeader title="新建待办" />
            <div className="card-b form">
              <ReminderFields d={draft} set={(p) => setDraft((x) => ({ ...x, ...p }))} now={now} offAt={offAt} offworkToday={s.offworkToday} connected={connected} titleRef={titleRef} onEnter={add} />
              <button className="btn btn-primary" onClick={add}><Plus />创建</button>
            </div>
          </Card>
        </div>
      </div>

      {moving && (
        <Modal title={`移到今天的 ${moving.ids.length} 条待办`} onClose={() => setMoving(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setMoving(null)}>取消</button>
            <button className="btn btn-primary" onClick={doMove}>移动并设为 {moving.at}</button>
          </>}>
          <div className="form">
            <label>新的提醒时间
              <input className="input" type="time" value={moving.at} autoFocus onChange={(e) => setMoving((m) => (m ? { ...m, at: e.target.value } : m))} />
            </label>
            {atToday(moving.at, now) <= now
              ? <span className="hint" style={{ color: "#B7791F", fontWeight: 500 }}>这个时间今天已经过了，移过去会立即提醒。</span>
              : <span className="hint">昨天的提醒时间已失效，需要重新选一个今天的时间。</span>}
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="编辑待办" onClose={() => setEditing(null)}
          footer={<>
            <button className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => remove([editing.id], `已删除“${editing.title}”`)}><Trash2 />删除</button>
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>取消</button>
            <button className="btn btn-primary" onClick={save}>保存</button>
          </>}>
          <div className="form">
            <ReminderFields d={editing} set={(p) => setEditing((x) => (x ? { ...x, ...p } : x))} now={now} offAt={offAt} offworkToday={s.offworkToday} connected={connected} onEnter={save} />
          </div>
        </Modal>
      )}
    </>
  );
}
