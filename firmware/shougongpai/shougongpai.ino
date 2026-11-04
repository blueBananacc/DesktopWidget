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
#include <mbedtls/base64.h>
#include <LittleFS.h>
#include <wasm3.h>
#include "driver/i2s.h"

// ===================== 配置 =====================

#define FIRMWARE_VER   "0.7.0"
#define DEVICE_NAME    "Shougong-A1"
#define ENABLE_CAPSENSE 0   // 有铜箔电极接 GPIO13/14 后改为 1

// 引脚分配（与 HARDWARE.md 一致）
constexpr uint8_t PIN_SDA = 5, PIN_SCL = 9;        // OLED I2C（SDA 2026-11-03 由 8 改 5，原 K2 脚）
constexpr uint8_t PIN_RGB = 48;                     // 板载 WS2812
constexpr uint8_t KEY_OFFWORK = 17;                 // K1 收工键（原 4）
constexpr uint8_t KEY_SHORTCUT = 16;                // K2 自定义键（原 5）
constexpr uint8_t KEY_TOUCH_L = 15;                 // K3 暂代触摸区·左（原 6）
constexpr uint8_t KEY_TOUCH_R = 7;                  // K4 暂代触摸区·右
constexpr uint8_t TOUCH_L = 13, TOUCH_R = 14;       // 电容触摸电极（可选）
// 面包板新模块（2026-11-03 定案）
constexpr uint8_t PIN_TTP_SIG = 4;                  // TTP223 触摸模块 SIG：触摸=高电平（与按键低有效相反）
constexpr uint8_t PIN_ENC_A = 1, PIN_ENC_B = 40, PIN_ENC_KEY = 42;  // EC11 旋钮 S1/S2/KEY（S2 由 2 改 40；S2 未接时单相兜底：按住 KEY 转=反向）
constexpr uint8_t PIN_MIC_SCK = 47, PIN_MIC_WS = 21, PIN_MIC_SD = 10;  // INMP441 I2S 麦克风

// BLE UUID —— 与 website/src/device/protocol.ts 保持一致
static const char* SVC_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char* RX_UUID  = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // 网页→设备
static const char* TX_UUID  = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // 设备→网页

// ===================== 状态颜色（与 DESIGN_SPEC 一致） =====================

