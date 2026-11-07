# 收工牌固件（ESP32-S3）

## 接线（已实测，详见 ../doc/HARDWARE.md §14）

| 模块 | 引脚 | 接开发板 |
|---|---|---|
| OLED | GND / VCC / SCL / SDA | GND / 3V3 / GPIO9 / GPIO5 |
| 按键（丝印 GND K4 K3 K2 K1） | GND + K1 K2 K3 K4 | GND + GPIO17 16 15 7 |
| 触摸 TTP223 | SIG / VCC / GND | GPIO4 / 3V3 / GND（高电平=摸到） |
| 旋钮 EC11（丝印 GND S1 S2 KEY 5V） | S1/S2/KEY/5V/GND | GPIO1 / GPIO40 / GPIO42 / 3V3 / GND |
| 麦克风（丝印 SCK WS L/R + SD VDD GND） | VDD/SCK/WS/SD/GND/L/R | 3V3 / GPIO47 / GPIO21 / GPIO10 / GND×2 |
| 板载 RGB | — | 已在板上（GPIO48） |
| 触摸电极（可选） | 铜箔×2 | GPIO13 / GPIO14 |

烧录口 = 右侧 Type-C（CH343，Windows 上 COM8）；驱动名不带 `(COMx)`。
完整编译/烧录命令（N16R8 需 16M Flash + 八线 PSRAM）：

```
arduino-cli compile -b "esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi,PartitionScheme=esp_sr_16" shougongpai
arduino-cli upload  -p COM8 -b "同上" shougongpai
```

**分区方案 = `esp_sr_16`**（v0.7 起）：APP 3MB×2（保留 OTA 槽）、SPIFFS/LittleFS 6MB、MODEL 3.9MB（ESP-SR 唤醒/口令模型预留，已烧核心包自带 `srmodels.bin`）。之前默认方案 APP 仅 1.25MB 已用 99%。
⚠️ 首次切换到该方案会全片重刷、**LittleFS 数据清空**（wasm 应用/提醒需重新下发）。
⚠️ 若 upload 报 `srmodels.bin` 缺失：从 `esp32s3-libs/<版本>/esp_sr/srmodels.bin` 拷进 sketch 构建目录（`%LOCALAPPDATA%\arduino\sketches\<hash>\`）后重试。
旋钮 S2 当前未接线时固件走单相兜底：转动=向前，**按住 KEY 转=反向**；S2 接回 GPIO40 自动恢复原生双向。
麦克风经 `stt` 消息驱动：网页发 `{"type":"stt","op":"start"}` 设备按 `aud` 帧上行 IMA-ADPCM 音频（16kHz，帧自洽 [pred,idx,nibbles]），`sttState` 报状态；60s 自动收尾、断线即停。录音中 OLED 显示"录音中"、RGB 红灯慢呼吸。

## 软件准备

1. 装 **CH343 串口驱动**（烧录、日志用带串口芯片的那个 Type-C 口）。
2. Arduino IDE → 首选项 → 附加开发板管理器网址加
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   → 开发板管理器装 **esp32**（Espressif，≥3.x）。
3. 库管理器装：**NimBLE-Arduino**（h2zero，2.x）、**U8g2**、**Adafruit NeoPixel**、**ArduinoJson**（7.x）。
4. 开发板选 **ESP32S3 Dev Module**；**Flash Size 选 16MB、PSRAM 选 OPI、Partition Scheme 选 `ESP SR 16M (3MB APP/6MB SPIFFS/3.9MB MODEL)`**；USB CDC On Boot 可设为 Enabled 看串口日志更方便。

## 烧录与验证

1. `shougongpai/shougongpai.ino` 用 Arduino IDE 打开，选串口，上传。
2. 串口监视器 **460800**：应看到 `[BLE] advertising Shougong-A1`（v0.6 起波特率由 115200 升至 460800，音频帧流需要带宽；测试固件 mictest/i2cscan 仍是 115200）。
3. 打开网站（localhost），设备页 → 蓝牙连接 → 选 `Shougong-A1`。
4. 期望行为：
   - OLED 显示网页当前状态大字；断连显示空心点 + "本地演示"可按键翻页。
   - 网页切换状态 → OLED 字变、RGB 灯变对应颜色。
   - 设置页/总览调亮度 → 灯亮度实时变。
   - K3/K4 按下 → 网页状态按触摸区映射切换（左=工作中，右=勿扰）。
   - K1 按下 → 网页触发收工键；K2 短按/长按 → 快捷键行为。
5. 有铜箔电极后：把 `ENABLE_CAPSENSE` 改 1 重烧，K3/K4 自动让位。

## 协议速查（v0.9 起：HTTP 隧道，JSON 行协议已废除）

字节流上跑 HTTP/1.1 子集——规范全文在 `../doc/http-api/`（[tunnel.md](../doc/http-api/tunnel.md) 分帧 / [events.md](../doc/http-api/events.md) 事件目录 / [openapi/](../doc/http-api/openapi/) 资源定义）：

- 请求帧：`GET /api/state HTTP/1.1` + `X-Request-Id` + `X-Api-Sem-Ver` + `Content-Length`，响应按 `X-Request-Id` 关联
- 事件流：`GET /api/events` 订阅 → 设备推 `text/event-stream` 帧（每事件一个独立 200 帧，body 为一个 SSE 事件）
- 冒烟脚本：`keytest/serial-http.ps1 -Port COM8`；电脑侧集成用 `../bridge/`（本地真 HTTP + SSE）
- BLE：NUS 风格 UUID（service `6e400001-…`），RX write（网页→设备）/ TX notify（设备→网页），200B 分片由隧道自行分帧
