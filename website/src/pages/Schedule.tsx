import { useState } from "react";
import { CalendarDays, Copy, Pencil, Plus, Trash2, Pause, Play, TriangleAlert, Unplug } from "lucide-react";
import { useStore } from "../store/AppStore";
import { allStatusIds, isKnownStatus, statusMeta } from "../domain/statuses";
import type { Schedule, StatusId } from "../domain/types";
import { WEEK_SHORT, dateKey, hhmm, toMinutes, uid } from "../domain/time";
import { conflicts, currentNode, nextNode, scheduleForDay, sortedNodes } from "../domain/schedule";
import { Banner, Card, CardHeader, Modal, PageHeader, Segmented, StatusChip, Tile } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

const DAY_START = 7 * 60;
const DAY_END = 21 * 60;

function Timeline({ schedule, now, showNow }: { schedule: Schedule; now: number; showNow: boolean }) {
  const nodes = sortedNodes(schedule);
  const pct = (m: number) => ((Math.min(DAY_END, Math.max(DAY_START, m)) - DAY_START) / (DAY_END - DAY_START)) * 100;
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  return (
    <div>
      <div className="tl">
        {nodes.map((n, i) => {
          const start = pct(toMinutes(n.time));
          const end = pct(nodes[i + 1] ? toMinutes(nodes[i + 1].time) : DAY_END);
          return (
            <div key={n.id} style={{ left: `${start}%`, width: `${end - start}%`, background: statusMeta(n.status).color }} title={`${n.time} ${statusMeta(n.status).label}`}>
              {end - start > 6 ? statusMeta(n.status).label : ""}
            </div>
          );
        })}
        {showNow && nowMin > DAY_START && nowMin < DAY_END && (
          <span className={`now${pct(nowMin) < 8 ? " edge-l" : pct(nowMin) > 92 ? " edge-r" : ""}`} data-label={hhmm(now)} style={{ left: `${pct(nowMin)}%` }} />
        )}
      </div>
      <div className="hours">{[7, 9, 11, 13, 15, 17, 19, 21].map((h) => <span key={h}>{String(h).padStart(2, "0")}:00</span>)}</div>
    </div>
  );
}

const bytes = (x: string) => new TextEncoder().encode(x).length;

function Editor({ initial, onClose }: { initial: Schedule; onClose: () => void }) {
  const { actions, s } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Schedule>(initial);
  const dup = conflicts(draft);
  const patchNode = (id: string, patch: Partial<Schedule["nodes"][number]>) => setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  // 固件字段定长：name≤24B、note≤16B、ns≤20；超限保存会被设备截断
  const over = bytes(draft.name) > 24 || draft.nodes.length > 20 || draft.nodes.some((n) => bytes(n.note ?? "") > 16);
  const valid = draft.name.trim() && draft.nodes.length > 0 && !over && (draft.kind === "date" ? !!draft.date : draft.weekdays.length > 0);
  return (
    <Modal
      title={initial.nodes.length ? "编辑计划表" : "新建计划表"}
      onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={!valid} onClick={() => { actions.saveSchedule(draft); const willRun = draft.kind === "date" ? draft.date === dateKey(Date.now()) : draft.id === s.activeScheduleId; toast({ message: willRun ? "已保存到设备" : "已保存到设备（不是当前生效的计划）" }); onClose(); }}>保存</button>
      </>}
    >
      <div className="form">
        <label>名称<input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：标准工作日" /></label>
        <label>类型
          <Segmented value={draft.kind} options={[{ value: "repeat", label: "重复计划" }, { value: "date", label: "单日计划" }]} onChange={(kind) => setDraft({ ...draft, kind, date: kind === "date" ? draft.date ?? dateKey(Date.now()) : undefined })} />
        </label>
        {draft.kind === "repeat" ? (
          <label>重复
            <div className="row" style={{ gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" className={`day-pill ${draft.weekdays.includes(d) ? "on" : ""}`} onClick={() => setDraft({ ...draft, weekdays: draft.weekdays.includes(d) ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d] })}>{WEEK_SHORT[d]}</button>
              ))}
            </div>
          </label>
        ) : (
          <label>日期（仅当天生效，结束后不重复）<input className="input" type="date" value={draft.date ?? ""} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
        )}
        <div>
          <div className="form-label">状态节点</div>
          {dup.length > 0 && <Banner tone="warn" icon={<TriangleAlert className="i" />}>{dup.join("、")} 有多个节点，将以最后添加的为准。</Banner>}
          {over && <Banner tone="warn" icon={<TriangleAlert className="i" />}>超出设备容量：名称 ≤8 个汉字、节点备注 ≤5 个汉字、节点 ≤20 个。</Banner>}
          {draft.nodes.some((n) => !isKnownStatus(n.status)) && <Banner tone="warn" icon={<TriangleAlert className="i" />}>有节点引用了已删除的状态，该表在修正前不能设为当前计划。</Banner>}
          <div className="node-list">
            {draft.nodes.map((n) => (
              <div key={n.id} className="node-row">
                <input className="input" type="time" value={n.time} onChange={(e) => patchNode(n.id, { time: e.target.value })} />
                <select className="input" value={n.status} onChange={(e) => patchNode(n.id, { status: e.target.value as StatusId })}>
                  {!isKnownStatus(n.status) && <option value={n.status}>{statusMeta(n.status).label}（已删除）</option>}
                  {allStatusIds().map((id) => <option key={id} value={id}>{statusMeta(id).label}</option>)}
                </select>
                <input className="input" placeholder="备注（不会显示在设备上）" value={n.note ?? ""} onChange={(e) => patchNode(n.id, { note: e.target.value })} />
                <button type="button" className="icon-btn" aria-label="删除节点" onClick={() => setDraft((d) => ({ ...d, nodes: d.nodes.filter((x) => x.id !== n.id) }))}><Trash2 className="i" /></button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft((d) => ({ ...d, nodes: [...d.nodes, { id: uid(), time: "09:00", status: "work" }] }))}><Plus />添加节点</button>
        </div>
      </div>
    </Modal>
  );
}

