// wasmtest.ino — 路径 B 可行性验证：ESP32-S3 + wasm3 执行 WASM 屏幕程序
// 宿主 API：clear / show / px / millis，wasm 模块每帧调 run() 自绘弹跳小球
#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <wasm3.h>
#include "wasmBall.h"

#define OLED_SDA 8
#define OLED_SCL 9
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

// ---------------- 宿主函数（供 wasm 模块 import "env.*"） ----------------
// px: 写 u8g2 页序帧缓冲（128×64 → buf[(y>>3)*128 + x] |= 1<<(y&7)），越界裁剪
m3ApiRawFunction(m3_px) {
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  if (x >= 0 && x < 128 && y >= 0 && y < 64)
    oled.getBufferPtr()[(y >> 3) * 128 + x] |= (uint8_t)(1 << (y & 7));
  m3ApiSuccess();
}
m3ApiRawFunction(m3_clear)  { oled.clearBuffer(); m3ApiSuccess(); }
m3ApiRawFunction(m3_show)   { oled.sendBuffer();  m3ApiSuccess(); }
m3ApiRawFunction(m3_millis) { m3ApiReturnType(uint32_t); m3ApiReturn((uint32_t)millis()); }

IM3Runtime   rt;
IM3Function  wasmRun;

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[WASM-TEST] boot");
  Serial.printf("[WASM-TEST] free heap before: %u\n", ESP.getFreeHeap());

  Wire.begin(OLED_SDA, OLED_SCL);
  oled.begin();
  oled.enableUTF8Print();

  IM3Environment env = m3_NewEnvironment();
  rt = m3_NewRuntime(env, 16 * 1024, NULL);          // wasm 栈 + 线性内存预算
  if (!rt) { Serial.println("[WASM-TEST] runtime alloc failed"); return; }

  IM3Module mod;
  M3Result r = m3_ParseModule(env, &mod, wasmBall, sizeof wasmBall);
  if (r) { Serial.printf("[WASM-TEST] parse: %s\n", r); return; }
  r = m3_LoadModule(rt, mod);
  if (r) { Serial.printf("[WASM-TEST] load: %s\n", r); return; }

  m3_LinkRawFunction(mod, "env", "clear",  "v()",   &m3_clear);
  m3_LinkRawFunction(mod, "env", "show",   "v()",   &m3_show);
  m3_LinkRawFunction(mod, "env", "px",     "v(ii)", &m3_px);
  m3_LinkRawFunction(mod, "env", "millis", "i()",   &m3_millis);
  if (r) { Serial.printf("[WASM-TEST] link: %s\n", r); return; }

  r = m3_FindFunction(&wasmRun, rt, "run");
  if (r) { Serial.printf("[WASM-TEST] find run: %s\n", r); return; }

  Serial.printf("[WASM-TEST] free heap after: %u (wasm %u bytes)\n", ESP.getFreeHeap(), sizeof wasmBall);
  Serial.println("[WASM-TEST] running");
}

void loop() {
  M3Result r = m3_CallV(wasmRun);                     // run() 内部用 millis() 算 tick
  if (r) Serial.printf("[WASM-TEST] call: %s\n", r);  // wasm trap 会在这报出来
  delay(30);                                          // ~30fps 上限，实际帧率看日志
}
