/*
 * 收工牌 固件 v0.1（ESP32-S3，Arduino IDE）
 *
 * 功能：
 *  - BLE GATT 服务器（NUS 风格）：网页写入 JSON 命令，设备 notify 上报事件
 *  - OLED（SSD1315/SSD1306，I2C）显示网页下发的状态大字 + 副标题 + 时间
 *  - 板载 WS2812 RGB（GPIO48）按状态变色，支持亮度与呼吸模式
 *  - 4 位按键：K1 收工键 / K2 快捷键（短按、长按）/ K3·K4 暂代左右触摸区
 *  - 电容触摸区（GPIO13/14 + 铜箔电极）代码已写好，ENABLE_CAPSENSE 置 1 启用
 *  - 休息提醒：设备自治累计工作类状态时长，到点 OLED 提醒 + RGB 闪烁 3s，自动下一轮
 *  - 计划表：网页 schedule 消息下发后由设备自治执行（需先校时一次；之后不断电即可断连自治）
 *
 * 依赖库（Arduino 库管理器安装）：
 *  - NimBLE-Arduino 2.x（h2zero）
 *  - U8g2（oliver）
 *  - Adafruit NeoPixel
 *  - ArduinoJson 7（bblanchon）
 *
 * 开发板选择：ESP32S3 Dev Module；PSRAM 可关。烧录用 CH343 串口那个 Type-C 口。
 */

#include <Arduino.h>
#include <U8g2lib.h>
#include <NimBLEDevice.h>
#include <Adafruit_NeoPixel.h>
#include <ArduinoJson.h>

// ===================== 配置 =====================

#define FIRMWARE_VER   "0.4.0"
#define DEVICE_NAME    "Shougong-A1"
#define ENABLE_CAPSENSE 0   // 有铜箔电极接 GPIO13/14 后改为 1

// 引脚分配（与 HARDWARE.md 一致）
constexpr uint8_t PIN_SDA = 8, PIN_SCL = 9;        // OLED I2C
constexpr uint8_t PIN_RGB = 48;                     // 板载 WS2812
constexpr uint8_t KEY_OFFWORK = 4;                  // K1 收工键
constexpr uint8_t KEY_SHORTCUT = 5;                 // K2 自定义键
constexpr uint8_t KEY_TOUCH_L = 6;                  // K3 暂代触摸区·左
constexpr uint8_t KEY_TOUCH_R = 7;                  // K4 暂代触摸区·右
constexpr uint8_t TOUCH_L = 13, TOUCH_R = 14;       // 电容触摸电极（可选）

// BLE UUID —— 与 website/src/device/protocol.ts 保持一致
static const char* SVC_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char* RX_UUID  = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // 网页→设备
static const char* TX_UUID  = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // 设备→网页

// ===================== 状态颜色（与 DESIGN_SPEC 一致） =====================

struct StatusDef { const char* id; uint8_t r, g, b; const char* zh; const char* hint; };
const StatusDef STATUSES[] = {
  { "work",  34, 160, 107, "工作中",   "可以找我" },
  { "busy", 229,  72,  77, "请勿打扰", "先别打扰" },
  { "focus",180,  35,  44, "专注中",   "深度专注" },
  { "meet", 124,  92, 250, "会议中",   "请稍等" },
  { "rest",  14, 165, 183, "休息一下", "马上回来" },
  { "off",   59,  66,  82, "已收工",   "明天见" },
};
const StatusDef* findStatus(const char* id) {
  for (auto& s : STATUSES) if (!strcmp(s.id, id)) return &s;
  return &STATUSES[0];
}
// 工作类状态：休息提醒只在这些状态下累计（与网页 STATUSES.workLike 一致）
bool isWorkLike(const char* id) {
  return !strcmp(id, "work") || !strcmp(id, "busy") || !strcmp(id, "focus");
}

// ===================== 外设 =====================

U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE, PIN_SCL, PIN_SDA);
Adafruit_NeoPixel rgb(1, PIN_RGB, NEO_GRB + NEO_KHZ800);
NimBLECharacteristic* txChar = nullptr;

// ===================== 运行状态 =====================

String  rxBuf;                    // BLE 分包累积缓冲（\n 分帧）
bool    bleConnected = false;
bool    wantHello = false;        // 客户端订阅 TX 后发 hello

String  curStatusId = "work";     // 开机默认工作中：不连接也可用
String  scrMain = "工作中", scrSub = "可以找我";
String  ledMode = "solid";        // solid / breath / off
uint8_t ledBrightness = 40;       // 网页下发 0–100
bool    oledDirty = true;

