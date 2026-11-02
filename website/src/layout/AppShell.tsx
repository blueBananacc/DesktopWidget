import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, CalendarDays, ListChecks, BarChart3, Users, Sparkles, Monitor, Fingerprint, Image, Palette, ShieldCheck,
  Mic, MoreHorizontal, User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "../store/AppStore";
import { VoiceDialog } from "./VoiceDialog";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: "count" | "beta";
}

const GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: "总览", icon: LayoutDashboard }] },
  {
    label: "工作日",
    items: [
      { to: "/schedule", label: "计划表", icon: CalendarDays },
      { to: "/reminders", label: "待办与提醒", icon: ListChecks, badge: "count" },
      { to: "/review", label: "状态回顾", icon: BarChart3 },
    ],
  },
  {
    label: "协作",
    items: [
      { to: "/board", label: "共享看板", icon: Users },
      { to: "/agent", label: "Agent 联动", icon: Sparkles, badge: "beta" },
    ],
  },
  {
    label: "设备",
    items: [
      { to: "/device", label: "我的设备", icon: Monitor },
      { to: "/controls", label: "触摸与快捷键", icon: Fingerprint },
      { to: "/screen", label: "屏幕内容", icon: Image },
      { to: "/lighting", label: "灯效", icon: Palette },
    ],
  },
];

const TABS: NavItem[] = [
  { to: "/", label: "总览", icon: LayoutDashboard },
  { to: "/schedule", label: "计划", icon: CalendarDays },
  { to: "/reminders", label: "提醒", icon: ListChecks },
  { to: "/board", label: "看板", icon: Users },
  { to: "/me", label: "我的", icon: User },
];

const ME_PATHS = ["/me", "/review", "/agent", "/device", "/controls", "/screen", "/lighting", "/settings"];

export function AppShell() {
  const { s } = useStore();
  const [voice, setVoice] = useState(false);
  const { pathname } = useLocation();
  const openCount = s.reminders.filter((r) => !r.done).length;

  return (
    <div className="app app-full">
      <aside className="side">
        <div className="logo"><span className="logo-mark" />收工牌</div>
        {GROUPS.map((g, gi) => (
          <div key={gi}>
            {g.label && <div className="nav-group">{g.label}</div>}
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === "/"} className={({ isActive }) => `nav ${isActive ? "on" : ""}`}>
                <it.icon className="i" />
                {it.label}
                {it.badge === "count" && openCount > 0 && <span className="badge b-new">{openCount}</span>}
                {it.badge === "beta" && <span className="badge b-beta">测试版</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="grow" />
        <NavLink to="/settings" className={({ isActive }) => `nav ${isActive ? "on" : ""}`}>
          <ShieldCheck className="i" />隐私与设置
        </NavLink>
        <div className="me">
          <span className="avatar av1">{s.user.name.slice(-1)}</span>
          <div><b>{s.user.name}</b><span>{s.user.team}</span></div>
          <MoreHorizontal className="i more" />
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar app-tabbar">
        {TABS.map((t) => {
          const on = t.to === "/" ? pathname === "/" : t.to === "/me" ? ME_PATHS.some((p) => pathname.startsWith(p)) : pathname.startsWith(t.to);
          return (
            <NavLink key={t.to} to={t.to} className={on ? "on" : ""}>
              <t.icon className="i" />
              {t.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="fab">
        <span className="tip">说一句话，创建提醒</span>
        <button aria-label="语音创建提醒" onClick={() => setVoice(true)}><Mic /></button>
      </div>
      {voice && <VoiceDialog onClose={() => setVoice(false)} />}
    </div>
  );
}
