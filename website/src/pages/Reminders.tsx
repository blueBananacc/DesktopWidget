import { useRef, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { ArrowRight, Bell, Check, History, Mic, Moon, Plus, Trash2, Undo2, Unplug } from "lucide-react";
import { useStore } from "../store/AppStore";
import type { DeviceTodo } from "../device/protocol";
import type { ReminderTrigger } from "../domain/types";
import { atToday, dateKey, hhmm, startOfDay } from "../domain/time";
import { scheduleForDay, sortedNodes } from "../domain/schedule";
import { Banner, Card, CardHeader, EmptyState, Modal, PageHeader, RowItem, Segmented, SettingRow, Tile, Toggle } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

/** 设备屏一行可显示的字数上限（128px 宽、12px 中文字体） */
const DEVICE_TEXT_MAX = 10;

interface Draft {
  title: string;
  trigger: ReminderTrigger;
  at: string; // HH:mm，trigger==="time" 时必填
  showOnDevice: boolean;
}

/** 下一个整半点，作为新建待办的默认时间 */
const nextHalfHour = (now: number) => hhmm(Math.ceil((now + 60_000) / 1_800_000) * 1_800_000);

/** 新建与编辑共用的字段：内容 / 触发 / 时间快捷项 / 设备显示与预览 */
function ReminderFields({ d, set, now, offAt, offworkToday, titleRef, onEnter }: {
  d: Draft; set: (p: Partial<Draft>) => void; now: number; offAt?: string; offworkToday: boolean;
  titleRef?: RefObject<HTMLInputElement | null>; onEnter?: () => void;
}) {
  const quick = [
    { label: "30 分钟后", at: hhmm(now + 30 * 60_000) },
    { label: "1 小时后", at: hhmm(now + 60 * 60_000) },
    ...(offAt ? [{ label: "收工前 15 分钟", at: hhmm(atToday(offAt, now) - 15 * 60_000) }] : []),
  ].filter((q) => atToday(q.at, now) > now && atToday(q.at, now) < startOfDay(now) + 86_400_000);
  const passed = d.trigger === "time" && atToday(d.at, now) <= now;
  const screenText = d.showOnDevice ? d.title.trim() || "待办内容" : "有 1 条待办";
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
          {passed && <span className="hint" style={{ color: "#B7791F", fontWeight: 500 }}>这个时间今天已经过了，保存后设备会立即提醒。</span>}
        </div>
      ) : (
        <span className="hint" style={{ fontWeight: 500 }}>{offworkToday ? "今天已收工，保存后设备会立即提醒。" : "进入“已下班”状态时提醒，适合下班路上要办的事。"}</span>
      )}
      <SettingRow title="在设备上显示" desc="关闭时设备只提示“有 1 条待办”，正文不上屏"><Toggle checked={d.showOnDevice} onChange={(showOnDevice) => set({ showOnDevice })} /></SettingRow>
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
          待办存在设备上：到点屏幕显示 15 秒、灯光闪烁 3 秒，按任意键关闭；网页关闭也会提醒。
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
  const blank = (): Draft => ({ title: "", trigger: "time", at: nextHalfHour(Date.now()), showOnDevice: s.settings.showReminderOnDevice });
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null);
  const [moving, setMoving] = useState<{ ids: string[]; at: string } | null>(null);

  const todayStart = startOfDay(now);
  const sched = scheduleForDay(s.schedules, s.activeScheduleId, now);
  const offAt = sched ? sortedNodes(sched).find((n) => n.status === "off")?.time : undefined;

  // 视图分组（事实源是 deviceTodos）：定时待办 at<今天 = 昨天遗留；收工后/无定时的一直待在待处理直到触发
  const todos = s.deviceTodos;
  const isLeftover = (t: DeviceTodo) => !t.done && t.trig !== "offwork" && t.at !== undefined && t.at < todayStart;
  const leftover = todos.filter(isLeftover).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const todayOpen = todos.filter((t) => !t.done && !isLeftover(t)).sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));
  const done = todos.filter((t) => t.done);
  const overdue = (t: DeviceTodo) => t.trig !== "offwork" && t.at !== undefined && t.at < now;
  const next = todayOpen.find((t) => t.trig !== "offwork" && t.at !== undefined && !overdue(t));

  const needConn = () => { if (!connected) toast({ message: "待办存在设备上——先连接设备再操作" }); return !connected; };

  const add = () => {
    if (!draft.title.trim()) { toast({ message: "先填写待办内容" }); titleRef.current?.focus(); return; }
    if (needConn()) return;
    actions.deviceTodoAdd({
      text: draft.title.trim(),
      at: draft.trigger === "time" ? atToday(draft.at, now) : undefined,
      trig: draft.trigger === "afterOffwork" ? "offwork" : undefined,
      show: draft.showOnDevice,
    });
    toast({ message: draft.trigger === "time" ? `已创建，${draft.at} 提醒` : "已创建，收工后提醒" });
    setDraft({ ...blank(), trigger: draft.trigger, showOnDevice: draft.showOnDevice });
    titleRef.current?.focus();
  };
  const save = () => {
    if (!editing) return;
    if (!editing.title.trim()) { toast({ message: "待办内容不能为空" }); return; }
    actions.deviceTodoSet(editing.id, {
      text: editing.title.trim(),
      trig: editing.trigger === "afterOffwork" ? "offwork" : "at",
      at: editing.trigger === "time" ? atToday(editing.at, now) : -1,
      show: editing.showOnDevice,
    });
    setEditing(null);
    toast({ message: "已保存" });
  };
  const complete = (ids: string[], label: string) => {
    if (needConn()) return;
    ids.forEach((id) => actions.deviceTodoDone(id));
    toast({ message: label, action: { label: "撤销", onClick: () => ids.forEach((id) => actions.deviceTodoDone(id, false)) }, seconds: 10, countdown: true });
  };
  const remove = (ids: string[], label: string) => {
    if (needConn()) return;
    const removed = ids.map((id) => todos.find((t) => t.id === id)).filter((t): t is DeviceTodo => !!t);
    ids.forEach((id) => actions.deviceTodoDel(id));
    setEditing(null);
    // 撤销 = 重发 add（设备会发新 id，内容一样）
    toast({ message: label, action: { label: "撤销", onClick: () => removed.forEach((t) => actions.deviceTodoAdd({ text: t.text, at: t.trig === "offwork" ? undefined : t.at, trig: t.trig, show: t.show })) }, seconds: 10, countdown: true });
  };
  const edit = (t: DeviceTodo) => {
    if (needConn()) return;
    setEditing({ id: t.id, title: t.text, trigger: t.trig === "offwork" ? "afterOffwork" : "time", at: t.at !== undefined ? hhmm(t.at) : nextHalfHour(now), showOnDevice: t.show !== false });
  };
  // 移到今天：昨天遗留的定时待办重选一个今天的时间
  const askMove = (ts: DeviceTodo[]) => setMoving({ ids: ts.map((t) => t.id), at: nextHalfHour(now) });
  const doMove = () => {
    if (!moving || !connected) return;
    moving.ids.forEach((id) => actions.deviceTodoSet(id, { at: atToday(moving.at, now) }));
    toast({ message: `已移到今天，${moving.at} 提醒` });
    setMoving(null);
  };

  const dayLabel = (t: number) => {
    const dk = dateKey(t), today = dateKey(now), yesterday = dateKey(todayStart - 1);
    return dk === today ? "今天" : dk === yesterday ? "昨天" : `${Number(dk.slice(5, 7))} 月 ${Number(dk.slice(8))} 日`;
  };
  const desc = (t: DeviceTodo) => [
    t.trig === "offwork" ? "收工后提醒" : t.at !== undefined ? `${dayLabel(t.at)} ${hhmm(t.at)}` : "无定时",
    t.show === false ? "桌牌不显示正文" : "在设备上显示",
    ...(t.src === "voice" ? ["语音创建"] : []),
  ].join(" · ");
  const lead = (t: DeviceTodo) => (
    <Tile color={t.src === "voice" ? "pink" : t.trig === "offwork" ? "violet" : "orange"}>
      {t.src === "voice" ? <Mic /> : t.trig === "offwork" ? <Moon /> : <Bell />}
    </Tile>
  );
  const titleOf = (t: DeviceTodo) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.text}</span>
      {t.trig !== "offwork" && t.at !== undefined && (overdue(t) ? <span className="badge b-warn">已过时间</span> : t === next ? <span className="badge b-new">下一条</span> : null)}
    </span>
  );
  // 行内控件不触发整行的“编辑”
  const stop = (e: MouseEvent) => e.stopPropagation();

  const todayRow = (t: DeviceTodo) => (
    <RowItem key={t.id} lead={lead(t)} title={titleOf(t)} desc={desc(t)} onClick={() => edit(t)}
      meta={
        <div className="row" style={{ gap: 4 }} onClick={stop}>
          {t.trig !== "offwork" && t.at !== undefined && <input className="input num" type="time" value={hhmm(t.at)} onChange={(e) => e.target.value && actions.deviceTodoSet(t.id, { at: atToday(e.target.value, now) })} style={{ width: 96, padding: "5px 8px", fontSize: 12.5 }} aria-label="修改提醒时间" title="直接改提醒时间" />}
          <button className="btn btn-secondary btn-sm" onClick={() => complete([t.id], `已完成“${t.text}”`)}><Check />完成</button>
          <button className="icon-btn" aria-label="删除" onClick={() => remove([t.id], `已删除“${t.text}”`)}><Trash2 className="i" /></button>
        </div>
      } />
  );
  const leftoverRow = (t: DeviceTodo) => (
    <RowItem key={t.id} lead={lead(t)} title={titleOf(t)} desc={desc(t)} onClick={() => edit(t)}
      meta={
        <div className="row" style={{ gap: 4 }} onClick={stop}>
          <button className="btn btn-ghost btn-sm" onClick={() => askMove([t])}><ArrowRight />移到今天</button>
          <button className="btn btn-secondary btn-sm" onClick={() => complete([t.id], `已完成“${t.text}”`)}><Check />完成</button>
          <button className="icon-btn" aria-label="删除" onClick={() => remove([t.id], `已删除“${t.text}”`)}><Trash2 className="i" /></button>
        </div>
      } />
  );

  const summary = todayOpen.length === 0
    ? leftover.length ? `今天的待办都处理完了，还有 ${leftover.length} 条昨天遗留。` : "今天的待办都处理完了。"
    : `今天还有 ${todayOpen.length} 条待办${next ? `，下一条 ${next.at !== undefined ? hhmm(next.at) : ""}「${next.text}」` : ""}${leftover.length ? `；另有 ${leftover.length} 条昨天遗留` : ""}。`;

  return (
    <>
      <PageHeader title="待办与提醒" desc={summary} />
      {!connected && <Banner tone="warn" icon={<Unplug />}>待办的事实源在设备上：现在显示的是上次同步的镜像。连接设备后才能新建/编辑/完成。</Banner>}
      <div className="cols">
        <div className="stack">
          {leftover.length > 0 && (
            <Card>
              <CardHeader title="昨天遗留" count={leftover.length} icon={<Tile color="violet" size={30}><History /></Tile>}
                extra={<>
                  <button className="btn btn-ghost btn-sm" onClick={() => askMove(leftover)}><ArrowRight />全部移到今天</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => complete(leftover.map((t) => t.id), `${leftover.length} 条遗留已完成`)}><Check />全部完成</button>
                </>} />
              {leftover.map(leftoverRow)}
              <p className="hint" style={{ margin: 0, padding: "10px 22px 14px" }}>昨天没完成的待办会留在这里，不会自动删除。移到今天后重新参与到点提醒。</p>
            </Card>
          )}
          <Card>
            <CardHeader title="待处理" count={todayOpen.length} />
            {todayOpen.length === 0
              ? <EmptyState icon={<Check />} title="都处理完了" desc={connected ? "新的待办可以在右侧创建，或对牌面说话让 Agent 建。" : "连接设备后可创建待办，也能看到设备上已有的。"} action={connected ? <button className="btn btn-primary btn-sm" onClick={() => titleRef.current?.focus()}><Plus />新建待办</button> : undefined} />
              : todayOpen.map(todayRow)}
          </Card>
          {done.length > 0 && (
            <Card>
              <CardHeader title="已完成" count={done.length}
                extra={<button className="btn btn-ghost btn-sm" onClick={() => remove(done.map((t) => t.id), `已清空 ${done.length} 条已完成`)}><Trash2 />清空</button>} />
              {done.map((t) => (
                <RowItem key={t.id} className="stale" lead={<Tile color="green"><Check /></Tile>} title={<s style={{ textDecorationColor: "var(--ink-3)" }}>{t.text}</s>} desc={desc(t)}
                  meta={
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => connected && actions.deviceTodoDone(t.id, false)}><Undo2 />恢复</button>
                      <button className="icon-btn" aria-label="删除" onClick={() => remove([t.id], `已删除“${t.text}”`)}><Trash2 className="i" /></button>
                    </div>
                  } />
              ))}
              <p className="hint" style={{ margin: 0, padding: "10px 22px 14px" }}>已完成的待办会在明天自动清除（设备跨天时清理）。</p>
            </Card>
          )}
        </div>
        <div className="stack">
          <Card>
            <CardHeader title="新建待办" extra={<span className="hint">存到设备</span>} />
            <div className="card-b form">
              <ReminderFields d={draft} set={(p) => setDraft((x) => ({ ...x, ...p }))} now={now} offAt={offAt} offworkToday={s.offworkToday} titleRef={titleRef} onEnter={add} />
              <button className="btn btn-primary" disabled={!connected} onClick={add}><Plus />创建</button>
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
            <ReminderFields d={editing} set={(p) => setEditing((x) => (x ? { ...x, ...p } : x))} now={now} offAt={offAt} offworkToday={s.offworkToday} onEnter={save} />
          </div>
        </Modal>
      )}
    </>
  );
}
