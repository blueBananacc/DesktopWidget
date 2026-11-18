import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Unplug } from "lucide-react";
import { Card, PageHeader } from "../ui/Primitives";

// 模拟器窗口文件 vendored 在 public/emulator/（源自 BUSY Bar Emulator 的 device window，
// 已换为收工牌设计规范）；其 API 与事件流由 vite 代理转给本机模拟器服务（127.0.0.1:8640）。
const EMU_URL = `${import.meta.env.BASE_URL}emulator/index.html`;
const EMU_ORIGIN = "http://127.0.0.1:8640";

export function EmulatorEmbed({ height = 560 }: { height?: number }) {
  const [alive, setAlive] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/_emu/status", { cache: "no-store" })
      .then((r) => on && setAlive(r.ok))
      .catch(() => on && setAlive(false));
    return () => { on = false; };
  }, []);
  if (!alive) {
    return (
      <div className="hint" style={{ padding: "40px 24px", textAlign: "center" }}>
        {alive === null ? "正在检测本地模拟器…" : "本地模拟器未运行，启动后此处显示屏幕内容。"}
      </div>
    );
  }
  return <iframe src={EMU_URL} title="设备模拟器" style={{ display: "block", width: "100%", height, minHeight: 320, border: 0 }} />;
}

export function Emulator() {
  const [alive, setAlive] = useState<boolean | null>(null);
  const probe = useCallback(() => {
    setAlive(null);
    fetch("/_emu/status", { cache: "no-store" })
      .then((r) => setAlive(r.ok))
      .catch(() => setAlive(false));
  }, []);
  useEffect(probe, [probe]);

  return (
    <>
      <PageHeader
        title="模拟器"
        desc="本机运行的设备模拟器：画面、按键与应用运行时和真机一致，可在这里开发调试屏幕程序。"
      />
      {alive === false ? (
        <Card>
          <div className="card-b scr-empty" style={{ textAlign: "center", padding: "56px 24px" }}>
            <Unplug className="i" style={{ width: 36, height: 36, color: "var(--ink-3)", marginBottom: 12 }} />
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>本地模拟器未运行</h3>
            <p>在本机启动模拟器服务后，这里会嵌入它的完整工作台（画面、按键、应用、日志）：</p>
            <div className="code-box" style={{ maxWidth: 420, margin: "12px auto 16px", textAlign: "left" }}>
              <pre>cd busybar-emulator{"\n"}node packages/server/index.mjs</pre>
            </div>
            <p className="hint" style={{ margin: "0 0 16px" }}>启动后 API 在 {EMU_ORIGIN}，本页面自动接入。</p>
            <button className="btn btn-secondary" onClick={probe}><RefreshCw className="i" style={{ width: 14, height: 14 }} />重新检测</button>
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {alive ? (
            <iframe
              src={EMU_URL}
              title="设备模拟器"
              style={{ display: "block", width: "100%", height: "calc(100vh - 210px)", minHeight: 560, border: 0 }}
            />
          ) : (
            <div className="hint" style={{ padding: 24, textAlign: "center" }}>正在检测本地模拟器…</div>
          )}
        </Card>
      )}
    </>
  );
}
