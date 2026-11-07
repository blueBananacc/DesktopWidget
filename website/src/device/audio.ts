export { b64ToU8 } from "./app";

/**
 * 设备音频帧解码：IMA-ADPCM（与固件 shougongpai.ino 的帧格式对齐）。
 * 每帧自洽：[pred_lo, pred_hi, stepIdx, 然后每字节两个 nibble（高 nibble=先到的采样）]
 * 帧间解码状态独立 → 丢一帧只留一个小缺口，不会糊掉后续音频。
 */

// IMA-ADPCM 标准表
const STEP = new Int32Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);
const INDEX = new Int8Array([-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]);

/** 解码一帧 ADPCM → 16kHz int16 PCM */
export function adpcmFrameToPcm(frame: Uint8Array): Int16Array {
  if (frame.length < 4) return new Int16Array(0);
  let pred = frame[0] | (frame[1] << 8);
  if (pred >= 0x8000) pred -= 0x10000;
  let idx = frame[2] > 88 ? 88 : frame[2];
  const out = new Int16Array((frame.length - 3) * 2);
  let n = 0;
  for (let i = 3; i < frame.length; i++) {
    const byte = frame[i];
    for (const nb of [byte >> 4, byte & 0x0f]) {
      const step = STEP[idx];
      let diff = step >> 3;
      if (nb & 4) diff += step;
      if (nb & 2) diff += step >> 1;
      if (nb & 1) diff += step >> 2;
      pred = nb & 8 ? pred - diff : pred + diff;
      pred = Math.max(-32768, Math.min(32767, pred));
      idx = Math.max(0, Math.min(88, idx + INDEX[nb]));
      out[n++] = pred;
    }
  }
  return out;
}

/** PCM → 一帧 ADPCM（与固件 adpcmEmit 同算法；MockDevice 模拟设备用）。帧头 = 本帧编码前的状态 */
export function pcmToAdpcmFrame(samples: Int16Array, st: { pred: number; idx: number }): Uint8Array {
  const u8 = new Uint8Array(3 + Math.ceil(samples.length / 2));
  u8[0] = st.pred & 0xff; u8[1] = (st.pred >> 8) & 0xff; u8[2] = st.idx;   // 帧头：起始状态
  let { pred, idx } = st;
  let hi = true, pos = 3;
  for (const sample of samples) {
    let diff = sample - pred;
    let nb = 0;
    if (diff < 0) { nb = 8; diff = -diff; }
    let step = STEP[idx], vpd = step >> 3;
    if (diff >= step) { nb |= 4; diff -= step; vpd += step; } step >>= 1;
    if (diff >= step) { nb |= 2; diff -= step; vpd += step; } step >>= 1;
    if (diff >= step) { nb |= 1;                vpd += step; }
    pred = Math.max(-32768, Math.min(32767, pred + (nb & 8 ? -vpd : vpd)));
    idx = Math.max(0, Math.min(88, idx + INDEX[nb]));
    if (hi) u8[pos] = nb << 4; else u8[pos++] |= nb;
    hi = !hi;
  }
  st.pred = pred; st.idx = idx;
  return u8;
}

/** 多帧 PCM 拼成标准 WAV Blob（16bit 单声道），可喂任意 ASR / <audio> 播放 */
export function pcmToWav(parts: Int16Array[], rate: number): Blob {
  let total = 0;
  for (const p of parts) total += p.length;
  const pcm = new Int16Array(total);
  let off = 0;
  for (const p of parts) { pcm.set(p, off); off += p.length; }

  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); v.setUint32(4, 36 + total * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);                                                        // mono
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);                    // rate / byteRate
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);                             // align / bits
  wstr(36, "data"); v.setUint32(40, total * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}