// 时间同步（网页发 time 消息）
int64_t epochBase = -1;           // 同步时刻的 epoch(ms)；-1 = 未校时
uint32_t epochBaseMs = 0;
int32_t tzOffsetMin = 480;        // 默认 UTC+8

// 休息提醒（设备自治计时；网页/app 只同步设置与镜像显示）
uint16_t breakMinutes = 45;       // 提醒间隔（网页 break 消息可改）
bool     breakEnabled = true;
bool     breakOffToday = false;   // 网页“今天不再提醒”
uint32_t breakAccumMs = 0;        // 本轮已累计的工作类时长
uint32_t breakLastMs = 0;         // 上次累加基准
uint32_t breakFlashUntil = 0;     // RGB 闪烁截止时间
uint32_t breakNoticeUntil = 0;    // OLED 提醒画面截止时间
uint32_t breakReportMs = 0;       // breakState 心跳
int32_t  breakDay = -1;           // 已校时的日期编号，跨天自动清零
uint32_t lastWantTime = 0;        // 未校时时定期向网页/app 请求 time 消息

// 计划表（网页下发后设备自治执行；只存生效的一张表。校时过一次即永久可用，直到断电）
struct SchedNode { uint16_t min; char status[8]; };
SchedNode schedNodes[32];
int      schedCount = 0;
uint8_t  schedWeekdays = 0x7F;    // kind=repeat：bit0=周日…bit6=周六；缺省每天适用（兼容旧格式）
bool     schedDateSet = false;    // kind=date 时才看下面三个字段
int      schedY = 0, schedMo = 0, schedD = 0;
bool     schedPaused = false;     // 网页 pausedToday：今天暂停执行
bool     schedModeToday = false;  // mode="today"：手动切状态则今天暂停（对应 overrideMode=pauseToday）
bool     schedPausedLocal = false;// mode=today 下本地手动干预导致的今日暂停（跨天清除，网页快照不清它）
bool     schedHold = false;       // mode="next"：手动切状态后挂起，到下个节点恢复
int32_t  schedDay = -1;           // 计划表使用的日期编号（跨天重置暂停/挂起）
int      schedLastMin = -1;       // 上次执行检查的分钟，分钟粒度去重
int32_t  offSetDay = -1;          // 进入 off 状态的日期编号；当天的非 off 节点不再自动切（blockedByOffwork）
// 当日单日计划（override）：date==今天时覆盖主表执行，跨天自动失效；仍只占一份空间
SchedNode ovrNodes[16];
int      ovrCount = 0;
bool     ovrSet = false;
int      ovrY = 0, ovrMo = 0, ovrD = 0;

// 待办提醒（网页 reminder 消息）：OLED 覆盖 15s + RGB 闪烁 3s，任意按键提前关闭
uint32_t remindUntil = 0;
char     remindText[48] = "";
int      remindCount = 0;

// 按键映射（网页 keys 消息下发；设备离线时按此执行。cycleL/cycleR 为出厂默认，网页不下发这两个值）
char keyAct[4][12] = { "offwork", "busy", "cycleL", "cycleR" };  // K1 K2 K3 K4

// 今日状态区间记录（设备是时长记录权威；millis 域时间戳，推送时按校时基准换算 epoch）
struct Seg { char status[8]; uint32_t startMs; uint32_t endMs; };  // endMs=0 表示进行中
Seg      segs[96];
int      segCount = 0;
bool     segDirty = false;
uint32_t lastSegPush = 0;

