import { useState } from "react";
import { CalendarX2, ChevronLeft, ChevronRight, Download, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { useStore } from "../store/AppStore";
import { SOURCE_LABEL, STATUSES, STATUS_ORDER } from "../domain/statuses";
import type { StatusId, StatusSegment } from "../domain/types";
import { dateKey, duration, hhmm, pad, weekday } from "../domain/time";
import { DAY_MS, TRACKED, dayBounds, keyToTs, lastDays, totalsForSegments, trackedSum, unrecordedMs, type Totals } from "../domain/review";
import { Banner, Card, CardHeader, EmptyState, Modal, PageHeader, Segmented, StatusChip } from "../ui/Primitives";
import { WeekBars } from "../ui/WeekBars";
import { useToast } from "../ui/Toast";

type Range = "7" | "30";

const minOfDay = (ts: number) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };
const fmtMin = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m) % 60)}`;
/** 区间结束在当天的分钟数；跨过午夜按 24:00 算 */
const endMinRaw = (g: StatusSegment, day: string, now: number) => (g.end && dateKey(g.end) !== day ? 24 * 60 : minOfDay(g.end ?? now));
const pct = (v: number, all: number) => (all ? Math.round((v / all) * 100) : 0);
const dayTitle = (key: string, todayKey: string) => {
  const ts = keyToTs(key);
  const d = new Date(ts);
  const rel = key === todayKey ? "今天 · " : key === dateKey(keyToTs(todayKey) - DAY_MS) ? "昨天 · " : "";
  return `${rel}${d.getMonth() + 1} 月 ${d.getDate()} 日 ${weekday(ts)}`;
};

export function ReviewPage() {
  const { s, now, device, actions } = useStore();
  const toast = useToast();
  const todayKey = dateKey(now);
  const connected = device.state === "connected";
  const [range, setRange] = useState<Range>("7");
  const [day, setDay] = useState(todayKey);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const days = Number(range);

  const segsOf = (key: string): StatusSegment[] => (key === todayKey ? s.segments : s.historySegments[key] ?? []);
  const totalsOf = (key: string): Totals => (key === todayKey ? totalsForSegments(s.segments, now) : s.history[key] ?? {});

  /* ---- 区间汇总 ---- */
  const keys = lastDays(now, days).map((d) => d.key);
  const summary = (() => {
    const t: Totals = {};
    let recorded = 0;
    const starts: number[] = [];
    const offs: number[] = [];
    for (const k of keys) {
      const dt = totalsOf(k);
      if (!trackedSum(dt)) continue;
      recorded++;
      for (const id of TRACKED) t[id] = (t[id] ?? 0) + (dt[id] ?? 0);
      if (k === todayKey) continue; // 今天还没过完，不计入平均开始/收工
      const b = dayBounds(segsOf(k));
      if (b.first !== undefined) starts.push(minOfDay(b.first));
      if (b.offAt !== undefined) offs.push(minOfDay(b.offAt));
    }
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
    return { t, all: trackedSum(t), recorded, avgStart: avg(starts), avgOff: avg(offs) };
  })();

  /* ---- 选中日详情 ---- */
  const segs = segsOf(day);
  const dayTotals = totalsOf(day);
  const dayAll = trackedSum(dayTotals);
  const bounds = dayBounds(segs);
  const isToday = day === todayKey;
  const oldest = keys[0];
  const step = (dir: -1 | 1) => {
    const next = dateKey(keyToTs(day) + dir * DAY_MS);
    if (next > todayKey) return;
    setDay(next);
    if (next < oldest) setRange("30");
  };
  const canPrev = dateKey(keyToTs(day) - DAY_MS) >= lastDays(now, 30)[0].key;

  /* 时间轴范围：默认 07–21 点，数据超出时向外扩到整点 */
  const lastOff = (g: StatusSegment) => g.status === "off" && g === segs.at(-1);
  const lo = Math.min(7 * 60, ...segs.map((g) => Math.floor(minOfDay(g.start) / 60) * 60));
  const hi = Math.max(21 * 60, ...segs.filter((g) => !lastOff(g)).map((g) => Math.ceil(endMinRaw(g, day, now) / 60) * 60));
  const pos = (m: number) => ((Math.min(hi, Math.max(lo, m)) - lo) / (hi - lo)) * 100;
  const tickStep = hi - lo > 16 * 60 ? 3 : 2;
  const ticks = Array.from({ length: Math.floor((hi - lo) / 60 / tickStep) + 1 }, (_, i) => lo / 60 + i * tickStep);

  const exportCsv = () => {
    const rows = [["日期", "开始", "结束", "状态", "时长(分钟)", "来源"]];
    for (const k of keys) for (const g of segsOf(k)) rows.push([k, hhmm(g.start), g.end ? hhmm(g.end) : "进行中", STATUSES[g.status].label, String(Math.round(((g.end ?? now) - g.start) / 60_000)), SOURCE_LABEL[g.source]]);
    const blob = new Blob(["\uFEFF" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `收工牌-状态回顾-${keys[0]}_${todayKey}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ message: `已导出最近 ${days} 天的记录` });
  };

  return (
    <>
      <PageHeader
        title="状态回顾"
        desc="只统计你设置的状态区间，不代表实际工作时长或效率；未记录的时段不会被推断。"
        actions={
          <>
            <Segmented<Range> value={range} options={[{ value: "7", label: "最近 7 天" }, { value: "30", label: "最近 30 天" }]} onChange={setRange} />
            <button className="btn btn-secondary btn-sm" onClick={exportCsv}><Download />导出 CSV</button>
          </>
        }
      />

      <div className="review">
        {/* ---------- 趋势 + 区间分布 ---------- */}
        <Card>
          <CardHeader title={`最近 ${days} 天`} extra={<span className="hint">点击柱子查看当天详情</span>} />
          <div className="card-b review-trend">
            <div>
              <WeekBars history={s.history} segments={s.segments} now={now} todayKey={todayKey} days={days} selected={day} onSelect={setDay} height={180} />
            </div>
            <div className="review-sum">
              <div className="review-kpis">
                <div><span>有记录</span><b>{summary.recorded}<small> / {days} 天</small></b></div>
                <div><span>日均有状态</span><b>{summary.recorded ? duration(summary.all / summary.recorded) : "—"}</b></div>
                <div><span>平均开始</span><b className="num">{summary.avgStart !== undefined ? fmtMin(summary.avgStart) : "—"}</b></div>
                <div><span>平均收工</span><b className="num">{summary.avgOff !== undefined ? fmtMin(summary.avgOff) : "—"}</b></div>
              </div>
              <div className="share-bar" aria-hidden>
                {TRACKED.map((id) => (summary.t[id] ? <i key={id} style={{ flex: summary.t[id], background: STATUSES[id].color }} /> : null))}
              </div>
              <ul className="share-list">
                {TRACKED.map((id) => (
                  <li key={id}>
                    <StatusChip id={id} />
                    <span className="num">{duration(summary.t[id] ?? 0)}</span>
                    <span className="hint">{pct(summary.t[id] ?? 0, summary.all)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        {/* ---------- 某天详情 ---------- */}
        <Card>
          <div className="card-h">
            <h3 className="day-nav">
              <button className="icon-btn" onClick={() => step(-1)} disabled={!canPrev} aria-label="前一天"><ChevronLeft /></button>
              <span>{dayTitle(day, todayKey)}</span>
              <button className="icon-btn" onClick={() => step(1)} disabled={isToday} aria-label="后一天"><ChevronRight /></button>
            </h3>
            <div className="row" style={{ gap: 8 }}>
              {!isToday && <button className="btn btn-ghost btn-sm" onClick={() => setDay(todayKey)}>回到今天</button>}
              {!isToday && segs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}><Trash2 />删除这天</button>}
            </div>
          </div>

          {isToday && !connected && (
            <div className="card-b" style={{ paddingBottom: 0 }}>
              <Banner icon={<Unplug />}>
                <b>设备未连接</b>
                今天的记录以设备为准，这里显示的是最后一次同步的结果{device.lastSyncAt ? `（${hhmm(device.lastSyncAt)}）` : ""}。
              </Banner>
            </div>
          )}

          {segs.length === 0 ? (
            <EmptyState icon={<CalendarX2 />} title="这一天没有记录" desc="设备没通电或没有同步时，不会推断你的状态。" />
          ) : (
            <>
              <div className="card-b day-body">
                <div className="day-stats">
                  {TRACKED.filter((id) => dayTotals[id]).map((id) => (
                    <div key={id} className="day-stat" style={{ ["--c" as string]: STATUSES[id].color }}>
                      <span>{STATUSES[id].label}</span>
                      <b>{duration(dayTotals[id] ?? 0)}</b>
                      <small>{pct(dayTotals[id] ?? 0, dayAll)}%</small>
                    </div>
                  ))}
                  <div className="day-stat muted">
                    <span>未记录</span>
                    <b>{duration(unrecordedMs(segs))}</b>
                    <small>切换 {Math.max(0, segs.length - 1)} 次</small>
                  </div>
                </div>

                <div className="day-meta">
                  <span>开始 <b className="num">{bounds.first !== undefined ? hhmm(bounds.first) : "—"}</b></span>
                  <span>收工 <b className="num">{bounds.offAt !== undefined ? hhmm(bounds.offAt) : isToday ? "尚未收工" : "未记录"}</b></span>
                  <span>有状态 <b>{duration(dayAll)}</b></span>
                </div>

                <div>
                  <div className="tl tl-day">
                    {segs.map((g, i) => {
                      const a = pos(minOfDay(g.start));
                      const b = pos(lastOff(g) ? hi : endMinRaw(g, day, now));
                      if (b - a <= 0) return null;
                      return (
                        <div key={`${g.start}-${i}`} style={{ left: `${a}%`, width: `${b - a}%`, background: STATUSES[g.status].color }} title={`${hhmm(g.start)}–${g.end ? hhmm(g.end) : "现在"} ${STATUSES[g.status].label}`}>
                          {b - a > 7 ? STATUSES[g.status].label : ""}
                        </div>
                      );
                    })}
                    {isToday && <span className="now" style={{ left: `${pos(minOfDay(now))}%` }} />}
                  </div>
                  <div className="hours tl-hours">
                    {ticks.map((h) => <span key={h} style={{ left: `${pos(h * 60)}%` }}>{pad(h % 24)}:00</span>)}
                  </div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>时间</th><th>状态</th><th>时长</th><th>来源</th><th>修正</th></tr></thead>
                  <tbody>
                    {segs.map((g, i) => {
                      const gap = i && segs[i - 1].end ? g.start - segs[i - 1].end! : 0;
                      return [
                        gap > 60_000 && (
                          <tr key={`gap-${i}`} className="gap-row">
                            <td className="num">{hhmm(segs[i - 1].end!)} – {hhmm(g.start)}</td>
                            <td><span className="chip unknown">未记录</span></td>
                            <td>{duration(gap)}</td>
                            <td className="hint" colSpan={2}>设备未记录，不做推断</td>
                          </tr>
                        ),
                        <tr key={`${g.start}-${i}`}>
                          <td className="num">{hhmm(g.start)} – {g.end ? hhmm(g.end) : "现在"}</td>
                          <td><StatusChip id={g.status} /></td>
                          <td>{duration((g.end ?? now) - g.start)}</td>
                          <td className="hint">{SOURCE_LABEL[g.source]}</td>
                          <td>
                            <select className="input input-sm" value={g.status} onChange={(e) => actions.editSegment(i, e.target.value as StatusId, day)} aria-label="修正状态">
                              {STATUS_ORDER.map((id) => <option key={id} value={id}>{STATUSES[id].label}</option>)}
                            </select>
                          </td>
                        </tr>,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              {isToday && <div className="card-b" style={{ paddingTop: 12 }}><div className="hint">今天的修正只在网页生效，下次与设备同步时会以设备记录为准。</div></div>}
            </>
          )}
        </Card>

        <div className="disclaimer"><ShieldCheck />历史数据只保存在本机浏览器（最多 90 天），不会上传，也不会给任何人做排名。</div>
      </div>

      {confirmDelete && (
        <Modal
          title="删除这一天的记录？"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>取消</button>
              <button className="btn btn-danger" onClick={() => { actions.deleteDay(day); setConfirmDelete(false); toast({ message: `已删除 ${day} 的记录` }); }}><Trash2 />删除</button>
            </>
          }
        >
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>{dayTitle(day, todayKey)} 的 {segs.length} 段状态记录会从本机删除，无法恢复。</p>
        </Modal>
      )}
    </>
  );
}