struct StatusDef { const char* id; uint8_t r, g, b; const char* zh; const char* hint; };
const StatusDef STATUSES[] = {
  { "work",  34, 160, 107, "工作中",   "可以找我" },
  { "busy", 229,  72,  77, "请勿打扰", "非紧急请稍后" },
  { "focus",180,  35,  44, "专注中",   "专注计时中" },
  { "meet", 124,  92, 250, "会议中",   "正在开会" },
  { "rest",  14, 165, 183, "休息一下", "稍后回来" },
  { "off",   59,  66,  82, "已收工",   "明天见" },
};
const StatusDef* findStatus(const char* id) {
  for (auto& s : STATUSES) if (!strcmp(s.id, id)) return &s;
  return &STATUSES[0];
}
// ===== 自定义状态注册表：设备 LittleFS /stdefs.json 是唯一事实源（v0.9 起） =====
// 网页 stdef 消息管理；状态 id ≤7 字符（segs/SchedNode 按 8 字节存储），以 c 开头与内建区分。
struct CustStatus { char id[8]; char zh[21]; char hint[33]; uint8_t r, g, b; bool work; };
CustStatus custs[8];
uint8_t    custCount = 0;
uint32_t   nextCustId = 1;
int custIdx(const char* id) { for (int i = 0; i < custCount; i++) if (!strcmp(custs[i].id, id)) return i; return -1; }
// 统一状态定义查询：内建 → 自定义 → 兜底 work（保证 OLED/RGB 永远有定义可显示）
StatusDef statusDefOf(const char* id) {
  for (auto& s : STATUSES) if (!strcmp(s.id, id)) return s;
  const int ci = custIdx(id);
  if (ci >= 0) return StatusDef{ custs[ci].id, custs[ci].r, custs[ci].g, custs[ci].b, custs[ci].zh, custs[ci].hint };
  return STATUSES[0];
}
// 状态是否有效（内建或已注册自定义）：计划表节点引用已删状态时该表不可用，到点跳过
bool statusKnown(const char* id) {
  for (auto& s : STATUSES) if (!strcmp(s.id, id)) return true;
  return custIdx(id) >= 0;
}
// 工作类状态：休息提醒只在这些状态下累计（与网页 STATUSES.workLike 一致）
bool isWorkLike(const char* id) {
  if (!strcmp(id, "work") || !strcmp(id, "busy") || !strcmp(id, "focus")) return true;
  const int ci = custIdx(id);
  return ci >= 0 && custs[ci].work;
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
uint8_t scrLayout = 0;            // 默认屏布局：0=状态+时间+说明 1=状态+时间 2=仅状态（LittleFS /layout 持久）
bool     micOn;                   // 录音中（stt start/stop 起停，函数定义在下方音频段）
uint32_t micStartMs, micLastMs;

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

// ===== 计划表清单：设备 LittleFS /schedules.json 是唯一事实源（v0.8 起） =====
// 设备存整张清单（多张表+启用项+mode+暂停日），自行推导"今天生效哪张"；网页只是镜像+操作入口。
struct SchedNode { uint16_t min; char status[8]; char note[17]; };
struct Sched {
  char id[12]; char name[25];
  uint8_t kind;                 // 0=repeat 1=date
  uint8_t wd;                   // repeat：bit0=周日…bit6=周六
  char date[11];                // date：YYYY-MM-DD
  uint8_t n; SchedNode ns[20];  // 一天 ≤20 个节点
};
Sched     scheds[8];            // 最多 8 张计划表
int       schedListCount = 0;
uint32_t  nextSchedId = 1;
char      schedAct[12] = "";    // 当前启用的重复计划 id
bool      schedModeToday = false;// mode="today"：手动切状态则今天暂停（对应 overrideMode=pauseToday）
int32_t   schedPausedDay = -1;  // "今日暂停"生效的日期编号；跨天自动失效（网页/本地/按键共用这一位）
bool      schedHold = false;    // mode="next"：手动切状态后挂起，到下个节点恢复（易失，不持久化）
int32_t   schedDay = -1;        // 计划表使用的日期编号（跨天重置挂起）
int       schedLastMin = -1;    // 上次执行检查的分钟，分钟粒度去重
int32_t   offSetDay = -1;       // 进入 off 状态的日期编号；当天的非 off 节点不再自动切（blockedByOffwork）

// 待办提醒（网页 reminder 消息）：OLED 覆盖 15s + RGB 闪烁 3s，任意按键提前关闭
uint32_t remindUntil = 0;
char     remindText[48] = "";
int      remindCount = 0;

// 待办提醒存储（设备事实源）：agent 工具与网页 todo 消息写入，到点复用提醒画面触发
// trig: 0=定时(at epoch ms) 1=收工后触发; show: 触发时正文上屏(否则只显示数量); created/src 供网页展示
struct Todo { char id[12]; int64_t at; uint8_t trig; char text[40]; uint8_t show; int64_t created; char src[6]; bool done; };
Todo     todos[16];
int      todoCount = 0;
uint32_t nextTodoId = 1;
int      lastTodoDay = -1;         // 跨天时清已完成

// 设备端 Agent 循环状态（实现见下方"设备端 Agent 循环"段）
JsonDocument agentMsgs;
bool         agentWaiting = false;
uint8_t      agentRound = 0;
uint32_t     agentDeadline = 0;
char         agentReply[80];
uint32_t     agentReplyUntil = 0;
constexpr uint8_t  AG_MAX_ROUND = 4;
constexpr uint32_t AG_TIMEOUT_MS = 30000;

// 按状态自定义屏幕（WASM app）：app 消息把 .wasm 写入 LittleFS /app_<status>.wasm（断电不丢）。
// 每次状态切换自动加载执行（wasm3 沙箱，宿主 API：clear/show/px/rect/text/millis/buttons/status）；
// 没有该文件则显示默认状态屏。trap → 卸载回默认屏；死循环 → 任务看门狗复位后禁用该 app。
constexpr size_t APP_MAX_SIZE = 48 * 1024;
IM3Environment wasmEnv = nullptr;
IM3Runtime     wasmRt  = nullptr;
IM3Function    wasmRun = nullptr;
bool     appPlaying = false;
uint32_t appNext = 0;
uint16_t appOkFrames = 0;                 // 稳定帧计数：跑满即解除崩溃标记
char     appFor[12] = "";                 // 当前已加载 app 对应的状态
uint8_t* wasmBytes = nullptr;
size_t   wasmLen = 0;
// 上传中（写文件阶段；与运行中 app 互不干扰——上传不中断当前屏幕）
File     appFile;
char     appUpStatus[12] = "";
uint32_t appUpSize = 0, appUpGot = 0;
uint8_t  rxChunk[1408];                   // base64 解码缓冲（>1024B 数据）
// dump：把设备上的 app 读回给网页（网页"以设备为准"渲染 / 取回没有源码的程序）。
// 一条 ~1.1KB JSON 在 115200 波特约阻塞 100ms，摊到每次循环只发一行，避免长时间卡顿。
File     appDumpFile;
char     appDumpStatus[12] = "";
uint32_t appDumpSeq = 0;
uint8_t  dumpBuf[768];
char     dumpB64[1100], dumpLine[1240];
RTC_DATA_ATTR char crashedApp[12] = "";   // 崩溃防护：复位前正在运行的 app 状态名

// 按键映射（/keys.json 持久化；网页 keys 消息修改。cycleL/cycleR 为出厂默认，网页不下发这两个值）
char keyAct[4][12] = { "offwork", "busy", "cycleL", "cycleR" };  // K1 K2 K3 K4
void saveKeys() {
  JsonDocument doc; doc["k1"] = keyAct[0]; doc["k2"] = keyAct[1]; doc["k3"] = keyAct[2]; doc["k4"] = keyAct[3];
  File f = LittleFS.open("/keys.json", "w"); if (f) { serializeJson(doc, f); f.close(); }
}
void loadKeys() {
  File f = LittleFS.open("/keys.json", "r"); if (!f) return;
  JsonDocument doc; if (deserializeJson(doc, f)) { f.close(); return; }
  const char* ks[4] = { "k1", "k2", "k3", "k4" };
  for (int i = 0; i < 4; i++) { const char* a = doc[ks[i]] | ""; if (strlen(a) && strlen(a) < sizeof(keyAct[0])) { strncpy(keyAct[i], a, sizeof(keyAct[0]) - 1); keyAct[i][sizeof(keyAct[0]) - 1] = 0; } }
  f.close();
}
void sendKeys() {  // 全量上行：按键映射以设备为准
  JsonDocument doc; doc["type"] = "keys"; doc["k1"] = keyAct[0]; doc["k2"] = keyAct[1]; doc["k3"] = keyAct[2]; doc["k4"] = keyAct[3];
  String out; serializeJson(doc, out); sendLine(out);
}

// 灯效设置（/led.json 持久化）：每状态一档 solid/breath/off + 全局亮度 + 夜间自动关
struct LedEntry { char id[8]; char mode[7]; };
LedEntry ledMap[14]; int ledMapCount = 0;
bool ledNightOff = false;
const char* ledModeOf(const char* id) {
  for (int i = 0; i < ledMapCount; i++) if (!strcmp(ledMap[i].id, id)) return ledMap[i].mode;
  return "solid";
}
void saveLed() {
  JsonDocument doc; doc["br"] = ledBrightness; doc["night"] = ledNightOff;
  JsonObject m = doc["map"].to<JsonObject>();
  for (int i = 0; i < ledMapCount; i++) m[ledMap[i].id] = ledMap[i].mode;
  File f = LittleFS.open("/led.json", "w"); if (f) { serializeJson(doc, f); f.close(); }
}
void loadLed() {
  File f = LittleFS.open("/led.json", "r"); if (!f) return;
  JsonDocument doc; if (deserializeJson(doc, f)) { f.close(); return; }
  ledBrightness = doc["br"] | ledBrightness; ledNightOff = doc["night"] | false;
  ledMapCount = 0;
  for (JsonPair p : doc["map"].as<JsonObject>()) {
    if (ledMapCount >= 14) break;
    strncpy(ledMap[ledMapCount].id, p.key().c_str(), sizeof(ledMap[0].id) - 1);
    strncpy(ledMap[ledMapCount].mode, p.value() | "solid", sizeof(ledMap[0].mode) - 1);
    if (ledMap[ledMapCount].id[0]) ledMapCount++;
  }
  f.close();
  ledMode = ledModeOf(curStatusId.c_str());
}
void sendLed() {  // 全量上行：灯效设置以设备为准
  JsonDocument doc; doc["type"] = "led"; doc["br"] = ledBrightness; doc["night"] = ledNightOff;
  JsonObject m = doc["map"].to<JsonObject>();
  for (int i = 0; i < ledMapCount; i++) m[ledMap[i].id] = ledMap[i].mode;
  String out; serializeJson(doc, out); sendLine(out);
}
void ledSetMode(const char* id, const char* mode) {  // 写某状态灯效档
  for (int i = 0; i < ledMapCount; i++) if (!strcmp(ledMap[i].id, id)) { strncpy(ledMap[i].mode, mode, sizeof(ledMap[0].mode) - 1); return; }
  if (ledMapCount < 14) { strncpy(ledMap[ledMapCount].id, id, sizeof(ledMap[0].id) - 1); strncpy(ledMap[ledMapCount].mode, mode, sizeof(ledMap[0].mode) - 1); ledMapCount++; }
}

// 今日状态区间记录（设备是时长记录权威；millis 域时间戳，推送时按校时基准换算 epoch）
struct Seg { char status[8]; uint32_t startMs; uint32_t endMs; };  // endMs=0 表示进行中
Seg      segs[96];
int      segCount = 0;
bool     segDirty = false;
uint32_t lastSegPush = 0;
// 断电恢复：开机把 /segs.json 读进 pendSegs（保持 epoch 域，不换算——millis 表达不了开机前的时刻）；
// 首次校时且日期吻合时保留，推送/落盘与 live segs 合并输出
struct PendSeg { char status[8]; int64_t s; int64_t e; };
PendSeg  pendSegs[96];
int      pendCount = 0;
int32_t  pendDay = -1;
int64_t  pendSaved = 0;

// 本地时间换算（校时后可用）
int64_t localEpochMs() { return epochBase + millis() - epochBaseMs + (int64_t)tzOffsetMin * 60000; }
int64_t utcEpochMs()   { return epochBase + millis() - epochBaseMs; }                      // 绝对时刻：待办 at/created 用它存储比较，tz 只管显示和"今天 HH:MM"解析
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
bool schedDateMatches(int si, int32_t day) {           // 签名用 int 索引不用自定义类型：避开 .ino 自动原型提升的顺序坑
  int y, m, d; daysToYMD(day, y, m, d);
  char buf[11]; snprintf(buf, sizeof buf, "%04d-%02d-%02d", y, m, d);
  return !strcmp(scheds[si].date, buf);
}
// 今天生效哪张：单日计划(date==今天)优先，其次启用的重复计划(且今天在其星期位)
int effSched(int32_t day) {
  for (int i = 0; i < schedListCount; i++)
    if (scheds[i].kind == 1 && scheds[i].n && schedDateMatches(i, day)) return i;
  for (int i = 0; i < schedListCount; i++)
    if (scheds[i].kind == 0 && !strcmp(scheds[i].id, schedAct) && ((scheds[i].wd >> weekdayOf(day)) & 1)) return i;
  return -1;
}
// 今天是否暂停（网页/按键共用，跨天自动失效）
bool schedPausedToday() { return schedPausedDay >= 0 && epochBase >= 0 && schedPausedDay == dayOf(localEpochMs()); }
// 应处节点索引：最后一个 min <= nowMin 的节点，没有则 -1
int expectedIdxOf(int si, int nowMin) {
  int idx = -1;
  for (int i = 0; i < scheds[si].n; i++) if (scheds[si].ns[i].min <= nowMin) idx = i;
  return idx;
}
// 手动切状态（按键或网页下发）且与计划应处状态不同 → 按模式挂起/暂停计划表
void registerManualOverride(const char* newStatus) {
  if (epochBase < 0) return;
  const int64_t e = localEpochMs();
  const int32_t day = dayOf(e);
  const int si = effSched(day);
  if (si < 0) return;
  const int exp = expectedIdxOf(si, minOf(e));
  if (exp >= 0 && !strcmp(scheds[si].ns[exp].status, newStatus)) return;
  if (schedModeToday) { schedPausedDay = day; saveSchedules(); } else schedHold = true;
}

// ---- 持久化：/schedules.json ----
void saveSchedules() {
  JsonDocument doc;
  doc["v"] = 1; doc["act"] = schedAct; doc["mode"] = schedModeToday ? 1 : 0; doc["pday"] = schedPausedDay;
  JsonArray list = doc["list"].to<JsonArray>();
  for (int i = 0; i < schedListCount; i++) {
    const Sched& s = scheds[i];
    JsonObject o = list.add<JsonObject>();
    o["id"] = s.id; o["name"] = s.name; o["kind"] = s.kind;
    if (s.kind == 1) o["date"] = s.date; else o["wd"] = s.wd;
    JsonArray ns = o["ns"].to<JsonArray>();
    for (int j = 0; j < s.n; j++) {
      JsonArray nn = ns.add<JsonArray>();
      nn.add(s.ns[j].min); nn.add(s.ns[j].status);
      if (s.ns[j].note[0]) nn.add(s.ns[j].note);
    }
  }
  File f = LittleFS.open("/schedules.json", "w");
  if (f) { serializeJson(doc, f); f.close(); }
}
void loadSchedules() {
  File f = LittleFS.open("/schedules.json", "r");
  if (!f) return;
  JsonDocument doc;
  if (deserializeJson(doc, f)) { f.close(); return; }
  schedListCount = 0;
  strncpy(schedAct, doc["act"] | "", sizeof(schedAct) - 1); schedAct[sizeof(schedAct) - 1] = 0;
  schedModeToday = (doc["mode"] | 0) != 0;
  schedPausedDay = doc["pday"] | -1;
  for (JsonObject o : doc["list"].as<JsonArray>()) {
    if (schedListCount >= 8) break;
    Sched& s = scheds[schedListCount];
    memset(&s, 0, sizeof s);
    strncpy(s.id, o["id"] | "", sizeof(s.id) - 1);
    strncpy(s.name, o["name"] | "", sizeof(s.name) - 1);
    s.kind = o["kind"] | 0;
    s.wd = o["wd"] | 0x7F;
    strncpy(s.date, o["date"] | "", sizeof(s.date) - 1);
    for (JsonArray nn : o["ns"].as<JsonArray>()) {
      if (s.n >= 20) break;
      s.ns[s.n].min = nn[0] | 0;
      strncpy(s.ns[s.n].status, nn[1] | "work", sizeof(s.ns[0].status) - 1);
      if (nn.size() > 2) strncpy(s.ns[s.n].note, nn[2] | "", sizeof(s.ns[0].note) - 1);
      s.n++;
    }
    schedListCount++;
  }
  f.close();
  for (int i = 0; i < schedListCount; i++)              // id 计数器恢复：防重启后撞 id
    if (scheds[i].id[0] == 's') {
      uint32_t n = (uint32_t)strtoul(scheds[i].id + 1, nullptr, 10);
      if (n >= nextSchedId) nextSchedId = n + 1;
    }
  Serial.printf("[SCHED] loaded %d schedules, act=%s\n", schedListCount, schedAct);
}
// 全量清单上行：网页整表替换镜像
void sendSchedules() {
  JsonDocument doc;
  doc["type"] = "schedules"; doc["act"] = schedAct;
  doc["paused"] = schedPausedToday();
  doc["mode"] = schedModeToday ? "today" : "next";
  JsonArray list = doc["list"].to<JsonArray>();
  for (int i = 0; i < schedListCount; i++) {
    const Sched& s = scheds[i];
    JsonObject o = list.add<JsonObject>();
    o["id"] = s.id; o["name"] = s.name; o["kind"] = s.kind ? "date" : "repeat";
    if (s.kind == 1) o["date"] = s.date;
    else { JsonArray w = o["wd"].to<JsonArray>(); for (int b = 0; b < 7; b++) if ((s.wd >> b) & 1) w.add(b); }
    JsonArray ns = o["ns"].to<JsonArray>();
    for (int j = 0; j < s.n; j++) {
      JsonObject nn = ns.add<JsonObject>();
      char t[6]; snprintf(t, sizeof t, "%02d:%02d", s.ns[j].min / 60, s.ns[j].min % 60);
      nn["t"] = t; nn["st"] = s.ns[j].status;
      if (s.ns[j].note[0]) nn["n"] = s.ns[j].note;
    }
  }
  String out; serializeJson(doc, out); sendLine(out);
}
int schedFind(const char* id) { for (int i = 0; i < schedListCount; i++) if (!strcmp(scheds[i].id, id)) return i; return -1; }
void handleSchedMsg(JsonDocument& doc) {
  const char* op = doc["op"] | "";
  if (!strcmp(op, "set")) {                            // 新建/更新整张表（网页编辑保存）
    Sched tmp; memset(&tmp, 0, sizeof tmp);
    const char* id = doc["id"] | "";
    if (!id[0]) { snprintf(tmp.id, sizeof tmp.id, "s%lu", (unsigned long)nextSchedId++); }
    else strncpy(tmp.id, id, sizeof(tmp.id) - 1);
    strncpy(tmp.name, doc["name"] | "未命名", sizeof(tmp.name) - 1);
    tmp.kind = !strcmp(doc["kind"] | "repeat", "date") ? 1 : 0;
    if (tmp.kind == 1) strncpy(tmp.date, doc["date"] | "", sizeof(tmp.date) - 1);
    else for (JsonVariant v : doc["wd"].as<JsonArray>()) tmp.wd |= (uint8_t)(1u << (((int)v) % 7));
    if (tmp.kind == 0 && !tmp.wd) tmp.wd = 0x7F;
    for (JsonObject n : doc["ns"].as<JsonArray>()) {
      if (tmp.n >= 20) break;
      int hh = -1, mm = -1;
      if (sscanf(n["t"] | "", "%d:%d", &hh, &mm) != 2) continue;
      tmp.ns[tmp.n].min = (uint16_t)(hh * 60 + mm);
      strncpy(tmp.ns[tmp.n].status, n["st"] | "work", sizeof(tmp.ns[0].status) - 1);
      strncpy(tmp.ns[tmp.n].note, n["n"] | "", sizeof(tmp.ns[0].note) - 1);
      tmp.n++;
    }
    // 按时间排序
    for (int i = 1; i < tmp.n; i++) {
      SchedNode x = tmp.ns[i]; int j = i - 1;
      while (j >= 0 && tmp.ns[j].min > x.min) { tmp.ns[j + 1] = tmp.ns[j]; j--; }
      tmp.ns[j + 1] = x;
    }
    int i = schedFind(tmp.id);
    if (i >= 0) scheds[i] = tmp;
    else if (schedListCount < 8) scheds[schedListCount++] = tmp;
    else { sendLine(F("{\"type\":\"schedErr\",\"msg\":\"full\"}")); return; }
    schedLastMin = -1;
    saveSchedules(); sendSchedules();
  } else if (!strcmp(op, "del")) {
    int i = schedFind(doc["id"] | "");
    if (i >= 0) {
      if (!strcmp(scheds[i].id, schedAct)) schedAct[0] = 0;   // 删掉启用表：不再启用任何表
      memmove(&scheds[i], &scheds[i + 1], (schedListCount - i - 1) * sizeof(Sched));
      schedListCount--; schedLastMin = -1;
      saveSchedules(); sendSchedules();
    }
  } else if (!strcmp(op, "use")) {
    const char* id = doc["id"] | "";
    int i = schedFind(id);
    if (i >= 0 && scheds[i].kind == 0) {
      bool bad = false;                                        // 含已删状态的表不可启用：需先在网页修正状态
      for (int k = 0; k < scheds[i].n && !bad; k++) bad = !statusKnown(scheds[i].ns[k].status);
      if (bad) { sendLine(F("{\"type\":\"schedErr\",\"msg\":\"badStatus\"}")); }
      else { strncpy(schedAct, id, sizeof(schedAct) - 1); schedAct[sizeof(schedAct) - 1] = 0; schedLastMin = -1; saveSchedules(); sendSchedules(); }
    }
  } else if (!strcmp(op, "pause")) {
    schedPausedDay = (doc["paused"] | false) && epochBase >= 0 ? dayOf(localEpochMs()) : -1;
    saveSchedules(); sendSchedules();
  } else if (!strcmp(op, "mode")) {
    schedModeToday = !strcmp(doc["mode"] | "next", "today");
    saveSchedules(); sendSchedules();
  } else if (!strcmp(op, "list")) sendSchedules();
}

// ===================== 自定义状态注册表：/stdefs.json =====================

void saveStdefs() {
  JsonDocument doc;
  JsonArray list = doc["list"].to<JsonArray>();
  for (int i = 0; i < custCount; i++) {
    JsonObject o = list.add<JsonObject>();
    o["id"] = custs[i].id; o["zh"] = custs[i].zh;
    if (custs[i].hint[0]) o["hint"] = custs[i].hint;
    o["c"] = ((uint32_t)custs[i].r << 16) | ((uint32_t)custs[i].g << 8) | custs[i].b;
    if (custs[i].work) o["work"] = true;
  }
  File f = LittleFS.open("/stdefs.json", "w");
  if (f) { serializeJson(doc, f); f.close(); }
}
void loadStdefs() {
  File f = LittleFS.open("/stdefs.json", "r");
  if (!f) return;
  JsonDocument doc;
  if (deserializeJson(doc, f)) { f.close(); return; }
  custCount = 0;
  for (JsonObject o : doc["list"].as<JsonArray>()) {
    if (custCount >= 8) break;
    CustStatus& c = custs[custCount];
    memset(&c, 0, sizeof c);
    strncpy(c.id, o["id"] | "", sizeof(c.id) - 1);
    strncpy(c.zh, o["zh"] | "自定义", sizeof(c.zh) - 1);
    strncpy(c.hint, o["hint"] | "", sizeof(c.hint) - 1);
    const uint32_t rgbv = o["c"] | 0x8899AA;
    c.r = (rgbv >> 16) & 0xFF; c.g = (rgbv >> 8) & 0xFF; c.b = rgbv & 0xFF;
    c.work = o["work"] | false;
    if (c.id[0]) custCount++;
  }
  f.close();
  for (int i = 0; i < custCount; i++)                    // id 计数器恢复：防重启后撞 id
    if (custs[i].id[0] == 'c') {
      const uint32_t n = (uint32_t)strtoul(custs[i].id + 1, nullptr, 10);
      if (n >= nextCustId) nextCustId = n + 1;
    }
  Serial.printf("[STDEF] loaded %d custom statuses\n", custCount);
}
// 全量上行：网页整表替换镜像
void sendStdefs() {
  JsonDocument doc;
  doc["type"] = "stdefs";
  JsonArray list = doc["list"].to<JsonArray>();
  for (int i = 0; i < custCount; i++) {
    JsonObject o = list.add<JsonObject>();
    o["id"] = custs[i].id; o["zh"] = custs[i].zh;
    if (custs[i].hint[0]) o["hint"] = custs[i].hint;
    o["c"] = ((uint32_t)custs[i].r << 16) | ((uint32_t)custs[i].g << 8) | custs[i].b;
    if (custs[i].work) o["work"] = true;
  }
  String out; serializeJson(doc, out); sendLine(out);
}
void handleStdefMsg(JsonDocument& doc) {
  const char* op = doc["op"] | "";
  if (!strcmp(op, "set")) {                            // 新建/更新：网页传完整定义
    CustStatus tmp; memset(&tmp, 0, sizeof tmp);
    const char* id = doc["id"] | "";
    if (!id[0]) snprintf(tmp.id, sizeof tmp.id, "c%lu", (unsigned long)nextCustId++);
    else { strncpy(tmp.id, id, sizeof(tmp.id) - 1); }
    strncpy(tmp.zh, doc["zh"] | "自定义", sizeof(tmp.zh) - 1);
    strncpy(tmp.hint, doc["hint"] | "", sizeof(tmp.hint) - 1);
    const uint32_t rgbv = doc["c"] | 0x8899AA;
    tmp.r = (rgbv >> 16) & 0xFF; tmp.g = (rgbv >> 8) & 0xFF; tmp.b = rgbv & 0xFF;
    tmp.work = doc["work"] | false;
    int i = custIdx(tmp.id);
    if (i >= 0) custs[i] = tmp;
    else if (custCount < 8) custs[custCount++] = tmp;
    else { sendLine(F("{\"type\":\"stdefErr\",\"msg\":\"full\"}")); return; }
    if (!strcmp(curStatusId.c_str(), tmp.id)) { scrMain = tmp.zh; scrSub = tmp.hint; oledDirty = true; } // 改的是当前状态：立即刷新屏幕
    saveStdefs(); sendStdefs();
  } else if (!strcmp(op, "del")) {
    const char* id = doc["id"] | "";
    const int i = custIdx(id);
    if (i >= 0) {
      memmove(&custs[i], &custs[i + 1], (custCount - i - 1) * sizeof(CustStatus));
      custCount--;
      removeIfExists("/app_" + String(id) + ".wasm");      // 连带删掉它的自定义屏幕与禁用标记
      removeIfExists("/app_" + String(id) + ".wasm.bad");
      if (!strcmp(curStatusId.c_str(), id)) { setLocalStatus("work"); registerManualOverride("work"); } // 正在使用 → 退回工作中
      saveStdefs(); sendStdefs(); sendApps();
    }
  } else if (!strcmp(op, "list")) sendStdefs();
}

void markStatus(const char* id) {
  const uint32_t now = millis();
  if (!strcmp(id, "off") && epochBase >= 0) { offSetDay = dayOf(localEpochMs()); fireOffworkTodos(); } // 记录收工日挡后续节点 + 触发"收工后提醒"待办
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

// 今日区间落盘 /segs.json：随 sendSegments 调用（状态切换 2s 防抖 + 10 分钟兜底，断电误差 ≤10min）
void saveSegs() {
  if (epochBase < 0) return;
  JsonDocument doc;
  doc["day"] = dayOf(localEpochMs());
  doc["saved"] = utcEpochMs();                       // 本次落盘时刻 ≈ 断电前的"最后已知存活"边界
  JsonArray a = doc["segs"].to<JsonArray>();
  for (int i = 0; i < pendCount; i++) {              // 断电恢复的段本来就是 epoch，原样合并
    JsonObject o = a.add<JsonObject>();
    o["st"] = pendSegs[i].status;
    o["s"] = pendSegs[i].s;
    if (pendSegs[i].e > 0) o["e"] = pendSegs[i].e;
  }
  for (int i = 0; i < segCount; i++) {
    JsonObject o = a.add<JsonObject>();
    o["st"] = segs[i].status;
    o["s"] = epochBase + (int64_t)segs[i].startMs - epochBaseMs;
    if (segs[i].endMs) o["e"] = epochBase + (int64_t)segs[i].endMs - epochBaseMs;
  }
  File f = LittleFS.open("/segs.json", "w"); if (f) { serializeJson(doc, f); f.close(); }
}

void loadSegs() {
  File f = LittleFS.open("/segs.json", "r"); if (!f) return;
  JsonDocument doc;
  if (deserializeJson(doc, f)) { f.close(); return; }
  f.close();
  pendDay = doc["day"] | -1;
  pendSaved = doc["saved"] | (int64_t)0;
  for (JsonObject o : doc["segs"].as<JsonArray>()) {
    if (pendCount >= 96) break;
    int64_t s = o["s"] | (int64_t)0;
    int64_t e = o["e"] | (int64_t)0;
    if (s <= 0) continue;
    if (pendSaved > 0 && s > pendSaved) continue;    // 段不可能晚于最后落盘时刻：脏数据丢弃
    if (pendSaved > 0 && e > pendSaved) e = pendSaved; // 结束晚于落盘：钳到断电边界
    strncpy(pendSegs[pendCount].status, o["st"] | "work", sizeof(pendSegs[0].status) - 1);
    pendSegs[pendCount].status[sizeof(pendSegs[0].status) - 1] = 0;
    pendSegs[pendCount].s = s;
    pendSegs[pendCount].e = e;
    pendCount++;
  }
  // 断电时未闭合的段按 saved（最后一次落盘）收尾 ≈ 断电时刻；到本次开机即"未记录"间隔
  if (pendCount > 0 && pendSegs[pendCount - 1].e <= 0)
    pendSegs[pendCount - 1].e = pendSaved > pendSegs[pendCount - 1].s ? pendSaved : pendSegs[pendCount - 1].s;
}

// 首次校时后调用：日期吻合保留 pendSegs（仍是 epoch 域，推送时直接输出），否则丢弃昨日残留
void adoptPendSegs() {
  if (epochBase < 0) return;
  if (pendCount > 0 && pendDay == dayOf(localEpochMs())) {
    for (int i = 0; i < pendCount; i++)
      if (!strcmp(pendSegs[i].status, "off")) { offSetDay = dayOf(localEpochMs()); break; }  // 断电前收过工：今天挡后续计划节点
    segDirty = true;
    Serial.printf("[SEG] restored %d persisted segments\n", pendCount);
  } else {
    pendCount = 0;
  }
  pendDay = -1;
}

// 推送今日全部区间：segBegin → N×seg → segEnd。仅在校时后推送（millis → epoch 换算）
void sendSegments() {
  if (epochBase < 0 || segCount == 0) return;
  saveSegs();                                        // 每次推送顺带落盘：切换即存 + 10min 误差界
  sendLine(F("{\"type\":\"segments\",\"phase\":\"begin\"}"));
  for (int i = 0; i < pendCount; i++) {              // 断电恢复的段：epoch 域原样直发
    char buf[128];
    if (pendSegs[i].e > 0)
      snprintf(buf, sizeof buf, "{\"type\":\"seg\",\"status\":\"%s\",\"start\":%lld,\"end\":%lld}",
        pendSegs[i].status, pendSegs[i].s, pendSegs[i].e);
    else
      snprintf(buf, sizeof buf, "{\"type\":\"seg\",\"status\":\"%s\",\"start\":%lld}",
        pendSegs[i].status, pendSegs[i].s);
    sendLine(buf);
  }
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
    // 单条 notify 上限 = MTU-3；agentReq/appData 等长消息按 200B 分片，网页按 \n 重组
    for (size_t i = 0; i < out.length(); i += 200) {
      txChar->setValue((const uint8_t*)out.c_str() + i, min((size_t)200, out.length() - i));
      txChar->notify();
      delay(2);                              // 给 BLE 栈喘息，防连续 notify 丢包
    }
  }
  Serial.printf("[TX] %.60s%s\n", json.c_str(), json.length() > 60 ? "..." : "");   // aud 帧截断，防日志刷屏
}

void removeIfExists(const String& path) { if (LittleFS.exists(path)) LittleFS.remove(path); }

// 上报设备上实际安装的自定义屏幕：网页据此显示"已安装/未上传/已禁用"，不靠本地猜测
void sendApps() {
  String out = F("{\"type\":\"apps\",\"list\":[");
  bool first = true;
  File root = LittleFS.open("/");
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    String n = f.name();
    if (n.startsWith("/")) n.remove(0, 1);
    const bool bad = n.endsWith(".wasm.bad");
    if (n.startsWith("app_") && (bad || n.endsWith(".wasm"))) {
      out += first ? "" : ","; first = false;
      out += "{\"status\":\"" + n.substring(4, n.indexOf('.')) + "\",\"size\":" + String((unsigned)f.size()) + (bad ? ",\"bad\":true}" : "}");
    }
    f.close();
  }
  out += "]}";
  sendLine(out);
}