// 本地时间换算（校时后可用）
int64_t localEpochMs() { return epochBase + millis() - epochBaseMs + (int64_t)tzOffsetMin * 60000; }
int32_t dayOf(int64_t e) { return (int32_t)(e / 86400000); }
int     minOf(int64_t e) { return (int)((e % 86400000) / 60000); }
int     weekdayOf(int32_t day) { return (int)((day + 4) % 7); }   // 0=周日；1970-01-01=周四
// 天数→年月日（Hinnant civil_from_days）
void daysToYMD(int32_t z, int &y, int &m, int &d) {
  z += 719468;
  const int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  const uint32_t doe = (uint32_t)(z - era * 146097);
  const uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  y = (int)yoe + era * 400;
  const uint32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const uint32_t mp = (5 * doy + 2) / 153;
  d = (int)(doy - (153 * mp + 2) / 5 + 1);
  m = (int)(mp < 10 ? mp + 3 : mp - 9);
  y += (m <= 2);
}
bool schedApplies(int32_t day) {
  if (schedDateSet) {
    int y, m, d; daysToYMD(day, y, m, d);
    return y == schedY && m == schedMo && d == schedD;
  }
  return (schedWeekdays >> weekdayOf(day)) & 1;
}
bool ovrApplies(int32_t day) {
  if (!ovrSet) return false;
  int y, m, d; daysToYMD(day, y, m, d);
  return y == ovrY && m == ovrMo && d == ovrD;
}
// 当天实际执行的节点表（单日计划优先，其次主表）。返回值/签名不含自定义类型，避开 .ino 自动原型提升的类型问题
const SchedNode* curTable = schedNodes;
int tableFor(int32_t day) {
  if (ovrApplies(day))   { curTable = ovrNodes;   return ovrCount; }
  if (schedApplies(day)) { curTable = schedNodes; return schedCount; }
  curTable = schedNodes; return 0;
}
// 应处节点索引（作用于 curTable）：最后一个 min <= nowMin 的节点，没有则 -1
int expectedIdxOf(int count, int nowMin) {
  int idx = -1;
  for (int i = 0; i < count; i++) if (curTable[i].min <= nowMin) idx = i;
  return idx;
}
// 手动切状态（按键或网页下发）且与计划应处状态不同 → 按模式挂起/暂停计划表
void registerManualOverride(const char* newStatus) {
  if (epochBase < 0) return;
  const int64_t e = localEpochMs();
  const int count = tableFor(dayOf(e));
  if (count == 0) return;
  const int exp = expectedIdxOf(count, minOf(e));
  if (exp >= 0 && !strcmp(curTable[exp].status, newStatus)) return;
  if (schedModeToday) schedPausedLocal = true; else schedHold = true;
}

void markStatus(const char* id) {
  const uint32_t now = millis();
  if (!strcmp(id, "off") && epochBase >= 0) offSetDay = dayOf(localEpochMs()); // 记录收工日，挡当天后续节点
  if (segCount > 0 && segs[segCount - 1].endMs == 0) segs[segCount - 1].endMs = now;
  if (segCount < 96) {
    strncpy(segs[segCount].status, id, sizeof(segs[0].status) - 1);
    segs[segCount].status[sizeof(segs[0].status) - 1] = 0;
    segs[segCount].startMs = now;
    segs[segCount].endMs = 0;
    segCount++;
  }
  segDirty = true;
}

// 推送今日全部区间：segBegin → N×seg → segEnd。仅在校时后推送（millis → epoch 换算）
void sendSegments() {
  if (epochBase < 0 || segCount == 0) return;
  sendLine(F("{\"type\":\"segments\",\"phase\":\"begin\"}"));
  for (int i = 0; i < segCount; i++) {
    char buf[128];
    const int64_t start = epochBase + (int64_t)segs[i].startMs - epochBaseMs;
    if (segs[i].endMs)
      snprintf(buf, sizeof buf, "{\"type\":\"seg\",\"status\":\"%s\",\"start\":%lld,\"end\":%lld}",
        segs[i].status, start, epochBase + (int64_t)segs[i].endMs - epochBaseMs);
    else
      snprintf(buf, sizeof buf, "{\"type\":\"seg\",\"status\":\"%s\",\"start\":%lld}", segs[i].status, start);
    sendLine(buf);
  }
  sendLine(F("{\"type\":\"segments\",\"phase\":\"end\"}"));
  segDirty = false;
  lastSegPush = millis();
}

// ===================== 发送事件给网页 =====================

void sendLine(const String& json) {
  Serial.println(json);                      // 串口通道（与日志同口，网页只解析 JSON 行）
  if (txChar) {
    String out = json + "\n";
    txChar->setValue((const uint8_t*)out.c_str(), out.length());
    txChar->notify();
  }
  Serial.printf("[TX] %s\n", json.c_str());
}

// 上报休息提醒计时：网页据此镜像进度环
void sendBreakState(bool due) {
  char buf[160];
  snprintf(buf, sizeof buf,
    "{\"type\":\"breakState\",\"minutes\":%u,\"accumMs\":%lu,\"enabled\":%s,\"offToday\":%s,\"due\":%s}",
    (unsigned)breakMinutes, (unsigned long)breakAccumMs,
    breakEnabled ? "true" : "false", breakOffToday ? "true" : "false", due ? "true" : "false");
  sendLine(buf);
}

// ===================== 显示 =====================

