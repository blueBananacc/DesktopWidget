/*
 * I2C 总线扫描：验证 OLED 接线
 * 期望：串口输出 found 0x3C（OLED 地址）
 * 只探测地址，不写数据，对模块零风险
 */
#include <Wire.h>
void setup() {
  Serial.begin(115200);
  delay(500);
  // 先测线路静态电平：OLED 板载 4.7k 上拉若已供电，SDA/SCL 应读 HIGH
  pinMode(5, INPUT); pinMode(9, INPUT);
  delay(10);
  Serial.printf("[i2c] idle levels: SDA=%d SCL=%d (1=模块上拉已供电, 0=未供电/被拉低)\n",
                digitalRead(5), digitalRead(9));
  Wire.begin(5, 9);   // SDA=GPIO5, SCL=GPIO9
  Wire.setClock(100000);
  Serial.println("[i2c] scanning SDA=5 SCL=9 ...");
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
void loop() {
  delay(3000);   // 每 3 秒重扫，方便边调整接线边观察
  Serial.println("[i2c] rescan...");
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) Serial.printf("[i2c] found 0x%02X\n", a);
  }
  Serial.println("[i2c] rescan done");
}