// app 运行失败（trap / 加载失败）上报给网页提示用户修代码
void sendAppErr(const char* st, const char* msg) {
  char m[101], buf[180];
  strncpy(m, msg, 100); m[100] = 0;
  for (char* p = m; *p; p++) if (*p == '"' || *p == '\\') *p = '\'';   // 防御：引号/反斜杠会破坏 JSON
  snprintf(buf, sizeof buf, "{\"type\":\"appErr\",\"status\":\"%s\",\"msg\":\"%s\"}", st, m);
  sendLine(buf);
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
  const bool rec = micOn && !remind && !notice;                    // 录音画面排第三
  const bool ag = agentWaiting && !remind && !notice && !rec;      // agent 等 LLM 回复排第四
  const bool agd = !remind && !notice && !rec && !ag && millis() < agentReplyUntil;  // 回复结果 8s
  const char* main = remind ? "有新待办" : notice ? "起来活动一下" : rec ? "录音中" : ag ? "AI 思考中" : agd ? agentReply : scrMain.c_str();
  char subBuf[48];
  const char* sub = remind
    ? (remindText[0] ? remindText : (snprintf(subBuf, sizeof subBuf, "有 %d 条待办", remindCount), subBuf))
    : notice ? "下一轮计时已开始"
    : rec ? (snprintf(subBuf, sizeof subBuf, "%02lu:%02lu", (unsigned long)(micLastMs / 60000), (unsigned long)(micLastMs / 1000 % 60)), subBuf)
    : ag ? "…"
    : agd ? "AI 回复"
    : scrSub.c_str();
  // 布局只作用于常规状态屏；提醒/休息/录音/agent 画面始终完整显示
  const uint8_t lay = (remind || notice || rec || ag || agd) ? 0 : scrLayout;
  oled.clearBuffer();
  if (lay < 2) {
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
  }
  // 状态大字（中文 16px，最多 4 字=64px 宽，居中）；无说明行时下移到视觉中心
  oled.setFont(u8g2_font_wqy16_t_gb2312);
  oled.drawUTF8((128 - oled.getUTF8Width(main)) / 2, lay == 0 ? 36 : 40, main);
  // 副标题 12px 居中
  if (lay == 0) {
    oled.setFont(u8g2_font_wqy12_t_gb2312);
    oled.drawUTF8((128 - oled.getUTF8Width(sub)) / 2, 56, sub);
  }
  oled.sendBuffer();
}

