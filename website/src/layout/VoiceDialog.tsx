import { useState } from "react";
import { Mic, Sparkles } from "lucide-react";
import { Modal } from "../ui/Primitives";
import { parseCommand } from "../domain/voiceParse";
import { atToday } from "../domain/time";
import type { ParsedCommand } from "../domain/voiceParse";
import { useStore } from "../store/AppStore";
import { useToast } from "../ui/Toast";

const EXAMPLES = ["提醒我今天下班后带狗狗看医生", "设置 45 分钟专注倒计时", "下午 4 点半提醒我给客户回邮件"];

export function VoiceDialog({ onClose }: { onClose: () => void }) {
  const { actions, device } = useStore();
  const toast = useToast();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedCommand | null>(null);

  const confirm = () => {
    if (!parsed || parsed.kind === "unknown") return;
    if (parsed.kind === "timer") {
      actions.startTimer(parsed.minutes);
      toast({ message: `已开始 ${parsed.minutes} 分钟专注倒计时` });
    } else {
      if (device.state !== "connected") { toast({ message: "待办存在设备上——先连接设备再创建" }); return; }
      actions.deviceTodoAdd({
        text: parsed.title,
        at: parsed.trigger === "time" ? atToday(parsed.at!, Date.now()) : undefined,
        trig: parsed.trigger === "afterOffwork" ? "offwork" : undefined,
        show: parsed.trigger === "afterOffwork",
        src: "voice",
      });
      toast({ message: "提醒已创建（存到设备）" });
    }
    onClose();
  };

  return (
    <Modal
      title="说一句话，创建提醒"
      onClose={onClose}
      footer={
        parsed && parsed.kind !== "unknown" ? (
          <>
            <button className="btn btn-ghost" onClick={() => setParsed(null)}>重新输入</button>
            <button className="btn btn-primary" onClick={confirm}>确认创建</button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => setParsed(parseCommand(text))}>
            <Sparkles />解析
          </button>
        )
      }
    >
      {!parsed || parsed.kind === "unknown" ? (
        <div className="grid" style={{ gap: 12 }}>
          <div className="voice-input">
            <span className="tile t-pink"><Mic /></span>
            <input autoFocus className="input" placeholder="例如：提醒我今天下班后带狗狗看医生" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && setParsed(parseCommand(text))} />
          </div>
          {parsed?.kind === "unknown" && <div className="banner banner-warn"><div className="banner-txt">没听懂这句话，可以换个说法，或者到“待办与提醒”手动创建。</div></div>}
          <div className="row" style={{ gap: 6 }}>
            {EXAMPLES.map((e) => (
              <button key={e} className="btn btn-secondary btn-sm" onClick={() => setText(e)}>{e}</button>
            ))}
          </div>
          <p className="hint">录音和云端 AI 解析尚未接入，目前用文字输入，并使用本地规则演示“解析 → 确认 → 创建”的流程。云端解析不会保存原始录音。</p>
        </div>
      ) : (
        <div className="confirm-card">
          <div className="hint">请确认解析结果</div>
          {parsed.kind === "timer" ? (
            <>
              <b>开始专注倒计时</b>
              <span>时长：{parsed.minutes} 分钟 · 设备显示“专注中”</span>
            </>
          ) : (
            <>
              <b>{parsed.title}</b>
              <span>{parsed.trigger === "afterOffwork" ? "触发：收工后 · 在设备上显示，仅自己可见" : `触发：今天 ${parsed.at}`}</span>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
