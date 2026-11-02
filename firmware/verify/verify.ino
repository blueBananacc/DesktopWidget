/*
 * 烧录链路最小验证（无需接线）
 * 期望现象：板载 RGB 灯 红→绿→蓝 循环 + 串口 115200 每秒打印一行
 */
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[verify] boot ok");
}

int i = 0;
void loop() {
  uint8_t c = i % 3;
  rgbLedWrite(48, c == 0 ? 32 : 0, c == 1 ? 32 : 0, c == 2 ? 32 : 0);
  Serial.printf("[verify] tick %d\n", i++);
  delay(500);
}