// ===================== RGB 灯 =====================

void updateLed() {
  const StatusDef st = statusDefOf(curStatusId.c_str());
  uint8_t r = st.r, g = st.g, bl = st.b;
  uint8_t b = (uint16_t)ledBrightness * 255 / 100;
  if (ledNightOff && epochBase >= 0) {           // 夜间自动关灯：本地 22:00–07:00 强制灭
    const int h = minOf(localEpochMs()) / 60;
    if (h >= 22 || h < 7) b = 0;
  }
  if (!strcmp(ledMode.c_str(), "breath")) {
    float t = millis() / 1800.0f;
    float wave = 0.5f - 0.5f * cosf(2 * PI * fmodf(t, 1.0f));
    b = (uint8_t)(b * (0.15f + 0.85f * wave));
  }
  if (!strcmp(ledMode.c_str(), "off")) b = 0;
  if (micOn) {                                   // 录音中：红灯慢呼吸；休息提醒闪烁仍优先
    r = 235; g = 46; bl = 60;
    float wave = 0.5f - 0.5f * cosf(2 * PI * fmodf(millis() / 1200.0f, 1.0f));
    b = (uint8_t)(40 + 180 * wave);
  } else if (agentWaiting) {                     // agent 等 LLM：紫灯慢呼吸
    r = 124; g = 92; bl = 250;
    float wave = 0.5f - 0.5f * cosf(2 * PI * fmodf(millis() / 1600.0f, 1.0f));
    b = (uint8_t)(30 + 160 * wave);
  }
  // 休息提醒到点：状态色 4Hz 闪烁 3 秒，覆盖常规灯效
  if (millis() < breakFlashUntil) b = ((millis() / 125) % 2) ? 220 : 0;
  rgb.setBrightness(255);  // 直接手动缩放，避免 setBrightness 的衰减累积
  rgb.setPixelColor(0,
    (uint8_t)(r * b / 255), (uint8_t)(g * b / 255), (uint8_t)(bl * b / 255));
  rgb.show();
}

// ===================== 消息处理 =====================

