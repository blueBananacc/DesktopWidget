// 共享看板的云端同步客户端——对应固件里 MQTT publish/subscribe 的角色：
// 固件把状态 mqtt_publish 到云 broker，其他端订阅；网页版等价物是 presence hub（/hub/*）。
// 语义与固件一致：只发布"显式共享的当前状态"（状态+昵称+可选持续到时刻），90s 心跳 TTL，
// 掉线后 broker 自动把条目标过期，不伪装在线。
// watch（订阅成员）不需要开启分享——订阅是只读的，不暴露自己的状态；
// share（发布自己）才由「分享我的当前状态」开关控制。
import type { Member } from "../domain/types";

const HUB = "/hub"; // nginx/vite 反代到 presence 服务（与 /api、/_emu 同级，根路径）
const HEARTBEAT_MS = 30_000;
const POLL_MS = 20_000;

interface PeerDto {
  id: string;
  name: string;
  st: string | null;
  until: string | null;
  at: number;
}

const selfId = (): string => {
  const KEY = "sgp-presence-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `web-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
};

let heartbeat: ReturnType<typeof setInterval> | undefined;
let poller: ReturnType<typeof setInterval> | undefined;
let pubTimer: ReturnType<typeof setTimeout> | undefined;
let watching: { zone: string } | undefined;
let sharing: { zone: string; name: string } | undefined;
let lastStatus: { st: string; until?: string } | undefined;
let onMembers: ((members: Member[]) => void) | undefined;

const applyPeers = async (zone: string) => {
  try {
    const res = await fetch(`${HUB}/peers?zone=${encodeURIComponent(zone)}&self=${selfId()}`);
    if (!res.ok) return;
    const body = (await res.json()) as { peers?: PeerDto[] };
    onMembers?.(
      (body.peers ?? []).map((p) => ({
        id: p.id,
        name: p.name || `成员 ${p.id.slice(-4)}`,
        status: (p.st ?? undefined) as Member["status"],
        until: p.until ?? undefined,
        via: "cloud" as const,
        updatedAt: p.at,
      })),
    );
  } catch {
    // hub 不可达：保持现有成员，下次轮询重试
  }
};

const publish = async () => {
  if (!sharing || !lastStatus) return;
  try {
    await fetch(`${HUB}/pub`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zone: sharing.zone, id: selfId(), name: sharing.name, st: lastStatus.st, until: lastStatus.until ?? null }),
    });
  } catch {
    // 发布失败由下个心跳兜底
  }
};

const stopSharing = () => {
  clearInterval(heartbeat);
  heartbeat = undefined;
  sharing = undefined;
};

const stopAll = () => {
  stopSharing();
  clearInterval(poller);
  clearTimeout(pubTimer);
  poller = pubTimer = undefined;
  watching = undefined;
};

export const presence = {
  /**
   * 连接/区域/状态/分享开关变化时调用（幂等）。
   * watch=false 时停止订阅并清空成员；share=false 只停发布（broker 侧靠 TTL 自然过期）。
   */
  configure(cfg: {
    watch: boolean;
    share: boolean;
    zone: string;
    name: string;
    status: { st: string; until?: string };
    onMembers: (members: Member[]) => void;
  }) {
    onMembers = cfg.onMembers;
    lastStatus = cfg.status;

    // 发布侧：分享开关或身份变化
    const wantShare = cfg.share && cfg.watch;
    const shareIdentity = wantShare ? `${cfg.zone}${cfg.name}` : null;
    const hadShareIdentity = sharing ? `${sharing.zone}${sharing.name}` : null;
    if (shareIdentity !== hadShareIdentity) {
      stopSharing();
      if (wantShare) {
        sharing = { zone: cfg.zone, name: cfg.name };
        void publish();
        heartbeat = setInterval(() => void publish(), HEARTBEAT_MS);
      }
    } else if (wantShare) {
      // 状态变化：节流 2s 立即补发一次
      clearTimeout(pubTimer);
      pubTimer = setTimeout(() => void publish(), 2000);
    }

    // 订阅侧：区域变化重开轮询
    const wantWatch = cfg.watch ? cfg.zone : null;
    if (wantWatch !== (watching?.zone ?? null)) {
      clearInterval(poller);
      poller = undefined;
      watching = wantWatch ? { zone: wantWatch } : undefined;
      if (watching) {
        void applyPeers(watching.zone);
        poller = setInterval(() => watching && void applyPeers(watching.zone), POLL_MS);
      } else {
        onMembers?.([]);
      }
    }
  },

  stop: stopAll,
};