export function SchedulePage() {
  const { s, now, device, actions } = useStore();
  const connected = device.state === "connected";
  const toast = useToast();
  const [editing, setEditing] = useState<Schedule | null>(null);
  const today = scheduleForDay(s.schedules, s.activeScheduleId, now);
  const cur = currentNode(today, now);
  const nn = nextNode(today, now);

  return (
    <>
      <PageHeader
        title="计划表"
        desc="提前安排每个时间点要显示的状态，到点后设备自动切换，不需要打开网页。"
        actions={<button className="btn btn-primary" disabled={!connected || s.schedules.length >= 8} title={!connected ? "计划表存在设备上，连接后才能新建" : s.schedules.length >= 8 ? "最多 8 张计划表（设备容量上限）" : ""} onClick={() => setEditing({ id: uid(), name: "", kind: "repeat", weekdays: [1, 2, 3, 4, 5], nodes: [{ id: uid(), time: "09:00", status: "work" }, { id: uid(), time: "18:00", status: "off" }] })}><Plus />新建计划表</button>}
      />
      {!connected && <Banner tone="warn" icon={<Unplug />}>设备未连接：计划表存在设备上，这里显示的是上次同步的镜像；新建/编辑/复制/删除/切换/暂停都需要连接设备。</Banner>}

      <Card style={{ marginBottom: 20 }}>
        <CardHeader
          icon={<Tile color="violet" size={30}><CalendarDays /></Tile>}
          title={today ? `今天生效：${today.name}` : "今天没有生效的计划表"}
          extra={today && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {!connected && <span className="hint" title="计划表在设备上执行，连接后才能暂停或恢复今日计划" style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "help" }}><Unplug className="i" style={{ width: 13, height: 13 }} />未连接设备</span>}
              {s.pausedToday
                ? <button className="btn btn-primary btn-sm" disabled={!connected} onClick={() => { actions.pauseToday(false); toast({ message: "已恢复今日计划" }); }}><Play />恢复计划</button>
                : <button className="btn btn-secondary btn-sm" disabled={!connected} title={connected ? "" : "计划表在设备上执行，连接后才能暂停或恢复今日计划"} onClick={() => { actions.pauseToday(true); toast({ message: "今日计划已暂停，状态不再自动切换" }); }}><Pause />暂停今日计划</button>}
            </span>
          )}
        />
        <div className="card-b" style={{ display: "grid", gap: 16 }}>
          {today ? <Timeline schedule={today} now={now} showNow /> : <p className="hint">在下方选择一个重复计划，或新建单日计划。</p>}
          <div className="row" style={{ gap: 24 }}>
            <div><div className="hint">当前节点</div><b>{cur ? `${cur.time} ${statusMeta(cur.status).label}` : "—"}</b></div>
            <div><div className="hint">下一次切换</div><b>{nn ? `${nn.time} → ${statusMeta(nn.status).label}` : "今天没有了"}</b></div>
            <div><div className="hint">手动切换时</div><b>{s.settings.overrideMode === "untilNextNode" ? "只覆盖到下一个节点" : "暂停今日计划"}</b></div>
          </div>
          {s.pausedToday && <Banner tone="warn" icon={<Pause className="i" />}>今日计划已暂停，到点不会自动切换状态。</Banner>}
          {s.offworkToday && <Banner tone="info" icon={<CalendarDays className="i" />}>今天已收工，后续计划节点不会再自动切换；手动切回工作不受影响，也会正常记录。</Banner>}
        </div>
      </Card>

      <div className="grid g-cards">
        {s.schedules.map((sc) => {
          const active = sc.kind === "repeat" && sc.id === s.activeScheduleId;
          const isToday = today?.id === sc.id;
          const past = sc.kind === "date" && sc.date && sc.date < dateKey(now);
          const broken = sc.nodes.some((n) => !isKnownStatus(n.status)); // 引用了已删除的状态：不能设为当前计划，设备到点也会跳过
          return (
            <Card key={sc.id} className={past ? "stale" : ""}>
              <CardHeader
                title={sc.name}
                extra={<>
                  {broken && <span className="badge b-warn">含已删除状态</span>}
                  {isToday && <span className="badge b-beta">今天生效</span>}
                  {sc.kind === "date" ? <span className="badge b-new">单日 · {sc.date}</span> : <span className="hint">{[1, 2, 3, 4, 5, 6, 0].filter((d) => sc.weekdays.includes(d)).map((d) => `周${WEEK_SHORT[d]}`).join(" ")}</span>}
                </>}
              />
              <div className="card-b" style={{ display: "grid", gap: 14 }}>
                <Timeline schedule={sc} now={now} showNow={isToday} />
                <div className="row" style={{ gap: 6 }}>
                  {sortedNodes(sc).map((n) => <StatusChip key={n.id} id={n.status}>{n.time} {statusMeta(n.status).label}</StatusChip>)}
                </div>
                {broken && <Banner tone="warn" icon={<TriangleAlert className="i" />}>有节点引用了已删除的状态{isToday ? "，到点不会自动切换" : ""}。请编辑修正后才能使用这张表。</Banner>}
                <div className="row" style={{ justifyContent: "space-between" }}>
                  {sc.kind === "repeat" ? (
                    active ? <span className="hint">当前选中的重复计划</span> : <button className="btn btn-primary btn-sm" disabled={!connected || broken} title={broken ? "包含已删除的状态，请先在编辑中修正" : connected ? "" : "连接设备后才能切换计划"} onClick={() => { actions.setActiveSchedule(sc.id); toast({ message: `已切换为“${sc.name}”` }); }}>设为当前计划</button>
                  ) : <span className="hint">{past ? "已过期" : broken ? "需修正状态才能生效" : sc.date === dateKey(now) ? "今天优先于重复计划" : "到期当天自动生效"}</span>}
                  <div className="row" style={{ gap: 2 }}>
                    <button className="icon-btn" aria-label="编辑" disabled={!connected} title={connected ? "" : "连接设备后才能编辑"} onClick={() => setEditing(sc)}><Pencil className="i" /></button>
                    <button className="icon-btn" aria-label="复制" disabled={!connected || s.schedules.length >= 8} title={!connected ? "连接设备后才能复制" : s.schedules.length >= 8 ? "最多 8 张计划表（设备容量上限）" : ""} onClick={() => { actions.duplicateSchedule(sc.id); toast({ message: "已复制" }); }}><Copy className="i" /></button>
                    <button className="icon-btn" aria-label="删除" disabled={!connected} title={connected ? "" : "连接设备后才能删除"} onClick={() => {
                      const onDevice = sc.kind === "date" ? sc.date === dateKey(now) : sc.id === s.activeScheduleId;
                      const tip = onDevice
                        ? `删除“${sc.name}”？它是当前生效的计划，会从设备上移除。`
                        : `删除“${sc.name}”？会从设备上移除。`;
                      if (confirm(tip)) { actions.deleteSchedule(sc.id); toast({ message: `已删除“${sc.name}”` }); }
                    }}><Trash2 className="i" /></button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {editing && <Editor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
