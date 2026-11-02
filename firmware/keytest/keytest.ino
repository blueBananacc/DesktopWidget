/*
 * OLED + 按键联合测试
 * 期望：屏幕显示"接线测试"和 K1-K4 状态；按下按键对应位变 1
 * 用途：验证 OLED 显示、中文渲染、按键模块 GND+K1~K4 映射
 */
#include <U8g2lib.h>

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, 9, 8);
const uint8_t keys[4] = {4, 5, 6, 7};   // K1 K2 K3 K4

void setup() {
  Serial.begin(115200);
  delay(300);
  for (auto p : keys) pinMode(p, INPUT_PULLUP);
  oled.begin();
  oled.enableUTF8Print();
  Serial.println("[test] oled+keys ready, 按 K1-K4 观察");
}

void loop() {
  int k[4];
  for (int i = 0; i < 4; i++) k[i] = digitalRead(keys[i]) == LOW;

  oled.clearBuffer();
  oled.setFont(u8g2_font_wqy16_t_gb2312);
  oled.drawUTF8(28, 30, "接线测试");
  oled.setFont(u8g2_font_wqy12_t_gb2312);
  char buf[40];
  snprintf(buf, sizeof buf, "K1:%d K2:%d", k[0], k[1]);
  oled.drawUTF8(8, 50, buf);
  snprintf(buf, sizeof buf, "K3:%d K4:%d", k[2], k[3]);
  oled.drawUTF8(8, 63, buf);
  oled.sendBuffer();

  static int prev = -1;
  int st = k[0] | k[1] << 1 | k[2] << 2 | k[3] << 3;
  if (st != prev) {
    Serial.printf("[key] K1=%d K2=%d K3=%d K4=%d\n", k[0], k[1], k[2], k[3]);
    prev = st;
  }
  delay(50);
}