void handleLine(const String& line) {
  // 回显截断：完整打印 1.4KB 的 anim 帧会阻塞 Serial 数百毫秒，导致串口 RX 溢出丢字节
  Serial.printf("[BLE←] %.100s%s\n", line.c_str(), line.length() > 100 ? "..." : "");
  JsonDocument doc;
  if (deserializeJson(doc, line)) return;
  const char* type = doc["type"] | "";
  if (!strcmp(type, "state")) {
    const char* st = doc["status"] | "work";
    String nId = st;
    String nm = doc["screen"] | statusDefOf(st).zh;
    String ns = doc["sub"] | "";
    // led/brightness 可选：灯效设置的事实源在设备 /led.json；带则当次覆盖显示，不带按本地配置
    String lm = doc["led"].isNull() ? ledModeOf(nId.c_str()) : String(doc["led"] | "solid");
    uint8_t br = doc["brightness"].isNull() ? ledBrightness : doc["brightness"];
    const char* ly = doc["layout"] | "";
    const int8_t nl = !strcmp(ly, "full") ? 0 : !strcmp(ly, "clock") ? 1 : !strcmp(ly, "status") ? 2 : -1;
    if (nl >= 0 && nl != scrLayout) {
      scrLayout = nl; oledDirty = true;
      File lf = LittleFS.open("/layout", "w"); if (lf) { lf.write(scrLayout); lf.close(); }
    }
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
    adoptPendSegs();                       // 校时完成：回填断电前持久化的今日区间
    segDirty = true;                       // 校时完成后可换算真实时间，安排推送
    oledDirty = true;
  } else if (!strcmp(type, "break")) {
    // 网页/app 下发休息提醒设置；accumMs 只在明确要求重置时才带，设备保持计时权威
    if (!doc["minutes"].isNull())   breakMinutes  = doc["minutes"];
    if (!doc["enabled"].isNull())   breakEnabled  = doc["enabled"];
    if (!doc["offToday"].isNull())  breakOffToday = doc["offToday"];
    if (!doc["accumMs"].isNull())   breakAccumMs  = doc["accumMs"];
    sendBreakState(false);                  // 回执：让网页立即对齐
  } else if (!strcmp(type, "sched")) {
    handleSchedMsg(doc);                    // v0.8：计划表清单 ops（set/del/use/pause/mode/list）；设备是事实源
  } else if (!strcmp(type, "stdef")) {
    handleStdefMsg(doc);                    // v0.9：自定义状态注册表 ops（set/del/list）
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
    // 按键映射下发：写入 /keys.json 断电保留（K1 仍须按住 1.5s）
    const char* ks[4] = { "k1", "k2", "k3", "k4" };
    for (int i = 0; i < 4; i++) {
      const char* a = doc[ks[i]] | "";
      if (strlen(a) && strlen(a) < sizeof(keyAct[0])) { strncpy(keyAct[i], a, sizeof(keyAct[0]) - 1); keyAct[i][sizeof(keyAct[0]) - 1] = 0; }
    }
    saveKeys(); sendKeys();
    Serial.printf("[KEYS] %s %s %s %s\n", keyAct[0], keyAct[1], keyAct[2], keyAct[3]);
  } else if (!strcmp(type, "led")) {
    // 灯效设置（事实源在设备）：map=每状态档位 / br=亮度 / night=夜间自动关
    if (doc["map"].is<JsonObject>()) {
      for (JsonPair p : doc["map"].as<JsonObject>()) {
        const char* m = p.value() | "";
        if (p.key().c_str()[0] && strlen(m) && strlen(m) < 7) ledSetMode(p.key().c_str(), m);
      }
    }
    if (!doc["br"].isNull())    ledBrightness = doc["br"];
    if (!doc["night"].isNull()) ledNightOff = doc["night"];
    ledMode = ledModeOf(curStatusId.c_str());
    saveLed(); sendLed();
  } else if (!strcmp(type, "app")) {
    // 按状态自定义屏幕（WASM）：begin{status,size} 开文件 → chunk{base64}×N → run 收尾
    // （收齐且目标是当前状态则立即重载执行）/ stop 停掉当前 app / clear{status} 删除恢复默认
    const char* op = doc["op"] | "";
    if (!strcmp(op, "begin")) {
      const char* st = doc["status"] | "";
      strncpy(appUpStatus, st, sizeof(appUpStatus) - 1); appUpStatus[sizeof(appUpStatus) - 1] = 0;
      appUpSize = doc["size"] | 0; appUpGot = 0;
      if (appFile) appFile.close();
      removeIfExists("/app_" + String(appUpStatus) + ".wasm.bad");   // 重新上传 = 用户已修复，解除崩溃禁用
      appFile = (appUpSize > 0 && appUpSize <= APP_MAX_SIZE)
                ? LittleFS.open("/app_" + String(appUpStatus) + ".wasm", "w") : File();
      Serial.printf("[APP] begin %s size=%u\n", appUpStatus, appUpSize);
    } else if (!strcmp(op, "chunk")) {
      const char* d = doc["data"] | "";
      size_t olen = 0;
      if (appFile && mbedtls_base64_decode(rxChunk, sizeof rxChunk, &olen, (const uint8_t*)d, strlen(d)) == 0 && olen) {
        appFile.write(rxChunk, olen); appUpGot += olen;
      }
    } else if (!strcmp(op, "run")) {
      if (appFile) appFile.close();
      if (appUpSize && appUpGot == appUpSize) {
        if (!strcmp(appUpStatus, curStatusId.c_str())) appFor[0] = 0; // 上传的是当前状态 → 强制重载立即执行
        Serial.printf("[APP] saved %s (%u)\n", appUpStatus, appUpGot);
      } else {
        Serial.printf("[APP] incomplete %u/%u\n", appUpGot, appUpSize);
        removeIfExists("/app_" + String(appUpStatus) + ".wasm");      // 半截文件不留：避免加载失败或误报"已安装"
      }
      sendApps();
    } else if (!strcmp(op, "stop")) {
      if (appPlaying) appUnload();
      oledDirty = true;
      Serial.println("[APP] stop");
    } else if (!strcmp(op, "clear")) {
      const char* st = doc["status"] | "";
      if (appFile && !strcmp(st, appUpStatus)) { appFile.close(); appUpGot = 0; appUpSize = 0; } // 上传中清除：先关句柄否则 remove 失败
      removeIfExists("/app_" + String(st) + ".wasm");
      removeIfExists("/app_" + String(st) + ".wasm.bad");
      if (!strcmp(st, appFor)) { appUnload(); appFor[0] = 0; oledDirty = true; }
      Serial.printf("[APP] clear %s\n", st);
      sendApps();
    } else if (!strcmp(op, "list")) {
      sendApps();
    } else if (!strcmp(op, "dump")) {
      const char* st = doc["status"] | "";
      if (appDumpFile) appDumpFile.close();
      appDumpFile = LittleFS.open("/app_" + String(st) + ".wasm", "r");
      strncpy(appDumpStatus, st, sizeof(appDumpStatus) - 1); appDumpStatus[sizeof(appDumpStatus) - 1] = 0;
      appDumpSeq = 0;
      if (!appDumpFile) {
        snprintf(dumpLine, sizeof dumpLine, "{\"type\":\"appData\",\"status\":\"%s\",\"last\":true,\"missing\":true}", st);
        sendLine(dumpLine);
      }
      Serial.printf("[APP] dump %s\n", st);
    }
  } else if (!strcmp(type, "stt")) {
    // 语音转文字：网页起停；设备 I2S 采音 → IMA-ADPCM → aud 帧上行
    const char* op = doc["op"] | "";
    if (!strcmp(op, "start")) micStart();
    else if (!strcmp(op, "stop")) micStop();
  } else if (!strcmp(type, "sttResult")) {
    // 网页 ASR 完成回传的文字 → 喂给设备 agent 循环
    const char* t = doc["text"] | "";
    if (strlen(t)) agentStart(t);
  } else if (!strcmp(type, "agentRes")) {
    handleAgentRes(doc);
  } else if (!strcmp(type, "agent")) {
    if (!strcmp(doc["op"] | "", "cancel")) agentAbort("cancelled");
  } else if (!strcmp(type, "todo")) {
    handleTodoMsg(doc);
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
    if (micOn) micStop();                        // 录音发起方掉线 → 停录收尾
    agentAbort("disconnected");                  // LLM 只能经网页调，断连即中止 agent
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
  else if (!strcmp(act, "pauseToday")) { schedPausedDay = schedPausedToday() ? -1 : (epochBase >= 0 ? dayOf(localEpochMs()) : -1); saveSchedules(); sendSchedules(); Serial.printf("[KEY] pauseToday=%d\n", schedPausedToday()); }
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

// ===================== WASM 自定义屏幕 =====================
// 宿主 API（wasm 模块 import "env.*"）。帧模型：app 的 run() 每帧被调一次，
// 先 clear() 再逐笔画 px/rect/text，最后 show() 上屏；帧率由固件节流（~30fps）。
// px/rect/text 直接写 u8g2 页序帧缓冲；text 从 wasm 线性内存读 ASCII。

static uint8_t appColor = 1; // 绘制模式：0=灭(擦除) 1=亮 2=反色XOR；color() 设置后对所有绘制函数生效

m3ApiRawFunction(m3_px) {
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  if (x >= 0 && x < 128 && y >= 0 && y < 64) {
    uint8_t* p = &oled.getBufferPtr()[(y >> 3) * 128 + x];
    const uint8_t m = (uint8_t)(1 << (y & 7));
    if (appColor == 0) *p &= ~m; else if (appColor == 2) *p ^= m; else *p |= m;
  }
  m3ApiSuccess();
}
m3ApiRawFunction(m3_color) { // (mode) — 0灭 1亮 2反色XOR
  m3ApiGetArg(int32_t, m);
  if (m >= 0 && m <= 2) appColor = (uint8_t)m;
  m3ApiSuccess();
}
m3ApiRawFunction(m3_rect) { // (x, y, w, h, fill)
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y); m3ApiGetArg(int32_t, w);
  m3ApiGetArg(int32_t, h); m3ApiGetArg(int32_t, fill);
  oled.setDrawColor(appColor);
  if (fill) oled.drawBox(x, y, w, h); else oled.drawFrame(x, y, w, h);
  m3ApiSuccess();
}
m3ApiRawFunction(m3_line) { // (x1, y1, x2, y2)
  m3ApiGetArg(int32_t, x1); m3ApiGetArg(int32_t, y1);
  m3ApiGetArg(int32_t, x2); m3ApiGetArg(int32_t, y2);
  oled.setDrawColor(appColor);
  oled.drawLine(x1, y1, x2, y2);
  m3ApiSuccess();
}
m3ApiRawFunction(m3_circle) { // (cx, cy, r, fill)
  m3ApiGetArg(int32_t, cx); m3ApiGetArg(int32_t, cy);
  m3ApiGetArg(int32_t, r);  m3ApiGetArg(int32_t, fill);
  oled.setDrawColor(appColor);
  if (fill) oled.drawDisc(cx, cy, r); else oled.drawCircle(cx, cy, r);
  m3ApiSuccess();
}
m3ApiRawFunction(m3_ellipse) { // (cx, cy, rx, ry, fill)
  m3ApiGetArg(int32_t, cx); m3ApiGetArg(int32_t, cy);
  m3ApiGetArg(int32_t, rx); m3ApiGetArg(int32_t, ry); m3ApiGetArg(int32_t, fill);
  oled.setDrawColor(appColor);
  if (fill) oled.drawFilledEllipse(cx, cy, rx, ry); else oled.drawEllipse(cx, cy, rx, ry);
  m3ApiSuccess();
}
m3ApiRawFunction(m3_rrect) { // (x, y, w, h, r, fill) — 圆角矩形
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y); m3ApiGetArg(int32_t, w);
  m3ApiGetArg(int32_t, h); m3ApiGetArg(int32_t, r); m3ApiGetArg(int32_t, fill);
  oled.setDrawColor(appColor);
  if (fill) oled.drawRBox(x, y, w, h, r); else oled.drawRFrame(x, y, w, h, r);
  m3ApiSuccess();
}
m3ApiRawFunction(m3_bitmap) { // (x, y, w, h, ptr) — 1bpp 位图，行主序、每行 (w+7)/8 字节、LSB 先（XBM）
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  m3ApiGetArg(int32_t, w); m3ApiGetArg(int32_t, h);
  m3ApiGetArgMem(uint8_t*, bits);
  if (w > 0 && h > 0 && w <= 128 && h <= 64) {
    m3ApiCheckMem(bits, ((size_t)w * h + 7) / 8);
    oled.setDrawColor(appColor);
    oled.drawXBMP(x, y, w, h, bits);
  }
  m3ApiSuccess();
}
m3ApiRawFunction(m3_text) { // (x, y, ptr, len) — 从 wasm 线性内存读 ASCII
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  m3ApiGetArgMem(char*, s); m3ApiGetArg(uint32_t, len);
  if (len > 0 && len <= 64) {
    m3ApiCheckMem(s, len);                               // 越界 → wasm trap，不会读野内存
    char buf[65]; memcpy(buf, s, len); buf[len] = 0;
    oled.setDrawColor(appColor);
    oled.setFont(u8g2_font_6x10_tf); oled.drawStr(x, y, buf);
    oled.setFont(u8g2_font_unifont_t_chinese1);            // 恢复默认字体避免串色到状态屏
  }
  m3ApiSuccess();
}
static const uint8_t* appFont(int f) { // 0=6x10 ASCII  1=wqy12 中文小字  2=wqy16 中文大字（与默认屏同款）
  return f == 2 ? u8g2_font_wqy16_t_gb2312 : f == 1 ? u8g2_font_wqy12_t_gb2312 : u8g2_font_6x10_tf;
}
m3ApiRawFunction(m3_textC) {  // (x, y, ptr, len) — UTF-8 中文小字（wqy12，同默认屏说明行字体）
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  m3ApiGetArgMem(char*, s); m3ApiGetArg(uint32_t, len);
  if (len > 0 && len <= 64) {
    m3ApiCheckMem(s, len);
    char buf[65]; memcpy(buf, s, len); buf[len] = 0;
    oled.setDrawColor(appColor);
    oled.setFont(u8g2_font_wqy12_t_gb2312); oled.drawUTF8(x, y, buf);
    oled.setFont(u8g2_font_unifont_t_chinese1);
  }
  m3ApiSuccess();
}
m3ApiRawFunction(m3_bigText) { // (x, y, ptr, len) — UTF-8 中文大字（wqy16，同默认屏状态名字体）
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  m3ApiGetArgMem(char*, s); m3ApiGetArg(uint32_t, len);
  if (len > 0 && len <= 64) {
    m3ApiCheckMem(s, len);
    char buf[65]; memcpy(buf, s, len); buf[len] = 0;
    oled.setDrawColor(appColor);
    oled.setFont(u8g2_font_wqy16_t_gb2312); oled.drawUTF8(x, y, buf);
    oled.setFont(u8g2_font_unifont_t_chinese1);
  }
  m3ApiSuccess();
}
m3ApiRawFunction(m3_textW) { // (ptr, len, font) -> i32 像素宽：给居中/右对齐用（程序自己测不了字宽）
  m3ApiGetArgMem(char*, s); m3ApiGetArg(uint32_t, len); m3ApiGetArg(int32_t, f);
  m3ApiReturnType(int32_t);
  if (len <= 0 || len > 64) { m3ApiReturn(0); }
  m3ApiCheckMem(s, len);
  char buf[65]; memcpy(buf, s, len); buf[len] = 0;
  oled.setFont(appFont(f));
  m3ApiReturn((int32_t)oled.getUTF8Width(buf));
}
m3ApiRawFunction(m3_textA) { // (x, y, ptr, len, font, align) — 锚点文本：align 0..8 九宫格
  // align: 0左上 1上中 2右上 3左中 4正中 5右中 6左下 7下中 8右下；(x,y) 即该锚点位置
  m3ApiGetArg(int32_t, x); m3ApiGetArg(int32_t, y);
  m3ApiGetArgMem(char*, s); m3ApiGetArg(uint32_t, len);
  m3ApiGetArg(int32_t, f); m3ApiGetArg(int32_t, align);
  if (len > 0 && len <= 64 && align >= 0 && align <= 8) {
    m3ApiCheckMem(s, len);
    char buf[65]; memcpy(buf, s, len); buf[len] = 0;
    oled.setFont(appFont(f));
    const int w = oled.getUTF8Width(buf);
    const int asc = oled.getAscent(), desc = oled.getDescent(); // desc 为负值
    const int h = align % 3, v = align / 3;
    const int dx = h == 0 ? x : h == 1 ? x - w / 2 : x - w;
    const int dy = v == 0 ? y + asc : v == 1 ? y + (asc + desc) / 2 : y + desc;
    oled.setDrawColor(appColor);
    oled.drawUTF8(dx, dy, buf);
    oled.setFont(u8g2_font_unifont_t_chinese1);
  }
  m3ApiSuccess();
}
m3ApiRawFunction(m3_clear)   { oled.clearBuffer(); m3ApiSuccess(); }
m3ApiRawFunction(m3_show)    { oled.sendBuffer();  m3ApiSuccess(); }
m3ApiRawFunction(m3_millis)  { m3ApiReturnType(uint32_t); m3ApiReturn((uint32_t)millis()); }
m3ApiRawFunction(m3_buttons) { // 按键位掩码：bit0..3 = K1..K4（低电平=按下），app 可做交互
  m3ApiReturnType(uint32_t);
  uint32_t m = 0;
  for (int i = 0; i < 4; i++) if (keys[i].last == LOW) m |= (1u << i);
  m3ApiReturn(m);
}
m3ApiRawFunction(m3_status) { // 当前状态下标：内建 0-5，自定义 6+i；未知兜底 0
  m3ApiReturnType(uint32_t);
  const int n = sizeof(STATUSES) / sizeof(STATUSES[0]);
  int idx = 0;
  for (int i = 0; i < n; i++) if (!strcmp(STATUSES[i].id, curStatusId.c_str())) { m3ApiReturn((uint32_t)i); }
  for (int i = 0; i < custCount; i++) if (!strcmp(custs[i].id, curStatusId.c_str())) { m3ApiReturn((uint32_t)(n + i)); }
  m3ApiReturn((uint32_t)idx);
}
m3ApiRawFunction(m3_clock) {  // 本地时钟：今日已过分钟数 0-1439；未校时 -1
  m3ApiReturnType(int32_t);
  m3ApiReturn(epochBase >= 0 ? minOf(localEpochMs()) : -1);
}
m3ApiRawFunction(m3_segSec) { // 当前状态已持续秒数（millis 域，未校时也可用；做"专注 12:30"类计时）
  m3ApiReturnType(uint32_t);
  m3ApiReturn(segCount ? (millis() - segs[segCount - 1].startMs) / 1000 : 0);
}
m3ApiRawFunction(m3_nodeMin) { // 距今日下个计划节点的分钟数；-1=无节点/今日暂停/已收工/未校时（"会议还 X 分钟结束"）
  m3ApiReturnType(int32_t);
  int32_t r = -1;
  if (epochBase >= 0 && !schedPausedToday()) {
    const int64_t e = localEpochMs();
    const int32_t day = dayOf(e);
    if (offSetDay != day) {
      const int nowMin = minOf(e);
      const int si = effSched(day);
      if (si >= 0)
        for (int i = 0; i < scheds[si].n; i++)
          if (scheds[si].ns[i].min > nowMin) { r = scheds[si].ns[i].min - nowMin; break; }
    }
  }
  m3ApiReturn(r);
}

void appUnload() {
  if (wasmRun) wasmRun = nullptr;
  if (wasmRt) { m3_FreeRuntime(wasmRt); wasmRt = nullptr; }
  free(wasmBytes); wasmBytes = nullptr; wasmLen = 0;   // 模块字节码在 runtime 释放后才能 free
  appPlaying = false;
}

