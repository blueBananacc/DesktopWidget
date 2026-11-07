import { useState } from "react";
import { Bluetooth, Monitor, Radio, Unplug, Hand, Keyboard, Gauge, WifiOff, RefreshCw, Usb } from "lucide-react";
import { useStore, toOutbound } from "../store/AppStore";
import { bleSupported } from "../device/bleTransport";
import { serialSupported } from "../device/serialTransport";
import { MockTransport } from "../device/mockTransport";
import { ago } from "../domain/time";
import { Banner, Card, CardHeader, ConnBadge, EmptyState, PageHeader, SettingRow, Tile } from "../ui/Primitives";
import { useToast } from "../ui/Toast";

export function DevicePage() {
  const { s, now, device, transport, connect, disconnect, actions } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ble = bleSupported();
  const ser = serialSupported();
  const mock = transport instanceof MockTransport ? transport : undefined;

  const doConnect = async (kind: "mock" | "ble" | "serial") => {
    setBusy(true);
    try {
      await connect(kind);
      toast({ message: "设备已连接，已同步当前状态和计划表" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel|取消|User cancelled/i.test(msg)) toast({ message: `连接失败：${msg}`, seconds: 6 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="我的设备" desc="通过蓝牙连接收工牌。断开期间的改动会在重新连接后自动同步。" />
      <div className="cols">
        <div className="stack">
          <Card>
            <CardHeader icon={<Tile color="violet" size={30}><Monitor /></Tile>} title={device.kind === "none" ? "还没有连接设备" : s.settings.deviceName || device.name} extra={<ConnBadge device={device} now={now} />} />
            {device.kind === "none" ? (
              <EmptyState
                icon={<Bluetooth />}
                title="连接你的收工牌"
                desc={ble ? "打开设备电源，点击下方按钮，在浏览器弹出的列表中选择收工牌。" : "这台电脑没有蓝牙适配器：用 USB 数据线串口连接，或装一个蓝牙适配器后再试蓝牙连接。"}
                action={
                  <div className="row" style={{ justifyContent: "center" }}>
                    <button className="btn btn-primary" disabled={!ser || busy} onClick={() => doConnect("serial")}><Usb />串口连接</button>
                    <button className="btn btn-secondary" disabled={!ble || busy} onClick={() => doConnect("ble")}><Bluetooth />蓝牙连接</button>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => doConnect("mock")}><Radio />使用模拟设备</button>
                  </div>
                }
              />
            ) : (
              <div className="card-b form">
                <SettingRow title="设备名称" desc="显示在网页和共享看板上，可随时修改">
                  <input className="input input-sm" value={s.settings.deviceName} onChange={(e) => actions.updateSettings({ deviceName: e.target.value })} placeholder="收工牌 A1" />
                </SettingRow>
                <SettingRow title="连接方式" desc={device.kind === "ble" ? "Web Bluetooth" : device.kind === "serial" ? "USB 串口（CH343）" : "模拟设备（没有硬件时用于测试）"}><span className="hint">{device.kind === "ble" ? "蓝牙" : device.kind === "serial" ? "串口" : "模拟"}</span></SettingRow>
                <SettingRow title="最后同步" desc={device.pending > 0 ? `有 ${device.pending} 项改动等待同步` : "所有改动已同步"}><span className="hint">{device.lastSyncAt ? ago(device.lastSyncAt, now) : "—"}</span></SettingRow>
                <div className="row">
                  {device.state !== "connected" && <button className="btn btn-primary" disabled={busy} onClick={() => doConnect(device.kind as "ble" | "mock" | "serial")}><RefreshCw />重新连接</button>}
                  <button className="btn btn-danger" onClick={() => disconnect()}><Unplug />移除设备</button>
                </div>
              </div>
            )}
          </Card>

          {mock && (
            <Card>
              <CardHeader title="模拟设备端操作" extra={<span className="badge b-new">测试</span>} />
              <div className="card-b form">
                <p className="hint" style={{ margin: 0 }}>模拟在桌牌上的操作，用来检查网页和设备之间的同步逻辑。</p>
                <div className="row">
                  <button className="btn btn-secondary" onClick={() => mock.emit({ type: "touch" })}><Hand />触摸键</button>
                  {([1, 2, 3, 4] as const).map((k) => (
                    <button key={k} className="btn btn-secondary" onClick={() => mock.emit({ type: "key", k })}><Keyboard />按 K{k}</button>
                  ))}
                  <button className="btn btn-secondary" onClick={() => mock.emit({ type: "knob", minutes: 15 })}><Gauge />旋钮 15 分钟</button>
                  <button className="btn btn-ghost" onClick={() => mock.drop()}><WifiOff />模拟断线</button>
                </div>
                <div className="code-box">
                  <div className="hint">最近发送给设备的状态消息</div>
                  <pre>{JSON.stringify(mock.lastState ?? toOutbound(s), null, 2)}</pre>
                </div>
              </div>
            </Card>
          )}
        </div>
        <div className="stack">
          <Banner tone="info" icon={<Bluetooth className="i" />}>
            <b>网页蓝牙的限制</b>需要电脑版 Chrome 或 Edge，并且由你点击按钮才能连接。iPhone 上的 Safari 不支持网页蓝牙。网页关闭后不会保持连接，设备会按最近同步的计划表继续自动切换。
          </Banner>
          <Banner tone="info" icon={<Radio className="i" />}>
            <b>协议说明</b>网页和设备之间用 JSON 消息通信，字段草案见源码 <code>src/device/protocol.ts</code>，需要和固件一起确认后定稿。
          </Banner>
        </div>
      </div>
    </>
  );
}
