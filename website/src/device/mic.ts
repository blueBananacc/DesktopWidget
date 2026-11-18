// 浏览器侧麦克风采集——对应参考固件的"配套端负责拾音"模型：
// BUSY Bar 本体没有麦克风/ASR，语音由配套 App 采集并转成文本后再注入设备。
// 我们的网页即配套端：getUserMedia 拿到 PCM，降采样到 16kHz 单声道 Int16，
// 与设备 ADPCM 链路共用同一个 WAV→ASR 出口。
export interface MicCapture {
  /** 停止采集并返回全部 16kHz 采样（Int16 单声道） */
  stop(): Int16Array[];
  /** 放弃采集（出错/取消时不产出数据） */
  cancel(): void;
  readonly rate: number;
}

const TARGET_RATE = 16000;

/** 线性降采样到 16kHz（人声识别足够，比保留原始采样率省一大半 ASR 上传体积） */
const downsample = (chunks: Float32Array[], srcRate: number): Int16Array => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(total / ratio);
  const out = new Int16Array(outLen);
  let off = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const idx = Math.floor((off + i) / ratio);
      if (idx < outLen) out[idx] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767)));
    }
    off += c.length;
  }
  return out;
};

/**
 * 开始采集浏览器麦克风。拒绝授权/无设备时抛错。
 * 用 AudioContext + ScriptProcessor 收集 Float32 PCM（已弃用但全浏览器可用；
 * AudioWorklet 需要独立模块文件，收益只是消掉弃用警告）。
 */
export const startMicCapture = async (): Promise<MicCapture> => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let done = false;

  proc.onaudioprocess = (e) => {
    if (done) return;
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  src.connect(proc);
  proc.connect(ctx.destination); // ScriptProcessor 必须接 destination 才会回调；输出为零值不构成回放

  const release = () => {
    done = true;
    proc.onaudioprocess = null;
    try { src.disconnect(); proc.disconnect(); } catch { /* 已断开 */ }
    for (const t of stream.getTracks()) t.stop();
    void ctx.close().catch(() => {});
  };

  return {
    rate: TARGET_RATE,
    stop() {
      release();
      return [downsample(chunks, ctx.sampleRate)];
    },
    cancel() {
      release();
    },
  };
};
