/*
 * INMP441 麦克风测试：I2S RX 电平表
 * 接线：SCK=47, WS=21, SD=10, VDD=3V3, GND, L/R=GND(左声道)
 * 现象：串口每 ~200ms 打一行电平条；说话/敲击时条变长 = 麦克风工作
 */
#include "driver/i2s.h"

constexpr int PIN_SCK = 47, PIN_WS = 21, PIN_SD = 10;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[mic] INMP441 test, SCK=47 WS=21 SD=10");

  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = 16000;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;   // INMP441 输出 24bit/32bit 槽
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;    // L/R 接地 = 左声道
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 256;
  cfg.use_apll = false;
  cfg.tx_desc_auto_clear = false;
  cfg.fixed_mclk = 0;

  i2s_pin_config_t pins = {};
  pins.bck_io_num = PIN_SCK;
  pins.ws_io_num = PIN_WS;
  pins.data_out_num = I2S_PIN_NO_CHANGE;
  pins.data_in_num = PIN_SD;

  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr) != ESP_OK) {
    Serial.println("[mic] driver install FAILED"); return;
  }
  if (i2s_set_pin(I2S_NUM_0, &pins) != ESP_OK) {
    Serial.println("[mic] set pin FAILED"); return;
  }
  i2s_start(I2S_NUM_0);
  Serial.println("[mic] running, speak / tap the mic ...");
}

void loop() {
  static int32_t buf[256];
  size_t br = 0;
  i2s_read(I2S_NUM_0, buf, sizeof buf, &br, 100);
  int n = br / 4;
  if (!n) { delay(50); return; }

  int64_t peak = 0, sum2 = 0;
  for (int i = 0; i < n; i++) {
    int32_t v = buf[i] >> 16;                 // 取高 16 位当幅度
    int64_t a = v < 0 ? -(int64_t)v : v;
    if (a > peak) peak = a;
    sum2 += (int64_t)v * v;
  }
  int rms = (int)sqrt((double)sum2 / n);

  // 电平条：满刻度 ~32767，取对数刻度更容易看到轻声
  int bars = 0;
  for (int t = 64; t <= 32768 && peak >= t; t <<= 1) bars++;
  if (bars > 30) bars = 30;
  char line[40]; memset(line, ' ', 39); line[39] = 0;
  for (int i = 0; i < bars; i++) line[i] = '#';
  Serial.printf("[mic] peak=%6d rms=%6d |%s\n", (int)peak, rms, line);
  delay(180);
}
