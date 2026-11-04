import type { StatusId } from "../domain/types";
import { statusMeta } from "../domain/statuses";

export function Oled({ status, sub, ledOn = true, glow, unknown }: { status: StatusId; sub: string; ledOn?: boolean; glow?: boolean; unknown?: boolean }) {
  const meta = statusMeta(status);
  if (unknown) {
    return (
      <div className="oled" aria-label="设备显示：未连接">
        <div>
          <div className="big">--:--</div>
          <div className="sub">未连接</div>
        </div>
        <div className="ico" />
        <div className="led" style={{ background: "transparent" }} />
      </div>
    );
  }
  return (
    <div className="oled" aria-label={`设备显示：${meta.screen}，${sub}`}>
      <div>
        <div className="big">{meta.screen}</div>
        <div className="sub">{sub}</div>
      </div>
      <div className={`ico pat-${meta.pattern}`} />
      <div className={`led ${glow ? "glow" : ""}`} style={{ background: ledOn ? meta.color : "transparent", color: meta.color }} />
    </div>
  );
}

export function DeviceMirror({ status, sub, ledOn, caption, flashKey, unknown }: { status: StatusId; sub: string; ledOn: boolean; caption: [string, string]; flashKey?: string; unknown?: boolean }) {
  return (
    <div className="mirror-wrap">
      <div key={flashKey} className="oled-swap">
        <Oled status={status} sub={sub} ledOn={ledOn} glow unknown={unknown} />
      </div>
      <div className="mirror-cap">
        <span>{caption[0]}</span>
        <span>{caption[1]}</span>
      </div>
    </div>
  );
}
