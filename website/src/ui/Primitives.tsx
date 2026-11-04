import { ChevronRight, Bluetooth, Radio, X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DeviceInfo, StatusId } from "../domain/types";
import { statusMeta } from "../domain/statuses";
import { ago } from "../domain/time";

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, count, extra, to, toLabel = "查看全部", icon }: { title: ReactNode; count?: number; extra?: ReactNode; to?: string; toLabel?: string; icon?: ReactNode }) {
  return (
    <div className="card-h">
      <h3>
        {icon}
        {title}
        {count !== undefined && <span className="count">({count})</span>}
      </h3>
      <div className="row" style={{ gap: 8 }}>
        {extra}
        {to && (
          <Link className="view-all" to={to}>
            {toLabel}
            <ChevronRight />
          </Link>
        )}
      </div>
    </div>
  );
}

export function StatusChip({ id, children, dot = true }: { id: StatusId; children?: ReactNode; dot?: boolean }) {
  const meta = statusMeta(id);
  // 自定义状态没有固定样式类对应的设计令牌：用 --c 变量走 s-custom 样式
  return (
    <span className={`chip ${meta.className}`} style={meta.className === "s-custom" ? { ["--c" as string]: meta.color } : undefined}>
      {dot && <span className="d" />}
      {children ?? meta.label}
    </span>
  );
}

export function UnknownChip() {
  return <span className="chip unknown">状态未知</span>;
}

export type TileColor = "orange" | "violet" | "blue" | "green" | "pink" | "teal";

export function Tile({ color, children, size }: { color: TileColor; children: ReactNode; size?: number }) {
  return (
    <span className={`tile t-${color}`} style={size ? { width: size, height: size } : undefined}>
      {children}
    </span>
  );
}

export function RowItem({ lead, title, desc, meta, onClick, className = "" }: { lead: ReactNode; title: ReactNode; desc?: ReactNode; meta?: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div className={`row-item ${className}`} onClick={onClick} style={onClick ? undefined : { cursor: "default" }}>
      {lead}
      <div className="txt">
        <b>{title}</b>
        {desc && <span>{desc}</span>}
      </div>
      {typeof meta === "string" ? <span className="meta">{meta}</span> : meta}
    </div>
  );
}

export function ConnBadge({ device, now }: { device: DeviceInfo; now: number }) {
  if (device.kind === "none") return <span className="conn"><i style={{ background: "var(--ink-3)" }} />未连接设备</span>;
  const color = device.state === "connected" ? "var(--st-work)" : device.state === "connecting" ? "#D69E2E" : "var(--ink-3)";
  const text =
    device.state === "connected"
      ? device.kind === "ble" ? "蓝牙已连接" : device.kind === "serial" ? "串口已连接" : "模拟设备已连接"
      : device.state === "connecting"
        ? "连接中…"
        : `离线${device.lastSyncAt ? ` · 最后同步 ${ago(device.lastSyncAt, now)}` : ""}`;
  return (
    <span className="conn">
      <i style={{ background: color }} />
      {device.kind === "ble" ? <Bluetooth /> : <Radio />}
      {text}
    </span>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="tile t-violet">{icon}</span>
      <b>{title}</b>
      <p>{desc}</p>
      {action}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button type="button" key={o.value} className={o.value === value ? "on" : ""} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingRow({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <b>{title}</b>
        {desc && <span>{desc}</span>}
      </div>
      <div className="setting-ctl">{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="card-h">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X />
          </button>
        </div>
        <div className="card-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Banner({ tone = "info", icon, children, actions }: { tone?: "info" | "warn" | "rest"; icon?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`}>
      {icon}
      <div className="banner-txt">{children}</div>
      {actions && <div className="row" style={{ gap: 6 }}>{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