// 按状态加载 /app_<id>.wasm；成功进入 appPlaying，失败回默认屏
void appLoad(const String& statusId) {
  appUnload();
  appColor = 1; // 绘制模式复位，不跨 app 泄漏
  File f = LittleFS.open("/app_" + statusId + ".wasm", "r");
  if (!f) return;
  size_t n = f.size();
  uint8_t* bytes = (n > 0 && n <= APP_MAX_SIZE) ? (uint8_t*)malloc(n) : nullptr;
  if (bytes) { f.read(bytes, n); f.close(); } else f.close();
  if (!bytes) return;
  if (!wasmEnv) wasmEnv = m3_NewEnvironment();
  wasmRt = m3_NewRuntime(wasmEnv, 16 * 1024, NULL);
  IM3Module mod = nullptr;
  M3Result r = nullptr;
  if (wasmRt) {
    r = m3_ParseModule(wasmEnv, &mod, bytes, n);
    if (!r) r = m3_LoadModule(wasmRt, mod);
  }
  if (!r) {
    m3_LinkRawFunction(mod, "env", "clear",   "v()",     &m3_clear);
    m3_LinkRawFunction(mod, "env", "show",    "v()",     &m3_show);
    m3_LinkRawFunction(mod, "env", "px",      "v(ii)",   &m3_px);
    m3_LinkRawFunction(mod, "env", "color",   "v(i)",    &m3_color);
    m3_LinkRawFunction(mod, "env", "rect",    "v(iiiii)",&m3_rect);
    m3_LinkRawFunction(mod, "env", "line",    "v(iiii)", &m3_line);
    m3_LinkRawFunction(mod, "env", "circle",  "v(iiii)", &m3_circle);
    m3_LinkRawFunction(mod, "env", "ellipse", "v(iiiii)",&m3_ellipse);
    m3_LinkRawFunction(mod, "env", "rrect",   "v(iiiiii)", &m3_rrect);
    m3_LinkRawFunction(mod, "env", "bitmap",  "v(iiiii)",&m3_bitmap);
    m3_LinkRawFunction(mod, "env", "text",    "v(iiii)", &m3_text);
    m3_LinkRawFunction(mod, "env", "textC",   "v(iiii)", &m3_textC);
    m3_LinkRawFunction(mod, "env", "bigText", "v(iiii)", &m3_bigText);
    m3_LinkRawFunction(mod, "env", "textW",   "i(iii)",  &m3_textW);
    m3_LinkRawFunction(mod, "env", "textA",   "v(iiiiii)", &m3_textA);
    m3_LinkRawFunction(mod, "env", "millis",  "i()",     &m3_millis);
    m3_LinkRawFunction(mod, "env", "buttons", "i()",     &m3_buttons);
    m3_LinkRawFunction(mod, "env", "status",  "i()",     &m3_status);
    m3_LinkRawFunction(mod, "env", "clock",   "i()",     &m3_clock);
    m3_LinkRawFunction(mod, "env", "segSec",  "i()",     &m3_segSec);
    m3_LinkRawFunction(mod, "env", "nodeMin", "i()",     &m3_nodeMin);
    r = m3_FindFunction(&wasmRun, wasmRt, "run");
  }
  if (!r) {
    wasmBytes = bytes; wasmLen = n;
    appPlaying = true; appOkFrames = 0;
    strncpy(crashedApp, statusId.c_str(), sizeof(crashedApp) - 1); // 看门狗复位后据此禁用该 app
    Serial.printf("[APP] loaded %s (%u)\n", statusId.c_str(), n);
  } else {
    Serial.printf("[APP] load failed %s (%s)\n", statusId.c_str(), r ? r : "no mem");
    sendAppErr(statusId.c_str(), r ? r : "no mem");
    appUnload(); free(bytes);
  }
}

// 未连接时的本地状态切换：屏幕显示与 LED 跟随，连上后以网页下发为准
void setLocalStatus(const char* id) {
  const StatusDef st = statusDefOf(id);
  String nid = id;                                     // 保留原 id（自定义/未知状态不塌缩成 work）
  if (curStatusId != nid) markStatus(nid.c_str());
  curStatusId = nid; scrMain = st.zh; scrSub = st.hint;
  ledMode = ledModeOf(nid.c_str());              // 灯效跟随设备配置（事实源 /led.json）
  oledDirty = true;
}
void cycleLocal(int dir) {
  // 循环顺序：内建（off 除外——由收工键单独触发）+ 自定义状态
  const char* ids[14]; int n = 0;
  for (auto& s : STATUSES) if (strcmp(s.id, "off")) ids[n++] = s.id;
  for (int i = 0; i < custCount; i++) ids[n++] = custs[i].id;
  int idx = 0;
  for (int i = 0; i < n; i++) if (!strcmp(ids[i], curStatusId.c_str())) idx = i;
  idx = (idx + dir + n) % n;
  setLocalStatus(ids[idx]);
}

// ===================== 计划表执行（设备自治） =====================

