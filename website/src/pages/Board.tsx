import { Lock, Radio, Users, QrCode, LogOut, Unplug } from "lucide-react";
import { useStore } from "../store/AppStore";
import { statusMeta } from "../domain/statuses";
import { ago, hhmm } from "../domain/time";
import { Banner, Card, CardHeader, EmptyState, PageHeader, RowItem, SettingRow, StatusChip, Tile, Toggle, UnknownChip } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

const AV = ["av2", "av3", "av4", "av1"];

export function BoardPage() {
  const { s, now, actions, device } = useStore();
  const toast = useToast();
  const stale = (t: number) => now - t > s.settings.staleMinutes * 60_000;
  const connected = device.state === "connected"; // 成员状态由连接的设备转发；断连时看板不可用

  if (!connected) {
    return (
      <>
        <PageHeader title="共享看板" desc={`${s.user.zone} · 只显示成员主动分享的当前状态，不包含计划、待办和历史。`} />
        <Card><div className="card-b"><EmptyState icon={<Unplug />} title="需要连接设备" desc="成员状态靠连接的设备作为网关转发。连接收工牌后才能查看共享看板、设置分享。" /></div></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="共享看板" desc={`${s.user.zone} · 只显示成员主动分享的当前状态，不包含计划、待办和历史。`} actions={<button className="btn btn-secondary" onClick={() => toast({ message: "邀请功能需要联网服务，暂未开放" })}><QrCode />邀请成员</button>} />
      <div className="cols">
        <Card>
          <CardHeader title="成员" count={s.members.length + 1} />
          <RowItem
            lead={<span className="avatar av1">{s.user.name.slice(-1)}{s.settings.shareEnabled && connected && <span className="pres" style={{ background: statusMeta(s.current.id).color }} />}</span>}
            title={`${s.user.name}（我）· ${s.settings.deviceName}`}
            desc={!connected ? "设备未连接，状态同步暂停" : s.settings.shareEnabled ? "分享中 · 刚刚" : "未分享 · 其他人看不到"}
            meta={!connected ? <UnknownChip /> : s.settings.shareEnabled ? <StatusChip id={s.current.id} /> : <span className="chip unknown">未分享</span>}
          />
          {s.members.map((m, i) => {
            const isStale = stale(m.updatedAt);
            return (
              <RowItem
                key={m.id}
                className={isStale ? "stale" : ""}
                lead={<span className={`avatar ${AV[i % AV.length]}`}>{m.name.slice(-1)}{!isStale && m.status && <span className="pres" style={{ background: statusMeta(m.status).color }} />}</span>}
                title={m.name}
                desc={isStale ? `最后更新 ${hhmm(m.updatedAt)} · 可能已过期` : `${m.via === "espnow" ? "ESP-NOW" : "网关转发"} · ${ago(m.updatedAt, now)}`}
                meta={isStale || !m.status ? <UnknownChip /> : <StatusChip id={m.status}>{statusMeta(m.status).label}{m.until ? ` · 至 ${m.until}` : ""}</StatusChip>}
              />
            );
          })}
          {s.membersLive && s.members.length === 0 && (
            <div className="card-b"><p className="hint" style={{ margin: 0 }}>区域内还没有其他成员广播。其他收工牌开启「分享我的当前状态」且区域码一致时会出现在这里。</p></div>
          )}
        </Card>
        <div className="stack">
          <Card>
            <CardHeader icon={<Tile color="teal" size={30}><Lock /></Tile>} title="我的分享" />
            <div className="card-b form">
              <SettingRow title="我的姓名" desc="共享时其他成员看到的是这个名字，不是设备名">
                <input className="input input-sm" style={{ width: 120 }} value={s.user.name} onChange={(e) => actions.setUserName(e.target.value)} placeholder="输入你的名字" />
              </SettingRow>
              <SettingRow title="分享我的当前状态" desc="关闭后设备停止广播，其他成员的缓存会标记为失效">
                <Toggle checked={s.settings.shareEnabled} onChange={(v) => { actions.updateSettings({ shareEnabled: v }); toast({ message: v ? "已开始分享当前状态" : "已停止分享" }); }} />
              </SettingRow>
              <SettingRow title="超过多久标记为“可能已过期”" desc="成员设备离线时不会伪装成实时状态">
                <select className="input input-sm" value={s.settings.staleMinutes} onChange={(e) => actions.updateSettings({ staleMinutes: Number(e.target.value) })}>
                  {[5, 15, 30, 60].map((m) => <option key={m} value={m}>{m} 分钟</option>)}
                </select>
              </SettingRow>
              <button className="btn btn-ghost" onClick={() => toast({ message: "退出区域需要联网服务，暂未开放" })}><LogOut />退出该区域</button>
            </div>
          </Card>
          <Banner tone="info" icon={<Radio className="i" />}>
            <b>数据从哪里来</b>同一区域的设备之间用 ESP-NOW 互相广播状态，网页不能直接收到。看板上的成员状态由连接到网页的设备作为网关转发；跨区域查看需要以后接入联网服务。
          </Banner>
          {!s.membersLive && <Banner tone="info" icon={<Users className="i" />}>当前成员数据为演示数据，接入网关设备后显示真实成员。</Banner>}
        </div>
      </div>
    </>
  );
}
