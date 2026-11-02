# 收工牌固件（ESP32-S3）

## 接线（已实测，详见 ../../HARDWARE.md §14）

| 模块 | 引脚 | 接开发板 |
|---|---|---|
| OLED | GND / VCC / SCL / SDA | 左排 GND / 左排 3V3 / GPIO9 / GPIO8 |
| 按键（丝印 GND K4 K3 K2 K1） | GND + K1 K2 K3 K4 | 右排顶 GND + GPIO4 5 6 7 |
| 麦克风（丝印 SCK WS L/R + SD VDD GND） | VDD/SCK/WS/SD/GND/L/R | 左排 3V3 / GPIO1 / GPIO2 / GPIO42 / GND×2 |
| 板载 RGB | — | 已在板上（GPIO48） |
| 触摸电极（可选） | 铜箔×2 | GPIO13 / GPIO14 |

烧录口 = 右侧 Type-C（CH343，Windows 上 COM8）；驱动名不带 `(COMx)`，
烧录用 `arduino-cli upload -p COM8`。麦克风在 v0.1 固件中不驱动。

## 软件准备

1. 装 **CH343 串口驱动**（烧录、日志用带串口芯片的那个 Type-C 口）。
2. Arduino IDE → 首选项 → 附加开发板管理器网址加
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   → 开发板管理器装 **esp32**（Espressif，≥3.x）。
3. 库管理器装：**NimBLE-Arduino**（h2zero，2.x）、**U8g2**、**Adafruit NeoPixel**、**ArduinoJson**（7.x）。
4. 开发板选 **ESP32S3 Dev Module**；USB CDC On Boot 可设为 Enabled 看串口日志更方便。

## 烧录与验证

1. `shougongpai/shougongpai.ino` 用 Arduino IDE 打开，选串口，上传。
2. 串口监视器 115200：应看到 `[BLE] advertising Shougong-A1`。
3. 打开网站（localhost），设备页 → 蓝牙连接 → 选 `Shougong-A1`。
4. 期望行为：
   - OLED 显示网页当前状态大字；断连显示空心点 + "本地演示"可按键翻页。
   - 网页切换状态 → OLED 字变、RGB 灯变对应颜色。
   - 设置页/总览调亮度 → 灯亮度实时变。
   - K3/K4 按下 → 网页状态按触摸区映射切换（左=工作中，右=勿扰）。
   - K1 按下 → 网页触发收工键；K2 短按/长按 → 快捷键行为。
5. 有铜箔电极后：把 `ENABLE_CAPSENSE` 改 1 重烧，K3/K4 自动让位。

## 协议速查

- 下行 `state`：`{type,status,screen,sub,until,led(solid|breath|off),brightness(0-100),ts}`
- 下行 `time`：`{type,epoch(ms),tzOffsetMin}` —— OLED 右上角时钟
- 上行：hello / touch(left|right) / shortcut(single|long) / offworkKey
- 分包：JSON + `\n` 分帧，网页侧按 180 字节切片，固件按行重组