void pollSchedule() {
  if (epochBase < 0) return;                         // 未校时无法执行（wantTime 会持续请求）
  const int64_t e = localEpochMs();
  const int32_t day = dayOf(e);
  const int nowMin = minOf(e);
  if (day != schedDay) {                             // 跨天：挂起重置（暂停日天然过期）
    schedDay = day; schedHold = false; schedLastMin = -1;
  }
  const int si = effSched(day);                      // 单日计划优先于启用的重复计划
  if (si < 0 || scheds[si].n == 0) return;
  Sched& tab = scheds[si];
  if (nowMin == schedLastMin) return;                // 每分钟最多评估一次
  const int prevMin = schedLastMin; schedLastMin = nowMin;
  // mode="next"：跨过节点边界 → 手动干预结束，计划表恢复执行
  if (prevMin >= 0 && schedHold) {
    for (int i = 0; i < tab.n; i++)
      if (tab.ns[i].min > prevMin && tab.ns[i].min <= nowMin) { schedHold = false; break; }
  }
  if (schedPausedToday() || schedHold) return;
  const int exp = expectedIdxOf(si, nowMin);
  if (exp < 0) return;                               // 首个节点之前不干预
  const char* expStatus = tab.ns[exp].status;
  if (offSetDay == day) return;                          // 今天已收工 = 今日计划完成，所有节点作废（手动切换不受影响）
  static int skipLogged = -2;                            // 失效状态：节点跳过（状态已从注册表删除），每个节点只记一次日志
  if (!statusKnown(expStatus)) {
    if (skipLogged != exp) { skipLogged = exp; Serial.printf("[SCHED] %02d:%02d skip unknown status %s (%s)\n", nowMin / 60, nowMin % 60, expStatus, tab.name); }
    return;
  }
  skipLogged = -2;
  if (strcmp(expStatus, curStatusId.c_str())) {
    Serial.printf("[SCHED] %02d:%02d -> %s (%s)\n", nowMin / 60, nowMin % 60, expStatus, tab.name);
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
      segCount = 0; pendCount = 0;                   // 昨日恢复段一并丢弃
      markStatus(curStatusId.c_str());               // 新的一天重开区间
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

// —— 接线验证探针（临时）：新模块只打串口日志，功能角色待正式分配 ——
bool ttpLast; int8_t encAcc = 0; uint8_t encLast = 0; bool encKeyLast; uint8_t rawA = 2, rawB = 2;
uint8_t rawK[4] = { 2, 2, 2, 2 };
const uint8_t rawKPin[4] = { 17, 16, 15, 7 };     // 按键四脚边沿：排查插错行/悬 GND
bool encQuadAlive; int8_t singleAcc;               // 双相是否真解出过步（B 毛刺锁不死单相兜底）

void sendEncDir(int dir) {
  char buf[48]; snprintf(buf, sizeof buf, "{\"type\":\"enc\",\"dir\":%d}", dir);
  sendLine(buf);
}

void pollProbes() {
  bool t = digitalRead(PIN_TTP_SIG);          // TTP223 主动输出：高=摸到
  if (t != ttpLast) { ttpLast = t; Serial.printf("[PROBE] TTP223 %s\n", t ? "touch" : "release"); }
  for (int i = 0; i < 4; i++) {
    uint8_t v = digitalRead(rawKPin[i]);
    if (v != rawK[i]) { rawK[i] = v; Serial.printf("[PROBE] KEY %d=%d\n", rawKPin[i], v); }
  }
  bool k = digitalRead(PIN_ENC_KEY);          // 上拉：按住=0
  uint8_t ra = digitalRead(PIN_ENC_A), rb = digitalRead(PIN_ENC_B);   // 原始电平边沿，排查线通不通
  bool aEdge = (ra != rawA);
  if (aEdge) { rawA = ra; Serial.printf("[PROBE] ENC A=%d\n", ra); }
  if (rb != rawB) { rawB = rb; Serial.printf("[PROBE] ENC B=%d\n", rb); }
  static const int8_t qei[16] = { 0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0 };
  uint8_t s = (ra << 1) | rb;
  encAcc += qei[(encLast << 2) | s]; encLast = s;
  if (encAcc >= 4 || encAcc <= -4) {
    int dir = encAcc > 0 ? 1 : -1; encAcc = 0; encQuadAlive = true; singleAcc = 0;
    if (!k) dir = -dir;                                   // 按住 KEY 转 = 反向（双相模式下也生效）
    Serial.printf("[PROBE] ENC %s%s\n", dir > 0 ? "cw ->" : "ccw <-", !k ? " key" : "");
    sendEncDir(dir);
  }
  // 单相兜底：双相从没真解出过步（S2 没接上/断了）→ 方向只能靠"按住 KEY 转=反向"
  if (!encQuadAlive && aEdge && ++singleAcc >= 2) {
    singleAcc = 0;
    int dir = k ? 1 : -1;
    Serial.printf("[PROBE] ENC %s 1-phase%s\n", dir > 0 ? "cw ->" : "ccw <-", k ? "" : " key");
    sendEncDir(dir);
  }
  if (k != encKeyLast) { encKeyLast = k; Serial.printf("[PROBE] ENC key %s\n", k ? "release" : "press"); }
}
#endif

// ===================== 语音转文字：I2S 麦 + IMA-ADPCM 帧流 =====================
// 网页发 stt start/stop；设备把 16kHz PCM 编成 ADPCM，按 aud JSON 帧上行（BLE notify / 串口同路）
// 帧自洽：[pred_lo, pred_hi, stepIdx, nibbles…] → 丢帧只留缺口，不会糊掉后续
constexpr uint32_t MIC_RATE = 16000;
constexpr uint16_t ADPCM_HDR = 3, ADPCM_NIB = 117;          // 117B 数据 → b64 160c → aud JSON ~196B < MTU-3

uint16_t audSeq;
int16_t  adpcmPred; int8_t adpcmIdx;                         // 编码器状态（跨帧连续演进）
uint8_t  adpcmBuf[ADPCM_HDR + ADPCM_NIB];
uint16_t adpcmPos; bool adpcmHi;                             // 半字节打包

const int16_t ADPCM_STEP[89] = {
  7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,
  130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,
  1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,
  6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767
};
const int8_t ADPCM_IDX[16] = { -1,-1,-1,-1,2,4,6,8, -1,-1,-1,-1,2,4,6,8 };

void sendSttState(const char* state, const char* msg = nullptr) {
  char buf[200];
  snprintf(buf, sizeof buf, "{\"type\":\"sttState\",\"state\":\"%s\",\"rate\":%u,\"codec\":\"adpcm\",\"ms\":%lu%s%s%s}",
    state, (unsigned)MIC_RATE, (unsigned long)micLastMs,
    msg ? ",\"msg\":\"" : "", msg ? msg : "", msg ? "\"" : "");
  sendLine(buf);
}

void adpcmFrameBegin() {                                      // 帧头写当前预测器 → 每帧可独立解码
  adpcmBuf[0] = (uint8_t)adpcmPred;
  adpcmBuf[1] = (uint8_t)((uint16_t)adpcmPred >> 8);
  adpcmBuf[2] = (uint8_t)adpcmIdx;
  adpcmPos = ADPCM_HDR; adpcmHi = true;
}

void adpcmFlush() {
  if (adpcmPos <= ADPCM_HDR) return;
  if (!adpcmHi) adpcmPos++;                                   // 尾半字节补 0
  char b64[172]; size_t olen = 0;
  mbedtls_base64_encode((uint8_t*)b64, sizeof b64, &olen, adpcmBuf, adpcmPos);
  b64[olen] = 0;
  char line[224];
  snprintf(line, sizeof line, "{\"type\":\"aud\",\"seq\":%u,\"data\":\"%s\"}", (unsigned)audSeq, b64);
  sendLine(line);
  audSeq++;
  adpcmFrameBegin();
}

void adpcmEmit(int16_t sample) {
  const int16_t step0 = ADPCM_STEP[adpcmIdx];
  int32_t diff = sample - adpcmPred;
  uint8_t nb = 0;
  if (diff < 0) { nb = 8; diff = -diff; }
  int32_t step = step0, vpdiff = step >> 3;
  if (diff >= step) { nb |= 4; diff -= step; vpdiff += step; } step >>= 1;
  if (diff >= step) { nb |= 2; diff -= step; vpdiff += step; } step >>= 1;
  if (diff >= step) { nb |= 1;                vpdiff += step; }
  int32_t pred = adpcmPred + ((nb & 8) ? -vpdiff : vpdiff);
  adpcmPred = (int16_t)constrain(pred, -32768, 32767);
  adpcmIdx = (int8_t)constrain(adpcmIdx + ADPCM_IDX[nb], 0, 88);
  if (adpcmHi) adpcmBuf[adpcmPos] = nb << 4;
  else         adpcmBuf[adpcmPos++] |= nb;
  adpcmHi = !adpcmHi;
  if (adpcmPos >= sizeof adpcmBuf) adpcmFlush();
}

bool micStart() {
  if (micOn) { sendSttState("recording"); return true; }
  i2s_config_t cfg = {};
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = MIC_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;            // INMP441 出 24bit/32bit 槽
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;             // L/R 接地 = 左声道
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  cfg.dma_buf_count = 8; cfg.dma_buf_len = 512;               // ~256ms 缓冲，扛 OLED/串口抖动
  cfg.use_apll = false;
  i2s_pin_config_t pins = {};
  pins.bck_io_num = PIN_MIC_SCK; pins.ws_io_num = PIN_MIC_WS;
  pins.data_out_num = I2S_PIN_NO_CHANGE; pins.data_in_num = PIN_MIC_SD;
  if (i2s_driver_install(I2S_NUM_0, &cfg, 0, nullptr) != ESP_OK || i2s_set_pin(I2S_NUM_0, &pins) != ESP_OK) {
    i2s_driver_uninstall(I2S_NUM_0);
    micLastMs = 0; sendSttState("error", "i2s_init");
    return false;
  }
  i2s_start(I2S_NUM_0);
  adpcmPred = 0; adpcmIdx = 0; audSeq = 0;
  adpcmFrameBegin();
  micOn = true; micStartMs = millis(); micLastMs = 0;
  oledDirty = true;
  sendSttState("recording");
  Serial.println("[MIC] recording");
  return true;
}

void micStop() {
  if (!micOn) return;
  micLastMs = millis() - micStartMs;
  adpcmFlush();                                               // 尾帧补零也发
  micOn = false;
  i2s_stop(I2S_NUM_0); i2s_driver_uninstall(I2S_NUM_0);
  oledDirty = true;
  sendSttState("idle");
  Serial.println("[MIC] stopped");
}

void pollMic() {
  static int32_t raw[128];
  size_t br = 0;
  i2s_read(I2S_NUM_0, raw, sizeof raw, &br, 20);              // ~8ms 一批
  const int n = (int)(br / 4);
  for (int i = 0; i < n; i++) adpcmEmit((int16_t)(raw[i] >> 16));
  micLastMs = millis() - micStartMs;
  if (micLastMs >= 60000) micStop();                          // 60s 上限自动收尾
}

// ===================== 待办提醒存储（设备事实源） =====================
// agent 工具与网页 todo 消息都写这里；到点复用提醒画面（OLED 15s + RGB 闪 3s）触发；
// todos 消息向网页同步。at = epoch(ms)（含 tz），-1 = 无定时仅清单。
// （todos/todoCount/nextTodoId 声明在文件顶部状态区）

void saveTodos() {
  File f = LittleFS.open("/todos.json", "w");
  if (!f) return;
  JsonDocument d;
  JsonArray arr = d["list"].to<JsonArray>();
  for (int i = 0; i < todoCount; i++) {
    JsonObject t = arr.add<JsonObject>();
    t["id"] = todos[i].id; t["at"] = todos[i].at; t["trig"] = todos[i].trig; t["text"] = todos[i].text;
    t["show"] = todos[i].show; t["created"] = todos[i].created; t["src"] = todos[i].src; t["done"] = todos[i].done;
  }
  serializeJson(d, f);
  f.close();
}
void loadTodos() {
  File f = LittleFS.open("/todos.json", "r");
  if (!f) return;
  JsonDocument d;
  if (!deserializeJson(d, f)) {
    for (JsonObject t : d["list"].as<JsonArray>()) {
      if (todoCount >= 16) break;
      strncpy(todos[todoCount].id, t["id"] | "", sizeof(todos[0].id) - 1);
      todos[todoCount].id[sizeof(todos[0].id) - 1] = 0;
      todos[todoCount].at = t["at"] | (int64_t)-1;
      todos[todoCount].trig = t["trig"] | 0;
      strncpy(todos[todoCount].text, t["text"] | "", sizeof(todos[0].text) - 1);
      todos[todoCount].text[sizeof(todos[0].text) - 1] = 0;
      todos[todoCount].show = t["show"] | 1;
      todos[todoCount].created = t["created"] | (int64_t)-1;
      strncpy(todos[todoCount].src, t["src"] | "", sizeof(todos[0].src) - 1);
      todos[todoCount].src[sizeof(todos[0].src) - 1] = 0;
      todos[todoCount].done = t["done"] | false;
      todoCount++;
    }
  }
  f.close();
  for (int i = 0; i < todoCount; i++) {              // 恢复 id 计数器：防重启后新待办撞上旧 id
    if (todos[i].id[0] == 't') {
      uint32_t n = (uint32_t)strtoul(todos[i].id + 1, nullptr, 10);
      if (n >= nextTodoId) nextTodoId = n + 1;
    }
  }
}
void sendTodos() {
  JsonDocument d;
  d["type"] = "todos";
  JsonArray arr = d["list"].to<JsonArray>();
  for (int i = 0; i < todoCount; i++) {
    JsonObject t = arr.add<JsonObject>();
    t["id"] = todos[i].id;
    if (todos[i].at >= 0) t["at"] = todos[i].at;
    if (todos[i].trig) t["trig"] = "offwork";
    t["text"] = todos[i].text;
    if (!todos[i].show) t["show"] = false;
    if (todos[i].created >= 0) t["created"] = todos[i].created;
    if (todos[i].src[0]) t["src"] = todos[i].src;
    t["done"] = todos[i].done;
  }
  String out; serializeJson(d, out); sendLine(out);
}
int todoFind(const char* id) { for (int i = 0; i < todoCount; i++) if (!strcmp(todos[i].id, id)) return i; return -1; }

bool todoAdd(int64_t at, uint8_t trig, const char* text, bool show, const char* src, char* outId) {
  if (todoCount >= 16) return false;
  Todo& t = todos[todoCount];
  snprintf(t.id, sizeof t.id, "t%lu", (unsigned long)(nextTodoId++));
  t.at = at; t.trig = trig;
  strncpy(t.text, text, sizeof(t.text) - 1); t.text[sizeof(t.text) - 1] = 0;
  t.show = show; t.created = epochBase >= 0 ? utcEpochMs() : -1;
  strncpy(t.src, src ? src : "", sizeof(t.src) - 1); t.src[sizeof(t.src) - 1] = 0;
  t.done = false;
  todoCount++;
  if (outId) strncpy(outId, t.id, 11);
  saveTodos(); sendTodos();
  return true;
}

// 触发一组待办：标 done + 提醒画面（正文可上屏的第一条做标题，其余只计数量）+ todoFired 上行（网页弹 toast 靠它区分"到点"和"手动完成"）
void fireTodos(int n, const char* firstShown, const char* idsJson) {
  strncpy(remindText, firstShown ? firstShown : "", sizeof(remindText) - 1);
  remindText[sizeof(remindText) - 1] = 0;
  remindCount = n;
  remindUntil = millis() + 15000;
  breakFlashUntil = millis() + 3000;
  oledDirty = true;
  char buf[220];
  snprintf(buf, sizeof buf, "{\"type\":\"todoFired\",\"ids\":[%s],\"count\":%d}", idsJson ? idsJson : "", n);
  sendLine(buf);
  saveTodos(); sendTodos();
}

// 收工触发：进入 off 状态时，所有"收工后提醒"待办一起响
void fireOffworkTodos() {
  int fired = 0; const char* firstShown = nullptr;
  char ids[200] = ""; int fi = 0;
  for (int i = 0; i < todoCount; i++)
    if (!todos[i].done && todos[i].trig == 1) {
      todos[i].done = true; fired++;
      if (todos[i].show && !firstShown) firstShown = todos[i].text;
      fi += snprintf(ids + fi, sizeof(ids) - fi, "%s\"%s\"", fired > 1 ? "," : "", todos[i].id);
    }
  if (fired) { fireTodos(fired, firstShown, ids); Serial.printf("[TODO] offwork fired x%d\n", fired); }
}

// 到点触发 + 跨天清已完成
void pollTodos() {
  if (epochBase < 0) return;
  const int64_t now = utcEpochMs();                    // at 是绝对时刻：比较也在绝对尺度上
  const int today = dayOf(localEpochMs());             // 跨天判断按本地日期
  if (lastTodoDay < 0) lastTodoDay = today;
  else if (lastTodoDay != today) {                 // 跨天：已完成的待办清除（与网页"已完成次日自动清除"一致）
    lastTodoDay = today;
    int w = 0;
    for (int i = 0; i < todoCount; i++) if (!todos[i].done) todos[w++] = todos[i];
    if (w != todoCount) { todoCount = w; saveTodos(); sendTodos(); }
  }
  int fired = 0; const char* firstShown = nullptr;
  char ids[200] = ""; int fi = 0;
  for (int i = 0; i < todoCount; i++)
    if (!todos[i].done && todos[i].trig == 0 && todos[i].at >= 0 && todos[i].at <= now) {
      todos[i].done = true; fired++;
      if (todos[i].show && !firstShown) firstShown = todos[i].text;
      fi += snprintf(ids + fi, sizeof(ids) - fi, "%s\"%s\"", fired > 1 ? "," : "", todos[i].id);
    }
  if (fired) { fireTodos(fired, firstShown, ids); Serial.printf("[TODO] fired x%d: %s\n", fired, firstShown ? firstShown : "(private)"); }
}

void handleTodoMsg(JsonDocument& doc) {
  const char* op = doc["op"] | "";
  if (!strcmp(op, "add")) {
    char id[12];
    todoAdd(doc["at"] | (int64_t)-1, !strcmp(doc["trig"] | "", "offwork") ? 1 : 0, doc["text"] | "",
            doc["show"] | true, doc["src"] | "web", id);
  } else if (!strcmp(op, "set")) {                 // 部分更新：网页编辑待办
    int i = todoFind(doc["id"] | "");
    if (i >= 0) {
      Todo& t = todos[i];
      if (doc["text"].is<const char*>()) { strncpy(t.text, doc["text"], sizeof(t.text) - 1); t.text[sizeof(t.text) - 1] = 0; }
      if (doc.containsKey("at")) t.at = doc["at"] | (int64_t)-1;
      if (doc.containsKey("trig")) t.trig = !strcmp(doc["trig"] | "", "offwork") ? 1 : 0;
      if (doc.containsKey("show")) t.show = doc["show"] | true;
      if (doc.containsKey("done")) t.done = doc["done"] | false;
      saveTodos(); sendTodos();
    }
  } else if (!strcmp(op, "done")) {
    int i = todoFind(doc["id"] | "");
    if (i >= 0) { todos[i].done = doc["done"] | true; saveTodos(); sendTodos(); }
  } else if (!strcmp(op, "del")) {
    int i = todoFind(doc["id"] | "");
    if (i >= 0) { memmove(&todos[i], &todos[i + 1], (todoCount - i - 1) * sizeof(Todo)); todoCount--; saveTodos(); sendTodos(); }
  } else if (!strcmp(op, "clear")) {
    todoCount = 0; saveTodos(); sendTodos();
  } else if (!strcmp(op, "list")) sendTodos();
}

// ===================== 设备端 Agent 循环 =====================
// 最小 pi-agent 模式移植：消息数组 → agentReq 交网页代理 → agentRes 回 → tool_calls 执行 → 结果回填 → 再来一轮
// LLM 只能经网页调用（设备无网）；≤4 轮、每轮 30s 超时、断连即中止。
// （状态变量声明在文件顶部状态区——drawOled 要用 agentWaiting/agentReply*）

const char AGENT_TOOLS[] = R"json([
  {"type":"function","function":{"name":"reminder_add","description":"创建设备上的到点提醒（存在设备本地，断网断电也会到点提醒）","parameters":{"type":"object","properties":{"text":{"type":"string","description":"提醒内容，不超过20个汉字"},"in_minutes":{"type":"integer","description":"多少分钟后提醒；与 at_time 二选一"},"at_time":{"type":"string","description":"本地时间 HH:MM（24小时制）；今天该时刻已过则算明天"}},"required":["text"]}}},
  {"type":"function","function":{"name":"reminder_list","description":"列出设备上的待办提醒","parameters":{"type":"object","properties":{}}}},
  {"type":"function","function":{"name":"status_get","description":"获取设备当前工作状态和本地时间","parameters":{"type":"object","properties":{}}}},
  {"type":"function","function":{"name":"status_set","description":"切换当前工作状态","parameters":{"type":"object","properties":{"status":{"type":"string","description":"状态id：work=工作中 busy=请勿打扰 focus=专注中 meet=会议中 rest=休息 off=收工，或自定义状态id(c开头)"}},"required":["status"]}}}
])json";

String nowHHMM() {
  if (epochBase < 0) return "??:??";
  const int m = minOf(localEpochMs());
  char b[8]; snprintf(b, sizeof b, "%02d:%02d", m / 60, m % 60); return String(b);
}