void drawOled() {
  // 提醒画面最优先；其次休息提醒：覆盖状态显示，任意按键提前关闭
  const bool remind = millis() < remindUntil;
  const bool notice = !remind && millis() < breakNoticeUntil;
  const char* main = remind ? "有新待办" : notice ? "起来活动一下" : scrMain.c_str();
  char subBuf[48];
  const char* sub = remind
    ? (remindText[0] ? remindText : (snprintf(subBuf, sizeof subBuf, "有 %d 条待办", remindCount), subBuf))
    : notice ? "下一轮计时已开始" : scrSub.c_str();
  oled.clearBuffer();
  // 左上角连接状态点
  if (bleConnected) oled.drawDisc(6, 6, 3); else oled.drawCircle(6, 6, 3);
  // 右上角时间
  oled.setFont(u8g2_font_wqy12_t_gb2312);
  char clockBuf[8];
  if (epochBase >= 0) {
    int64_t now = epochBase + (int64_t)millis() - epochBaseMs;
    int mins = (int)((now / 60000 + tzOffsetMin) % 1440);
    snprintf(clockBuf, sizeof clockBuf, "%02d:%02d", mins / 60, mins % 60);
  } else {
    strcpy(clockBuf, "--:--");
  }
  oled.drawUTF8(128 - oled.getUTF8Width(clockBuf), 12, clockBuf);
  // 状态大字（中文 16px，最多 4 字=64px 宽，居中）
  oled.setFont(u8g2_font_wqy16_t_gb2312);
  oled.drawUTF8((128 - oled.getUTF8Width(main)) / 2, 36, main);
  // 副标题 12px 居中
  oled.setFont(u8g2_font_wqy12_t_gb2312);
  oled.drawUTF8((128 - oled.getUTF8Width(sub)) / 2, 56, sub);
  oled.sendBuffer();
}

// ===================== RGB 灯 =====================

void updateLed() {
  const StatusDef* st = findStatus(curStatusId.c_str());
  uint8_t b = (uint16_t)ledBrightness * 255 / 100;
  if (!strcmp(ledMode.c_str(), "breath")) {
    float t = millis() / 1800.0f;
    float wave = 0.5f - 0.5f * cosf(2 * PI * fmodf(t, 1.0f));
    b = (uint8_t)(b * (0.15f + 0.85f * wave));
  }
  if (!strcmp(ledMode.c_str(), "off")) b = 0;
  // 休息提醒到点：状态色 4Hz 闪烁 3 秒，覆盖常规灯效
  if (millis() < breakFlashUntil) b = ((millis() / 125) % 2) ? 220 : 0;
  rgb.setBrightness(255);  // 直接手动缩放，避免 setBrightness 的衰减累积
  rgb.setPixelColor(0,
    (uint8_t)(st->r * b / 255), (uint8_t)(st->g * b / 255), (uint8_t)(st->b * b / 255));
  rgb.show();
}

// ===================== 消息处理 =====================

