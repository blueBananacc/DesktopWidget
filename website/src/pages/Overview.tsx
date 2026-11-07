import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, Search, CircleHelp, Monitor, CalendarDays, Sparkles, Mic, Coffee, Plus, Sunset, RotateCcw, Lock, Fingerprint, Gauge, ShieldCheck, Timer, AlarmClock,
} from "lucide-react";
import { useStore } from "../store/AppStore";
import { SOURCE_LABEL, customStatusDefs, keyActionLabel, statusMeta } from "../domain/statuses";
import type { StatusId } from "../domain/types";
import { atToday, clock, dateKey, duration, greeting, hhmm, weekday, ago, startOfDay } from "../domain/time";
import { nextNode, scheduleForDay, sortedNodes } from "../domain/schedule";
import { Card, CardHeader, ConnBadge, Modal, RowItem, Segmented, SettingRow, StatusChip, Tile, UnknownChip, Banner } from "../ui/Primitives";
import { DeviceMirror } from "../ui/DeviceMirror";
import { HoldButton } from "../ui/HoldButton";
import { useToast } from "../ui/Toast";
import { useOffwork } from "../hooks/useOffwork";
import { WeekBars } from "../ui/WeekBars";
import { MinuteChips } from "../ui/MinuteChips";

const PRESETS: { id: StatusId; label?: string; timer?: number }[] = [
  { id: "work" },
  { id: "busy" },
  { id: "meet" },
  { id: "focus", label: "专注 25′", timer: 25 },
  { id: "rest" },
];