void agentSendReq() {
  JsonDocument req, tools;
  deserializeJson(tools, AGENT_TOOLS);
  req["type"] = "agentReq";
  req["round"] = agentRound;
  req["msgs"] = agentMsgs;
  req["tools"] = tools;
  String out; serializeJson(req, out);
  sendLine(out);
  agentWaiting = true;
  agentDeadline = millis() + AG_TIMEOUT_MS;
  oledDirty = true;
  Serial.printf("[AGENT] req round=%d msgs=%u bytes=%u\n", agentRound, (unsigned)agentMsgs.size(), (unsigned)out.length());
}

void agentDone(const char* reply) {
  agentWaiting = false;
  strncpy(agentReply, reply ? reply : "", sizeof(agentReply) - 1);
  agentReply[sizeof(agentReply) - 1] = 0;
  agentReplyUntil = agentReply[0] ? millis() + 8000 : 0;
  agentMsgs.clear();
  oledDirty = true;
  String out = F("{\"type\":\"agentDone\",\"text\":\"");
  for (const char* p = agentReply; *p; p++) out += (*p == '"' || *p == '\\') ? '\'' : *p;   // 防引号破坏 JSON
  out += "\"}";
  sendLine(out);
  Serial.printf("[AGENT] done: %s\n", agentReply);
}
void agentAbort(const char* why) {
  if (!agentWaiting && !agentMsgs.size()) return;
  agentWaiting = false; agentMsgs.clear(); oledDirty = true;
  char buf[128]; snprintf(buf, sizeof buf, "{\"type\":\"agentErr\",\"msg\":\"%s\"}", why);
  sendLine(buf);
  Serial.printf("[AGENT] abort: %s\n", why);
}

String runTool(const char* name, const char* argsJson) {
  JsonDocument a;
  if (argsJson && argsJson[0]) deserializeJson(a, argsJson);
  if (!strcmp(name, "reminder_add")) {
    if (epochBase < 0) return F("{\"ok\":false,\"err\":\"no_time\"}");
    const char* text = a["text"] | "";
    const int64_t e = utcEpochMs();                       // 绝对时刻：at 存绝对 epoch
    int64_t at = -1;
    if (a["in_minutes"].is<int>()) at = e + (int64_t)a["in_minutes"].as<int>() * 60000LL;
    else if (a["at_time"].is<const char*>()) {
      int hh, mm;
      if (sscanf(a["at_time"], "%d:%d", &hh, &mm) == 2) {
        at = (int64_t)dayOf(localEpochMs()) * 86400000LL + (int64_t)(hh * 60 + mm) * 60000LL - (int64_t)tzOffsetMin * 60000LL; // 本地 HH:MM → 绝对时刻
        if (at <= e) at += 86400000LL;                     // 今天已过 → 明天
      }
    }
    if (at < 0) return F("{\"ok\":false,\"err\":\"no_when\"}");
    char id[12];
    if (!todoAdd(at, 0, text, true, "voice", id)) return F("{\"ok\":false,\"err\":\"full\"}");
    char buf[96]; snprintf(buf, sizeof buf, "{\"ok\":true,\"id\":\"%s\",\"at\":%lld}", id, at);
    return String(buf);
  }
  if (!strcmp(name, "reminder_list")) {
    String s = F("{\"todos\":[");
    bool first = true;
    for (int i = 0; i < todoCount; i++) if (!todos[i].done) {
      s += first ? "" : ","; first = false;
      s += "{\"text\":\""; s += todos[i].text; s += "\"";
      if (todos[i].at >= 0) { char b[40]; snprintf(b, sizeof b, ",\"at\":%lld", todos[i].at); s += b; }
      s += "}";
    }
    s += "]}"; return s;
  }
  if (!strcmp(name, "status_get")) {
    char buf[96]; snprintf(buf, sizeof buf, "{\"status\":\"%s\",\"zh\":\"%s\",\"time\":\"%s\"}",
      curStatusId.c_str(), statusDefOf(curStatusId.c_str()).zh, nowHHMM().c_str());
    return String(buf);
  }
  if (!strcmp(name, "status_set")) {
    const char* st = a["status"] | "";
    bool ok = custIdx(st) >= 0;
    for (auto& s : STATUSES) if (!strcmp(s.id, st)) ok = true;
    if (!ok) return F("{\"ok\":false,\"err\":\"bad_status\"}");
    setLocalStatus(st); registerManualOverride(st);
    char buf[64]; snprintf(buf, sizeof buf, "{\"ok\":true,\"status\":\"%s\"}", st);
    return String(buf);
  }
  return F("{\"ok\":false,\"err\":\"unknown_tool\"}");
}

void handleAgentRes(JsonDocument& doc) {
  if (!agentWaiting) return;
  agentWaiting = false;
  JsonObject msg = doc["message"].as<JsonObject>();
  if (msg.isNull()) { agentAbort("bad_response"); return; }
  agentMsgs.add(msg);                                     // assistant 消息（含 content/tool_calls）回填
  JsonArray tcs = msg["tool_calls"].as<JsonArray>();
  if (!tcs.isNull() && tcs.size()) {
    for (JsonObject tc : tcs) {
      const char* name = tc["function"]["name"] | "";
      const char* args = tc["function"]["arguments"] | "";
      String res = runTool(name, args);
      JsonObject tm = agentMsgs.add<JsonObject>();
      tm["role"] = "tool";
      tm["tool_call_id"] = tc["id"] | "";
      tm["content"] = res;
      Serial.printf("[AGENT] tool %s -> %.80s\n", name, res.c_str());
    }
    if (++agentRound < AG_MAX_ROUND) { agentSendReq(); return; }
    agentDone("（步骤较多，已执行完最后一轮工具）");
    return;
  }
  agentDone(msg["content"] | "");
}

void agentStart(const char* text) {
  if (agentWaiting || agentMsgs.size()) { Serial.println("[AGENT] busy, skip"); return; }
  agentMsgs.clear();
  JsonObject sys = agentMsgs.add<JsonObject>();
  sys["role"] = "system";
  String sp = F("你是桌面状态牌「收工牌」上的语音助手。当前本地时间 ");
  sp += nowHHMM(); sp += "，当前状态「"; sp += findStatus(curStatusId.c_str())->zh; sp += "」。";
  sp += F("用户刚对设备说了一句话（已转成文字）。规则：要设提醒/待办→调 reminder_add（提醒文字不超过20字）；"
          "要切换工作状态→status_set；问状态或时间→status_get；其余情况直接用不超过30字的中文回答。"
          "拿不准意图就别调工具，用一句话回应。");
  sys["content"] = sp;
  JsonObject usr = agentMsgs.add<JsonObject>();
  usr["role"] = "user"; usr["content"] = text;
  agentRound = 0;
  agentSendReq();
}

// ===================== 入口 =====================

void setup() {
  Serial.setRxBufferSize(8192);     // agentRes 等长 JSON 行可达数 KB，默认 256B 会溢出丢字节
  Serial.begin(460800);             // 音频帧流需要 >11.5KB/s，115200 吃不下 → 460800
  delay(300);
  Serial.printf("\n[BOOT] 收工牌 %s\n", FIRMWARE_VER);

  for (auto& k : keys) { pinMode(k.pin, INPUT_PULLUP); delay(2); k.last = digitalRead(k.pin); }
  // 新模块验证探针引脚：TTP223 主动输出用纯输入；旋钮编码器/按键开内部上拉
  pinMode(PIN_TTP_SIG, INPUT); pinMode(PIN_ENC_A, INPUT_PULLUP); pinMode(PIN_ENC_B, INPUT_PULLUP); pinMode(PIN_ENC_KEY, INPUT_PULLUP);
  ttpLast = digitalRead(PIN_TTP_SIG); encKeyLast = digitalRead(PIN_ENC_KEY);
  encLast = (digitalRead(PIN_ENC_A) << 1) | digitalRead(PIN_ENC_B);

  oled.begin();
  oled.enableUTF8Print();
  rgb.begin(); rgb.clear(); rgb.show();
  LittleFS.begin(true);               // 自定义屏幕 wasm / 待办存储（失败则格式化）
  loadTodos();
  loadSchedules();                    // 计划表清单：重启后无需网页重连即可继续自治执行
  loadStdefs();                       // 自定义状态注册表
  loadKeys();                         // 按键映射
  loadLed();                          // 灯效设置
  loadSegs();                         // 断电前的今日区间：校时后 adoptPendSegs 回填
  // 崩溃防护：上次运行中的 app 导致看门狗/异常复位 → 禁用该文件（改名 .bad，避免重启死循环）
  esp_reset_reason_t rr = esp_reset_reason();
  if ((rr == ESP_RST_PANIC || rr == ESP_RST_TASK_WDT || rr == ESP_RST_INT_WDT || rr == ESP_RST_WDT) && crashedApp[0]) {
    String bad = "/app_" + String(crashedApp) + ".wasm";
    LittleFS.rename(bad, bad + ".bad");
    Serial.printf("[APP] disabled %s after crash\n", bad.c_str());
    crashedApp[0] = 0;
  }
  if (File lf = LittleFS.open("/layout", "r")) { const int v = lf.read(); if (v >= 0 && v <= 2) scrLayout = v; lf.close(); }

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
    sendApps();                            // 设备上实际安装的自定义屏幕
    sendTodos();                           // 设备待办事实源同步给网页
    sendSchedules();                       // 计划表清单事实源同步给网页
    sendStdefs();                          // 自定义状态注册表事实源同步给网页
    sendKeys();                            // 按键映射事实源同步给网页
    sendLed();                             // 灯效设置事实源同步给网页
    segDirty = true;                       // 随后推送今日状态区间
  }
  pollKeys();
  pollTouch();
  pollProbes();
  pollBreak();
  pollSchedule();
  pollTodos();
  if (agentWaiting && (int32_t)(millis() - agentDeadline) > 0) agentAbort("timeout");
  // 串口通道：与 BLE 共用同一套 JSON 行协议
  static String serBuf;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') { if (serBuf.length()) { handleLine(serBuf); serBuf = ""; } }
    else if (c != '\r') serBuf += c;
  }
  if (micOn) pollMic();
  // app 读回：每次循环只发一行（~100ms 串口时间），逐帧摊薄避免阻塞
  if (appDumpFile) {
    size_t n = appDumpFile.read(dumpBuf, sizeof dumpBuf);
    size_t olen = 0;
    if (n) mbedtls_base64_encode((uint8_t*)dumpB64, sizeof dumpB64, &olen, dumpBuf, n);
    dumpB64[olen] = 0;
    const bool last = n == 0 || appDumpFile.position() >= appDumpFile.size();
    snprintf(dumpLine, sizeof dumpLine,
      "{\"type\":\"appData\",\"status\":\"%s\",\"seq\":%u,\"last\":%s,\"data\":\"%s\"}",
      appDumpStatus, (unsigned)appDumpSeq, last ? "true" : "false", dumpB64);
    sendLine(dumpLine);
    appDumpSeq++;
    if (last) appDumpFile.close();
  }
  updateLed();
  // 状态切换 → 加载该状态的 WASM 屏幕 app（LittleFS 持久）；没有则回到默认状态屏
  if (strcmp(appFor, curStatusId.c_str())) {
    strncpy(appFor, curStatusId.c_str(), sizeof(appFor) - 1);
    appLoad(curStatusId);
  }
  // OLED：app 播放中由 wasm run() 接管（提醒/休息通知仍临时覆盖）；否则状态变化立即重绘 + 每秒刷时钟
  static uint32_t lastDraw = 0;
  const bool notice = millis() < remindUntil || millis() < breakNoticeUntil || micOn;   // 录音期间暂停自定义屏，显示录音画面
  if (appPlaying && !notice) {
    if ((int32_t)(millis() - appNext) >= 0) {
      appNext = millis() + 33;                                     // ~30fps 节流
      M3Result r = m3_CallV(wasmRun);
      if (r) {
        Serial.printf("[APP] trap in %s: %s\n", appFor, r);
        sendAppErr(appFor, r);
        appUnload(); crashedApp[0] = 0; oledDirty = true;          // trap 只禁用本次运行，文件保留可修代码重传
      } else if (appOkFrames < 200 && ++appOkFrames == 200) {
        crashedApp[0] = 0;                                         // 稳定运行 ~6s 后解除崩溃标记
      }
    }
  } else if (oledDirty || millis() - lastDraw > 1000) {
    drawOled(); oledDirty = false; lastDraw = millis();
  }
  delay(5);
}