void handleLine(const String& line) {
  Serial.printf("[BLE←] %s\n", line.c_str());
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;
  const char* type = doc["type"] | "";
  if (!strcmp(type, "state")) {
    const char* st = doc["status"] | "work";
    String nId = st;
    String nm = doc["screen"] | findStatus(st)->zh;
    String ns = doc["sub"] | "";
    String lm = doc["led"] | "solid";
    uint8_t br = doc["brightness"] | 40;
    // 与当前完全一致时跳过：避免同状态重按导致 OLED 闪屏
    if (nId != curStatusId || nm != scrMain || ns != scrSub || lm != ledMode || br != ledBrightness) {
      if (nId != curStatusId) { markStatus(st); registerManualOverride(st); }
      curStatusId = nId; scrMain = nm; scrSub = ns; ledMode = lm; ledBrightness = br;
      oledDirty = true;
    }
  } else if (!strcmp(type, "time")) {
    epochBase = (int64_t)doc["epoch"];
    epochBaseMs = millis();
    tzOffsetMin = doc["tzOffsetMin"] | 480;
    lastWantTime = millis();               // 下次重校在 10 分钟后
    segDirty = true;                       // 校时完成后可换算真实时间，安排推送
    oledDirty = true;
  } else if (!strcmp(type, "break")) {
    // 网页/app 下发休息提醒设置；accumMs 只在明确要求重置时才带，设备保持计时权威
    if (!doc["minutes"].isNull())   breakMinutes  = doc["minutes"];
    if (!doc["enabled"].isNull())   breakEnabled  = doc["enabled"];
    if (!doc["offToday"].isNull())  breakOffToday = doc["offToday"];
    if (!doc["accumMs"].isNull())   breakAccumMs  = doc["accumMs"];
    sendBreakState(false);                  // 回执：让网页立即对齐
  } else if (!strcmp(type, "schedule")) {
    // 网页把生效计划表完整下发；之后设备自治执行（repeat 按星期，date 按日期）
    schedCount = 0;
    schedWeekdays = 0;
    schedDateSet = false;
    const char* kind = doc["kind"] | "repeat";
    if (!strcmp(kind, "date")) {
      const char* d = doc["date"] | "";
      int y, m, dd;
      if (strlen(d) >= 8 && sscanf(d, "%d-%d-%d", &y, &m, &dd) == 3) {
        schedY = y; schedMo = m; schedD = dd; schedDateSet = true;
      }
    } else if (doc["weekdays"].is<JsonArray>()) {
      for (JsonVariant v : doc["weekdays"].as<JsonArray>()) schedWeekdays |= (uint8_t)(1u << (((int)v) % 7));
    } else {
      schedWeekdays = 0x7F;                 // 旧格式没带星期：当作每天适用
    }
    schedModeToday = !strcmp(doc["mode"] | "next", "today");
    schedPaused = doc["paused"] | false;    // 只更新网页侧暂停；本地干预标志不被快照覆盖
    for (JsonObject n : doc["nodes"].as<JsonArray>()) {
      const char* t = n["time"] | "";
      const char* st = n["status"] | "work";
      int hh, mm;
      if (schedCount < 32 && sscanf(t, "%d:%d", &hh, &mm) == 2) {
        schedNodes[schedCount].min = (uint16_t)(hh * 60 + mm);
        strncpy(schedNodes[schedCount].status, st, sizeof(schedNodes[0].status) - 1);
        schedNodes[schedCount].status[sizeof(schedNodes[0].status) - 1] = 0;
        schedCount++;
      }
    }
    // 按时间排序（网页已排序，防御性再来一遍）
    for (int i = 1; i < schedCount; i++) {
      SchedNode tmp = schedNodes[i];
      int j = i - 1;
      while (j >= 0 && schedNodes[j].min > tmp.min) { schedNodes[j + 1] = schedNodes[j]; j--; }
      schedNodes[j + 1] = tmp;
    }
    // 当日单日计划（override）：date==今天时覆盖主表
    ovrSet = false; ovrCount = 0;
    if (doc["override"].is<JsonObject>()) {
      JsonObject ov = doc["override"].as<JsonObject>();
      const char* d = ov["date"] | "";
      int y, m, dd;
      const bool ok = strlen(d) >= 8 && sscanf(d, "%d-%d-%d", &y, &m, &dd) == 3;
      for (JsonObject n : ov["nodes"].as<JsonArray>()) {
        const char* t = n["time"] | "";
        const char* st = n["status"] | "work";
        int hh, mm;
        if (ovrCount < 16 && sscanf(t, "%d:%d", &hh, &mm) == 2) {
          ovrNodes[ovrCount].min = (uint16_t)(hh * 60 + mm);
          strncpy(ovrNodes[ovrCount].status, st, sizeof(ovrNodes[0].status) - 1);
          ovrNodes[ovrCount].status[sizeof(ovrNodes[0].status) - 1] = 0;
          ovrCount++;
        }
      }
      if (ok && ovrCount) { ovrSet = true; ovrY = y; ovrMo = m; ovrD = dd; }
    }
    schedLastMin = -1;                      // 立即按新表重算一次
    Serial.printf("[SCHED] loaded %d nodes, weekdays=0x%02X date=%s ovr=%d paused=%d mode=%s\n",
      schedCount, schedWeekdays, schedDateSet ? "set" : "none", ovrCount, schedPaused, schedModeToday ? "today" : "next");
  } else if (!strcmp(type, "reminder")) {
    // 网页提醒到点：OLED 显示 15s + RGB 闪烁 3s；text 仅当用户允许上屏才携带
    const char* t = doc["text"] | "";
    strncpy(remindText, t, sizeof(remindText) - 1);
    remindText[sizeof(remindText) - 1] = 0;
    remindCount = doc["count"] | 1;
    remindUntil = millis() + 15000;
    breakFlashUntil = millis() + 3000;
    oledDirty = true;
    Serial.printf("[REMIND] %s x%d\n", remindText[0] ? remindText : "(private)", remindCount);
  } else if (!strcmp(type, "keys")) {
    // 按键映射下发：设备离线时按此执行（K1 仍须按住 1.5s）
    const char* ks[4] = { "k1", "k2", "k3", "k4" };
    for (int i = 0; i < 4; i++) {
      const char* a = doc[ks[i]] | "";
      if (strlen(a) && strlen(a) < sizeof(keyAct[0])) { strncpy(keyAct[i], a, sizeof(keyAct[0]) - 1); keyAct[i][sizeof(keyAct[0]) - 1] = 0; }
    }
    Serial.printf("[KEYS] %s %s %s %s\n", keyAct[0], keyAct[1], keyAct[2], keyAct[3]);
  } else if (!strcmp(type, "sync")) {
    wantHello = true;                        // 网页握手 → 回 hello
  }
}

