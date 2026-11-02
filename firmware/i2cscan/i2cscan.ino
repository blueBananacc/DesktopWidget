/*
 * I2C 总线扫描：验证 OLED 接线
 * 期望：串口输出 found 0x3C（OLED 地址）
 * 只探测地址，不写数据，对模块零风险
 */
#include <Wire.h>
void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(8, 9);   // SDA=GPIO8, SCL=GPIO9
  Wire.setClock(100000);
  Serial.println("[i2c] scanning SDA=8 SCL=9 ...");
  uint8_t n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[i2c] found 0x%02X\n", a);
      n++;
    }
  }
  Serial.printf("[i2c] done, %d device(s)\n", n);
}
void loop() {}