export function Overview() {
  const { s, now, device, actions } = useStore();
  const toast = useToast();
  const offwork = useOffwork();
  const [knobOpen, setKnobOpen] = useState(false);
  const meta = statusMeta(s.current.id);
  const connected = device.state === "connected"; // 未连接时网页不能声称知道设备状态
  const sched = scheduleForDay(s.schedules, s.activeScheduleId, now);
  const offNode = sched ? sortedNodes(sched).find((n) => n.status === "off" && atToday(n.time, now) > now) : undefined;
  const upcoming = sched ? sortedNodes(sched).filter((n) => atToday(n.time, now) > now).slice(0, 3) : [];
  const nn = nextNode(sched, now);
  const remaining = s.current.until ? s.current.until - now : undefined;
  const sub = s.timer ? `剩余 ${clock(s.timer.endsAt - now, false)}`
    : connected && s.knobTimer?.mode === "run" ? `倒计时 ${clock(Math.max(0, (s.knobTimer.endsAt ?? now) - now), false)}`
    : connected && s.knobTimer?.mode === "select" ? `设定 ${s.knobTimer.minutes} 分钟`
    : s.current.until ? `${hhmm(s.current.since)} – ${hhmm(s.current.until)}` : meta.hint;
  const statusExpired = connected && !s.timer && s.current.until && s.current.source !== "schedule" && now > s.current.until;
  const openReminders = s.deviceTodos.filter((t) => !t.done);
  const breakTotal = s.settings.breakMinutes * 60_000;
  // 已同步设备时：以上次上报值为基准按当前状态外推，心跳周期内平滑、到点不抢跑
  const breakAccum = s.breakSyncedAt && meta.workLike ? s.breakAccumMs + (now - s.breakSyncedAt) : s.breakAccumMs;
  const breakLeft = Math.max(0, breakTotal - breakAccum);
  const breakOn = s.settings.breakEnabled && !s.breakOffToday;
  const stale = (t: number) => now - t > s.settings.staleMinutes * 60_000;
  const todayTotal = s.segments.filter((x) => x.status !== "off").reduce((a, x) => a + ((x.end ?? now) - x.start), 0);

  const pick = (p: (typeof PRESETS)[number]) => {
    if (p.timer) actions.startTimer(p.timer, p.id);
    else actions.setStatus(p.id, "manual");
    if (s.offworkToday && p.id !== "off") toast({ message: "已开启新的状态区间" });
  };

  const sourceText = (() => {
    if (s.current.source === "schedule") return `来自计划表“${sched?.name ?? ""}”${nn ? ` · ${nn.time} 自动切换为${statusMeta(nn.status).label}` : ""}`;
    if (s.current.source === "timer") return "来自专注倒计时 · 结束后不会自动切换状态";
    const tail = s.pausedToday ? " · 今日计划已暂停" : nn && !s.offworkToday ? ` · ${nn.time} 起恢复计划表` : "";
    return `来自${SOURCE_LABEL[s.current.source]}${tail}`;
  })();

  return (
    <>
      <div className="topbar">
        <div>
          <h1>
            {greeting(now)}，{s.user.name}
            {connected ? <StatusChip id={s.current.id} /> : <span className="chip unknown">未连接</span>}
          </h1>
          <p>
            {new Date(now).getMonth() + 1} 月 {new Date(now).getDate()} 日 {weekday(now)} · {offNode ? `今天的计划 ${offNode.time} 收工` : s.offworkToday ? "今天已收工" : "今天没有计划收工时间"}
          </p>
        </div>
        <div className="row topbar-tools" style={{ gap: 4 }}>
          <span className="icon-btn"><Search className="i" /></span>
          <span className="icon-btn"><CircleHelp className="i" /></span>
          <Link to="/reminders" className="icon-btn" aria-label="提醒">
            <Bell className="i" />
            {openReminders.length > 0 && <span className="dot-alert" />}
          </Link>
        </div>
      </div>

      {(s.timer?.expired || statusExpired || (connected && s.breakDue) || (connected && s.knobTimer?.mode === "expired")) && (
        <div className="stack" style={{ marginBottom: 20, gap: 10 }}>
          {connected && s.knobTimer?.mode === "expired" && (
            <Banner tone="warn" icon={<Timer className="i" />} actions={
              <button className="btn btn-primary btn-sm" onClick={() => actions.knobTimerCancel()}>知道了</button>
            }>
              <b>旋钮倒计时 {s.knobTimer.minutes} 分钟已到</b>计时由设备执行，不会改变当前状态。
            </Banner>
          )}
          {s.timer?.expired && (
            <Banner tone="warn" icon={<Timer className="i" />} actions={<>
              <button className="btn btn-secondary btn-sm" onClick={() => actions.extendTimer(5)}>延长 5 分钟</button>
              <button className="btn btn-secondary btn-sm" onClick={() => actions.finishTimer()}>保持当前状态</button>
              <button className="btn btn-primary btn-sm" onClick={() => actions.finishTimer("work")}>结束专注</button>
            </>}>
              <b>{s.timer.minutes} 分钟倒计时已结束</b>状态不会自动改变，请选择接下来怎么做。
            </Banner>
          )}
          {statusExpired && (
            <Banner tone="warn" icon={<AlarmClock className="i" />} actions={<>
              <button className="btn btn-secondary btn-sm" onClick={() => actions.extendStatus(15)}>延长 15 分钟</button>
              <button className="btn btn-primary btn-sm" onClick={() => actions.setStatus("work")}>切换为工作中</button>
            </>}>
              <b>“{meta.label}”预计已在 {hhmm(s.current.until!)} 结束</b>需要延长还是切换？
            </Banner>
          )}
          {connected && s.breakDue && (
            <Banner tone="rest" icon={<Coffee className="i" />} actions={<>
              <button className="btn btn-secondary btn-sm" onClick={() => actions.remindBreakIn(5)}>5 分钟后再提醒</button>
              <button className="btn btn-secondary btn-sm" onClick={() => actions.dismissBreak()}>知道了</button>
              <button className="btn btn-ghost btn-sm" onClick={() => actions.skipBreakToday()}>今天不再提醒</button>
              <button className="btn btn-primary btn-sm" onClick={() => actions.setStatus("rest")}>去休息</button>
            </>}>
              <b>起来活动一下</b>已累计 {s.settings.breakMinutes} 分钟处于工作类状态，下一轮 {s.settings.breakMinutes} 分钟已自动开始。提醒不会改变你的状态。
            </Banner>
          )}
        </div>
      )}

      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader
              icon={<Tile color="violet" size={30}><Monitor /></Tile>}
              title={s.settings.deviceName || device.name || "我的收工牌"}
              extra={<ConnBadge device={device} now={now} />}
              to="/device"
              toLabel={device.kind === "none" ? "连接设备" : "设备设置"}
            />
            <div className="card-b device">
              <DeviceMirror
                status={s.current.id}
                sub={sub}
                ledOn={s.settings.led[s.current.id] !== "off"}
                flashKey={`${s.current.id}-${s.current.since}`}
                unknown={!connected}
                caption={[connected ? "实时镜像" : "未连接", connected ? `已同步 · ${device.lastSyncAt ? ago(device.lastSyncAt, now) : "刚刚"}` : "连接后同步设备状态"]}
              />
              <div>
                <div className="now-label">当前状态</div>
                <div className="now-status">
                  <b>{connected ? meta.label : "未连接"}</b>
                  {connected && remaining !== undefined && remaining > 0 && <StatusChip id={s.current.id} dot={false}>还剩 {duration(remaining)}</StatusChip>}
                </div>
                <div className="now-src"><CalendarDays className="i" style={{ width: 14, height: 14 }} />{connected ? sourceText : "设备离线，网页不知道设备当前状态"}</div>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`preset ${connected && s.current.id === p.id ? "on" : ""}`}
                      style={{ ["--c" as string]: statusMeta(p.id).color }}
                      disabled={!connected}
                      onClick={() => pick(p)}
                    >
                      <span className="d" style={{ background: statusMeta(p.id).color }} />
                      {p.label ?? statusMeta(p.id).label}
                    </button>
                  ))}
                  {customStatusDefs().map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`preset ${connected && s.current.id === c.id ? "on" : ""}`}
                      style={{ ["--c" as string]: c.color }}
                      disabled={!connected}
                      onClick={() => pick({ id: c.id })}
                      title={c.hint}
                    >
                      <span className="d" style={{ background: c.color }} />
                      {c.name}
                    </button>
                  ))}
                  <Link to="/screen" className="preset add"><Plus className="i" style={{ width: 14, height: 14 }} />自定义</Link>
                </div>
              </div>
            </div>
            <div className="dev-meta">
              <Link to="/lighting" className="dev-meta-link" title="打开灯效设置">
                <span className="swatch-led" style={{ background: !connected || s.settings.led[s.current.id] === "off" ? "var(--line-2)" : meta.color }} />
                <span><b>RGB 灯</b>{!connected ? "未连接" : s.settings.led[s.current.id] === "off" ? "已关闭" : `${s.settings.led[s.current.id] === "breath" ? "呼吸" : "常亮"} · 亮度 ${s.settings.ledBrightness}%`}</span>
              </Link>
              <Link to="/controls" className="dev-meta-link" title="打开触摸与快捷键设置">
                <Tile color="blue" size={30}><Fingerprint /></Tile>
                <span><b>触摸键</b>{keyActionLabel(s.settings.keys.t)} · K1–K4 {([s.settings.keys.k1, s.settings.keys.k2, s.settings.keys.k3, s.settings.keys.k4]).map(keyActionLabel).join("/")}</span>
              </Link>
              <div className="dev-meta-link" role="button" tabIndex={0} title="调节旋钮每格时长"
                style={{ cursor: "pointer" }}
                onClick={() => setKnobOpen(true)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setKnobOpen(true); } }}>
                <Tile color="orange" size={30}><Gauge /></Tile>
                <span><b>旋钮</b>{!connected ? "未连接"
                  : s.knobTimer?.mode === "run" ? `倒计时 ${clock(Math.max(0, (s.knobTimer.endsAt ?? now) - now), false)}`
                  : s.knobTimer?.mode === "select" ? `设定 ${s.knobTimer.minutes} 分钟`
                  : s.knobTimer?.mode === "expired" ? "时间到"
                  : `每格 ±${s.settings.knobStep} 分钟`}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="今天要做的" count={openReminders.length + (s.agent.state === "needsInput" && s.settings.agentEnabled ? 1 : 0)} to="/reminders" />
            {s.settings.agentEnabled && s.agent.state === "needsInput" && (
              <Link to="/agent" style={{ color: "inherit" }}>
                <RowItem
                  lead={<Tile color="blue"><Sparkles /></Tile>}
                  title={<>Agent 需要你的输入 <span className="badge b-warn">待处理</span></>}
                  desc={`“${s.agent.task}”任务正在等待你确认`}
                  meta={ago(s.agent.updatedAt, now)}
                  onClick={() => {}}
                />
              </Link>
            )}
            {openReminders.slice(0, 4).map((r) => (
              <RowItem
                key={r.id}
                lead={<Tile color={r.src === "voice" ? "pink" : "orange"}>{r.src === "voice" ? <Mic /> : <Bell />}</Tile>}
                title={r.text}
                desc={r.trig === "offwork" ? "收工后提醒" : "到点提醒"}
                meta={r.trig === "offwork" ? "收工后" : r.at !== undefined ? `${hhmm(r.at)}` : "无定时"}
                onClick={() => {
                  if (!connected) return;
                  actions.deviceTodoDone(r.id);
                  toast({ message: `已完成“${r.text}”`, action: { label: "撤销", onClick: () => actions.deviceTodoDone(r.id, false) }, seconds: 5 });
                }}
              />
            ))}
            {s.settings.breakEnabled && !s.breakOffToday && (
              <RowItem lead={<Tile color="green"><Coffee /></Tile>} title="起来活动一下" desc={`累计“工作类”状态 ${s.settings.breakMinutes} 分钟时提醒`} meta={connected ? (meta.workLike ? `约 ${Math.ceil(breakLeft / 60_000)} 分钟后` : "计时已暂停") : "未连接"} />
            )}
          </Card>

          <Card>
            <CardHeader title="接下来的计划" extra={sched && <span className="badge b-new">{sched.name}</span>} to="/schedule" toLabel="切换计划表" />
            {upcoming.length === 0 && <RowItem lead={<Tile color="violet"><CalendarDays /></Tile>} title={sched ? "今天的计划已全部完成" : "今天没有生效的计划表"} desc="可以到计划表页面新建或切换" />}
            {upcoming.map((n, i) => {
              const end = upcoming[i + 1] ? atToday(upcoming[i + 1].time, now) : undefined;
              const blocked = s.pausedToday || (s.offworkToday && n.status !== "off");
              return (
                <RowItem
                  key={n.id}
                  className={blocked ? "stale" : ""}
                  lead={<div className="time-tile"><i style={{ background: statusMeta(n.status).color }} /><b>{n.time}</b><span>{weekday(now)}</span></div>}
                  title={`${statusMeta(n.status).label}${n.note ? ` · ${n.note}` : ""}`}
                  desc={blocked ? (s.pausedToday ? "今日计划已暂停，不会自动切换" : "今天已收工，不会自动切回工作") : n.status === "off" ? "自动收工并生成今日状态回顾" : "到点自动切换，不需要打开网页"}
                  meta={<StatusChip id={n.status} dot={false}>{n.status === "off" ? "收工" : end ? duration(end - atToday(n.time, now)) : "—"}</StatusChip>}
                />
              );
            })}
          </Card>
        </div>

        <div className="stack">
          <Card className="offwork">
            <div className="card-b">
              {s.current.id === "off" ? (
                <>
                  <div className="lbl"><Sunset className="i" style={{ width: 15, height: 15 }} />今天已收工</div>
                  <div className="big" style={{ fontFamily: "var(--font)" }}>辛苦了</div>
                  <p>今天的状态记录已结束。如需继续工作，切换任意状态会开启新的状态区间。</p>
                  <Link className="btn hold" to="/review"><span>查看今日回顾</span></Link>
                </>
              ) : (
                <>
                  <div className="lbl"><Sunset className="i" style={{ width: 15, height: 15 }} />{offNode ? "距离计划收工" : "今天还没有计划收工时间"}</div>
                  <div className="big">{offNode ? clock(atToday(offNode.time, now) - now) : hhmm(now)}</div>
                  <p>{offNode ? `${offNode.time} 会自动切换为“已下班”，也可以现在就收工。` : "准备好了就按住下面的按钮收工。"}</p>
                  <HoldButton onComplete={offwork} done={<span>已收工</span>} disabled={device.state !== "connected"}>
                    <Sunset className="i" /><span>{device.state === "connected" ? "按住 1.5 秒收工" : "连接收工牌后才能收工"}</span>
                  </HoldButton>
                  <div className="foot">{device.state === "connected" ? "收工后 10 秒内可撤销" : "桌牌连接后状态时长才会同步记录"}</div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="共享看板" count={s.members.length + (s.settings.shareEnabled ? 1 : 0)} to="/board" />
            {s.members.slice(0, 3).map((m) => {
              const isStale = stale(m.updatedAt);
              return (
                <RowItem
                  key={m.id}
                  className={isStale ? "stale" : ""}
                  lead={<span className={`avatar ${m.id === "lin" ? "av2" : m.id === "zhou" ? "av3" : "av4"}`}>{m.name.slice(-1)}{!isStale && m.status && <span className="pres" style={{ background: statusMeta(m.status).color }} />}</span>}
                  title={m.name}
                  desc={isStale ? `最后更新 ${hhmm(m.updatedAt)} · 可能已过期` : `${m.via === "espnow" ? "ESP-NOW" : "网关转发"} · ${ago(m.updatedAt, now)}`}
                  meta={isStale || !m.status ? <UnknownChip /> : <StatusChip id={m.status}>{statusMeta(m.status).label}{m.until ? ` · 至 ${m.until}` : ""}</StatusChip>}
                />
              );
            })}
            <RowItem
              lead={<Tile color="teal"><Lock /></Tile>}
              title={s.settings.shareEnabled ? "你正在分享当前状态" : "你没有分享状态"}
              desc={s.settings.shareEnabled ? "只分享状态，不分享计划和待办" : "其他成员看不到你的状态，设备也不会广播"}
              meta={<Link className="view-all" to="/board">管理</Link>}
            />
          </Card>

          <Card>
            <CardHeader title="休息提醒" extra={<>
              <span className="hint">每 {s.settings.breakMinutes} 分钟 · 自动循环</span>
              <button className="btn btn-ghost btn-sm" onClick={() => actions.resetBreak()} disabled={!breakOn || !connected}><RotateCcw />重新计时</button>
            </>} />
            <div className="card-b ring-row">
              <Ring value={breakOn && connected ? 1 - breakLeft / breakTotal : 0} label={!connected ? "未连接" : breakOn ? clock(breakLeft, false) : "已关闭"} sub={breakOn && connected ? "后提醒" : ""} />
              <div style={{ display: "grid", gap: 8 }}>
                <div className="hint" style={{ fontSize: 13 }}>
                  {!connected ? "连接设备后同步休息计时。" : !breakOn ? "今天不会再提醒。" : meta.workLike ? "会议、休息和下班时自动暂停计时。" : `当前“${meta.label}”，计时已暂停。`}
                  {connected && s.breakOffToday && <button className="btn btn-ghost btn-sm" onClick={() => actions.resumeBreakToday()}>恢复提醒</button>}
                </div>
                <MinuteChips values={s.settings.breakOptions} selected={s.settings.breakMinutes} disabled={!breakOn || !connected} onSelect={(m) => actions.setBreakInterval(m)} onChange={(v) => actions.updateSettings({ breakOptions: v })} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="本周状态回顾" to="/review" toLabel="详情" />
            <div className="card-b">
              <WeekBars history={s.history} segments={s.segments} now={now} todayKey={dateKey(startOfDay(now))} />
              <div className="disclaimer"><ShieldCheck />今天非下班状态 {duration(todayTotal)} · 只反映你设置的状态，不代表工作效率</div>
            </div>
          </Card>
        </div>
      </div>

      {knobOpen && (
        <Modal title="旋钮定时" onClose={() => setKnobOpen(false)}>
          <div className="form">
            <SettingRow title="每格时长" desc="旋转一格增加/减少的分钟数">
              <Segmented
                disabled={!connected}
                value={String(s.settings.knobStep)}
                options={[{ value: "1", label: "±1 分钟" }, { value: "5", label: "±5 分钟" }, { value: "10", label: "±10 分钟" }]}
                onChange={(v) => actions.updateSettings({ knobStep: Number(v) })}
              />
            </SettingRow>
            <SettingRow title="最长时长" desc="可以选到的最大倒计时时长">
              <select className="input input-sm" disabled={!connected} value={s.settings.knobMax} onChange={(e) => actions.updateSettings({ knobMax: Number(e.target.value) })}>
                {[60, 120, 180].map((m) => <option key={m} value={m}>{m} 分钟</option>)}
              </select>
            </SettingRow>
            <p className="hint" style={{ margin: 0 }}>
              {connected
                ? "配置写入设备并断电保留。在桌牌上旋转调时长、按下开始、长按取消；倒计时由设备独立执行，网页关闭也照常计时。"
                : "设备未连接：该配置保存在设备上，连接后才能修改。"}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Ring({ value, label, sub }: { value: number; label: string; sub: string }) {
  const c = 2 * Math.PI * 40;
  return (
    <div className="ring">
      <svg viewBox="0 0 96 96">
        <defs>
          <linearGradient id="ring-gr" x1="0" x2="1"><stop offset="0" stopColor="#0EA5B7" /><stop offset="1" stopColor="#22A06B" /></linearGradient>
        </defs>
        <circle cx="48" cy="48" r="40" fill="none" stroke="#EEF0F4" strokeWidth="9" />
        <circle cx="48" cy="48" r="40" fill="none" stroke="url(#ring-gr)" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} style={{ transition: "stroke-dashoffset .6s" }} />
      </svg>
      <div className="v"><div><b>{label}</b><span>{sub}</span></div></div>
    </div>
  );
}