// ===================== BLE 回调 =====================

class RxCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    const auto& v = c->getValue();      // data()/size() 在 1.x/2.x 都可用
    rxBuf.concat((const char*)v.data(), v.size());
    int i;
    while ((i = rxBuf.indexOf('\n')) >= 0) {
      String line = rxBuf.substring(0, i);
      rxBuf.remove(0, i + 1);
      if (line.length()) handleLine(line);
    }
  }
};

class TxCb : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo&, uint16_t subValue) override {
    if (subValue) wantHello = true;
  }
};

class SrvCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    bleConnected = true; oledDirty = true;
    Serial.println("[BLE] connected");
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    bleConnected = false; oledDirty = true;
    Serial.println("[BLE] disconnected, re-advertising");
    NimBLEDevice::startAdvertising();
  }
};

void setupBle() {
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(247);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new SrvCb());
  NimBLEService* svc = server->createService(SVC_UUID);
  NimBLECharacteristic* rx = svc->createCharacteristic(RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  txChar = svc->createCharacteristic(TX_UUID, NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
  rx->setCallbacks(new RxCb());
  txChar->setCallbacks(new TxCb());
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID(NimBLEUUID(SVC_UUID));
  adv->start();
  Serial.println("[BLE] advertising " DEVICE_NAME);
}

// ===================== 按键 =====================

struct Key { uint8_t pin; const char* ev1; const char* ev2; bool last; uint32_t t0; bool longSent; bool armed; bool sawPress; };
// ev1=按下即报，ev2=短按报/长按报另一值（K2）；armed=等到过一次真实高电平后才允许上报
Key keys[] = {
  { KEY_OFFWORK,  "offworkKey", nullptr, true, 0, false, false, false },
  { KEY_SHORTCUT, nullptr,      nullptr, true, 0, false, false, false },  // 特殊处理
  { KEY_TOUCH_L,  "touchL",     nullptr, true, 0, false, false, false },
  { KEY_TOUCH_R,  "touchR",     nullptr, true, 0, false, false, false },
};
constexpr uint32_t DEBOUNCE_MS = 30, LONG_MS = 600, OFFWORK_HOLD_MS = 1500;  // K1 收工须按住 1.5s（对齐网页按住收工，防误触）

void applyKeyAction(const char* act) {
  if (!strcmp(act, "offwork"))         { setLocalStatus("off");   registerManualOverride("off"); }
  else if (!strcmp(act, "pauseToday")) { schedPausedLocal = !schedPausedLocal; Serial.printf("[KEY] pauseToday=%d\n", schedPausedLocal); }
  else if (!strcmp(act, "focus25"))    { setLocalStatus("focus"); registerManualOverride("focus"); }
  else if (!strcmp(act, "cycleL"))     { cycleLocal(-1); registerManualOverride(curStatusId.c_str()); }
  else if (!strcmp(act, "cycleR"))     { cycleLocal(1);  registerManualOverride(curStatusId.c_str()); }
  else                                 { setLocalStatus(act);     registerManualOverride(act); }
}

void pollKeys() {
  for (auto& k : keys) {
    bool v = digitalRead(k.pin);           // 低=按下
    uint32_t now = millis();
    if (!k.armed) {                        // 上电/复位瞬间可能读到低电平抖动，先等一次释放
      if (v) { k.armed = true; k.last = true; }
      continue;
    }
    if (v != k.last) { k.t0 = now; k.last = v; if (v) k.longSent = false; else k.sawPress = true; }
    bool pressed = !k.last;
    if (k.pin == KEY_SHORTCUT) {
      if (pressed && !k.longSent && now - k.t0 > LONG_MS) {
        sendLine(F("{\"type\":\"shortcut\",\"press\":\"long\"}")); k.longSent = true; k.sawPress = false; breakNoticeUntil = 0; remindUntil = 0;
        if (!bleConnected) { setLocalStatus("focus"); registerManualOverride("focus"); }   // 离线：长按固定 = 专注中
      } else if (!pressed && !k.longSent && k.sawPress && now - k.t0 > DEBOUNCE_MS) {
        sendLine(F("{\"type\":\"shortcut\",\"press\":\"single\"}")); k.longSent = true; k.sawPress = false; breakNoticeUntil = 0; remindUntil = 0;
        if (!bleConnected) applyKeyAction(keyAct[1]);    // 离线：短按按网页下发的 K2 映射执行
      }
    } else if (k.pin == KEY_OFFWORK) {
      // K1：按住 1.5s 才触发收工动作（与网页按住收工一致，防误触）；松早了取消
      if (pressed && !k.longSent && now - k.t0 > OFFWORK_HOLD_MS) {
        k.longSent = true; k.sawPress = false; breakNoticeUntil = 0; remindUntil = 0;
        sendLine(F("{\"type\":\"offworkKey\"}"));
        if (!bleConnected) applyKeyAction(keyAct[0]);
      } else if (!pressed) {
        k.sawPress = false;
      }
    } else if (pressed && now - k.t0 > DEBOUNCE_MS && !k.longSent) {
      k.longSent = true;
      breakNoticeUntil = 0; remindUntil = 0;  // 任意按键提前关闭提醒画面
      if (!strcmp(k.ev1, "touchL")) sendLine(F("{\"type\":\"touch\",\"zone\":\"left\"}"));
      else if (!strcmp(k.ev1, "touchR")) sendLine(F("{\"type\":\"touch\",\"zone\":\"right\"}"));
      // 离线：K3/K4 按网页下发的映射执行（出厂默认 = 上一个/下一个状态循环）
      if (!bleConnected) applyKeyAction(k.pin == KEY_TOUCH_L ? keyAct[2] : keyAct[3]);
    }
  }
}

// 未连接时的本地状态切换：屏幕显示与 LED 跟随，连上后以网页下发为准
void setLocalStatus(const char* id) {
  const StatusDef* st = findStatus(id);
  if (curStatusId != st->id) markStatus(st->id);
  curStatusId = st->id; scrMain = st->zh; scrSub = st->hint;
  oledDirty = true;
}
void cycleLocal(int dir) {
  int idx = 0;
  const int n = sizeof(STATUSES) / sizeof(STATUSES[0]);
  for (int i = 0; i < n; i++) if (!strcmp(STATUSES[i].id, curStatusId.c_str())) idx = i;
  for (int step = 0; step < n; step++) {               // 循环只走日常状态；off 由收工键单独触发，不参与循环
    idx = (idx + dir + n) % n;
    if (strcmp(STATUSES[idx].id, "off")) break;
  }
  setLocalStatus(STATUSES[idx].id);
}

// ===================== 计划表执行（设备自治） =====================

void pollSchedule() {
  if (epochBase < 0) return;                         // 未校时无法执行（wantTime 会持续请求）
  const int64_t e = localEpochMs();
  const int32_t day = dayOf(e);
  const int nowMin = minOf(e);
  if (day != schedDay) {                             // 跨天：今天的暂停/挂起/收工阻断全部重置
    schedDay = day; schedPaused = false; schedPausedLocal = false; schedHold = false; schedLastMin = -1;
  }
  const int count = tableFor(day);                   // 单日计划优先于主表；适用表写入 curTable
  if (count == 0) return;
  if (nowMin == schedLastMin) return;                // 每分钟最多评估一次
  const int prevMin = schedLastMin; schedLastMin = nowMin;
  // mode="next"：跨过节点边界 → 手动干预结束，计划表恢复执行
  if (prevMin >= 0 && schedHold) {
    for (int i = 0; i < count; i++)
      if (curTable[i].min > prevMin && curTable[i].min <= nowMin) { schedHold = false; break; }
  }
  if (schedPaused || schedPausedLocal || schedHold) return;
  const int exp = expectedIdxOf(count, nowMin);
  if (exp < 0) return;                               // 首个节点之前不干预
  const char* expStatus = curTable[exp].status;
  if (offSetDay == day) return;                          // 今天已收工 = 今日计划完成，所有节点作废（手动切换不受影响）
  if (strcmp(expStatus, curStatusId.c_str())) {
    Serial.printf("[SCHED] %02d:%02d -> %s\n", nowMin / 60, nowMin % 60, expStatus);
    setLocalStatus(expStatus);
  }
}

// ===================== 休息提醒 =====================

void pollBreak() {
  const uint32_t now = millis();
  // 跨天自动清零（需要已校时的 epoch；未校时则一直累计）
  if (epochBase >= 0) {
    const int32_t day = (int32_t)((epochBase + now - epochBaseMs + (int64_t)tzOffsetMin * 60000) / 86400000);
    if (breakDay < 0) breakDay = day;
    else if (day != breakDay) {
      breakDay = day; breakOffToday = false; breakAccumMs = 0;
      segCount = 0; markStatus(curStatusId.c_str());   // 新的一天重开区间
    }
  }
  if (breakEnabled && !breakOffToday && isWorkLike(curStatusId.c_str())) {
    breakAccumMs += now - breakLastMs;
  }
  breakLastMs = now;
  if (breakAccumMs >= (uint32_t)breakMinutes * 60000UL) {
    breakAccumMs = 0;                       // 到点即开始下一轮
    breakFlashUntil = now + 3000;
    breakNoticeUntil = now + 15000;
    oledDirty = true;
    sendBreakState(true);
    Serial.println("[BREAK] due");
  } else if (now - breakReportMs > 10000) {
    breakReportMs = now;
    sendBreakState(false);                  // 10s 心跳，网页进度环校准
  }
  // 校时：未校时每 10s 请求 time（连上即恢复时钟）；已校时每 10 分钟重新校时一次消除漂移
  if (now - lastWantTime > (epochBase < 0 ? 10000UL : 600000UL)) {
    lastWantTime = now;
    sendLine(F("{\"type\":\"wantTime\"}"));
  }
  // 区间同步：变化 2s 内推送一次（合并连续切换）；无变化则每 10 分钟兜底同步
  if (epochBase >= 0 && ((segDirty && now - lastSegPush > 2000) || now - lastSegPush > 600000)) {
    sendSegments();
  }
}

// ===================== 电容触摸（可选） =====================

#if ENABLE_CAPSENSE
int baseL = 0, baseR = 0;
void pollTouch() {
  int l = touchRead(TOUCH_L), r = touchRead(TOUCH_R);
  static uint32_t t = 0;
  if (millis() - t < 60) return;
  t = millis();
  if (l < baseL * 0.8f) { sendLine(F("{\"type\":\"touch\",\"zone\":\"left\"}"));  delay(300); }
  if (r < baseR * 0.8f) { sendLine(F("{\"type\":\"touch\",\"zone\":\"right\"}")); delay(300); }
}
#else
void pollTouch() {}
#endif

// ===================== 入口 =====================

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n[BOOT] 收工牌 %s\n", FIRMWARE_VER);

  for (auto& k : keys) { pinMode(k.pin, INPUT_PULLUP); delay(2); k.last = digitalRead(k.pin); }

  oled.begin();
  oled.enableUTF8Print();
  rgb.begin(); rgb.clear(); rgb.show();

#if ENABLE_CAPSENSE
  long sl = 0, sr = 0;
  for (int i = 0; i < 64; i++) { sl += touchRead(TOUCH_L); sr += touchRead(TOUCH_R); delay(2); }
  baseL = sl / 64; baseR = sr / 64;
  Serial.printf("[TOUCH] baseline L=%d R=%d\n", baseL, baseR);
#endif

  setupBle();
  markStatus("work");             // 开机即开始第一段区间记录
  drawOled();
}

void loop() {
  if (wantHello) {
    wantHello = false;
    sendLine(F("{\"type\":\"hello\",\"name\":\"收工牌 A1\",\"firmware\":\"" FIRMWARE_VER "\"}"));
    sendBreakState(false);                 // 连接后立刻同步计时
    segDirty = true;                       // 随后推送今日状态区间
  }
  pollKeys();
  pollTouch();
  pollBreak();
  pollSchedule();
  // 串口通道：与 BLE 共用同一套 JSON 行协议
  static String serBuf;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') { if (serBuf.length()) { handleLine(serBuf); serBuf = ""; } }
    else if (c != '\r') serBuf += c;
  }
  updateLed();
  // OLED：状态变化立即重绘；平时每秒刷一次时钟
  static uint32_t lastDraw = 0;
  if (oledDirty || millis() - lastDraw > 1000) { drawOled(); oledDirty = false; lastDraw = millis(); }
  delay(5);
}
