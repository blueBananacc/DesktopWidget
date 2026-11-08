// usb_net.cpp — USB NCM 虚拟网卡（doc/usb-net.md）
// 原生 USB OTG 口上，CDC 串口之外再挂一个 NCM 网卡接口（复合设备）：
//   枚举 → Windows 经 MS OS 1.0(string 0xEE) 读到 compatible id "WINNCM" → 绑 UsbNcm.sys → 出网卡
//   设备侧 TinyUSB NCM 驱动 ↔ 自加 lwIP netif(192.168.55.1/24) ↔ DHCP server ↔ TCP:80
// HTTP 语义不变：socket 字节经队列交给 loopTask 的 httpFeed，复用全部路由与事件订阅。
//
// 关键时序：main.cpp 在 setup() 之前就 Serial.begin()→tinyusb_init()，
// 所以接口注册放在本文件的全局构造函数里（早于一切 setup 代码）。

#include <Arduino.h>
#include "usb_net.h"

#if !ARDUINO_USB_MODE // 仅 TinyUSB 设备栈构建（boards.txt: USBMode=default）才有网络接口

#include <tusb.h>
#include <class/net/net_device.h>
#include <device/usbd_pvt.h>
#include "esp32-hal-tinyusb.h"
#include "USB.h"

#if CFG_TUD_NCM

#include <lwip/netif.h>
#include <lwip/pbuf.h>
#include <lwip/etharp.h>
#include <lwip/tcpip.h>
#include <lwip/inet.h>
#include <lwip/sockets.h>
#include <lwip/ip4_addr.h>
#include <apps/dhcpserver/dhcpserver.h>
#include <esp_mac.h>
#include <freertos/task.h>
#include <freertos/semphr.h>

// ---------------- 设备身份 ----------------
// Windows 的 usbncm.inf 只按 compatible id 绑定（USB\MS_COMP_WINNCM），类码匹配被注释。
// 两条播 WINNCM 的通路都备好：
//   MS OS 1.0：string 0xEE + wIndex=0x0004 compat id —— 本机实际走通的通路，
//              不依赖 BOS（实测 bcdUSB=0x0201 会让这台 Windows 枚举失败）。
//   MS OS 2.0：hal 内建 BOS 宣告 vendor code=2，主机若问起 wIndex=0x0007 也照答，
//              供其它主控/未来固件使用。
// 设备描述符 idProduct 在现场补丁成 SGP_NET_PID（复合设备换新 PID，避开旧驱动缓存）。
#define SGP_NET_PID      0x1003        // 0x1002 的 devnode 已被早期崩溃版污染，换新 PID 强制干净枚举
#define MSOS20_INDEX     0x07
#define VENDOR_REQ_MS    0x02        // hal BOS 中 MS OS 2.0 能力约定的 vendor code

static uint8_t  g_ncmItf = 0xFF;           // NCM comm 接口号（描述符加载时才知道）
static bool     g_msosClaimed = false;     // 本控制传输由我们认领（供 DATA/ACK 阶段应答 true）
uint8_t         tud_network_mac_address[6];// net_device.h 要求应用提供
static uint8_t  g_mac[6];
static char     g_macStr[13];              // iMACAddress 字符串：必须静态——hal 只存指针，
                                           // 主机在功能启动阶段才真正读它，栈内存早已失效

extern "C" const uint8_t* tud_descriptor_device_cb(void);  // hal 提供 → 返回设备描述符指针

// ---- MS OS 2.0 描述符集：Set Header + Function Subset + WINNCM Compatible ID ----
// hal 的 BOS 把集合总长声明成 178B，Windows 按它请求 wLength=178。
// 集合自身 wTotalLength=38（只含真实子集），应答缓冲补齐到 178 以满足传输长度。
#define MSOS20_SET_LEN   38
#define MSOS20_XFER_LEN  0xB2   // = hal BOS 里 wMSOSDescriptorSetTotalLength
static void buildMsOs20(uint8_t* o) {
  memset(o, 0, MSOS20_XFER_LEN);
  o[0] = 10; o[2] = 0x00; o[3] = 0x00;                                 // wLength=10, SET_HEADER
  o[4] = 0x00; o[5] = 0x00; o[6] = 0x03; o[7] = 0x06;                  // bWindowsVersion 0x06030000
  o[8] = MSOS20_SET_LEN;                                               // wTotalLength
  o[10] = 8; o[12] = 0x02; o[13] = 0x00;                               // wLength=8, SUBSET_HEADER_FUNCTION
  o[14] = g_ncmItf;                                                    // bFirstInterface = NCM comm itf
  o[16] = 28;                                                          // wSubsetLength
  o[18] = 20; o[20] = 0x03; o[21] = 0x00;                              // wLength=20, FEATURE_COMPATBLE_ID
  memcpy(o + 22, "WINNCM\0\0", 8);                                     // CompatibleID
}

static struct netif* g_netif;

// ---- MS OS 1.0 通路：bcdUSB 0x0200 下也能工作（不依赖 BOS）----
// string 0xEE = "MSFT100"+vendor code；Windows 读到后发 vendor 请求 wIndex=0x0004
// 取 Extended Compat ID → 回 WINNCM → 与 MS OS 2.0 相同的 USB\MS_COMP_WINNCM hwid
#define MSOS1_VENDOR   0x03
#define MSOS1_COMPAT_WINDEX 0x0004

// hal 的 string_cb 走序号表且表是 static 外部够不着 —— 覆写 weak 回调，
// 复刻 hal 表内容（顺序必须与 loaders 的 add 顺序一致），另补 0xEE=MSFT100。
// 索引：0 langid / 1 厂商 / 2 产品 / 3 序列(MAC) / 4 "TinyUSB CDC" / 5 NIC / 6 MAC串 / 7 cfg
static char g_usbSerial[18];                    // "xx:xx:xx:xx:xx:xx"（原始 efuse MAC）
extern "C" const uint16_t* tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
  if (index == 0xEE) {
    // 18B: len+type, "MSFT100" UTF-16LE, vendor code, pad
    static const uint16_t d[] = {
      (TUSB_DESC_STRING << 8) | 18, 'M','S','F','T','1','0','0', MSOS1_VENDOR | 0x0000
    };
    return d;
  }
  static uint16_t buf[127];
  if (index == 0) {
    buf[1] = 0x0409;
    buf[0] = (TUSB_DESC_STRING << 8) | 4;
    return buf;
  }
  const char* s = NULL;
  switch (index) {
    case 1: s = "Espressif Systems"; break;
    case 2: s = ARDUINO_BOARD; break;
    case 3: s = g_usbSerial; break;
    case 4: s = "TinyUSB CDC"; break;
    case 5: s = "Shougongpai NIC"; break;
    case 6: s = g_macStr; break;
    case 7: s = "TinyUSB Device"; break;
    default: return NULL;
  }
  uint8_t n = strlen(s);
  if (n > 126) n = 126;
  for (uint8_t i = 0; i < n; i++) buf[1 + i] = s[i];
  buf[0] = (TUSB_DESC_STRING << 8) | (2 * n + 2);
  return buf;
}

static void buildMsOs1Compat(uint8_t* o) {
  memset(o, 0, 40);
  // dwLength=40, bcdVersion=0x0100, wIndex=0x0004, bCount=1
  o[0]=40; o[4]=0x00; o[5]=0x01; o[6]=0x04; o[7]=0x00; o[8]=1;
  // function 0: bFirstInterfaceNumber=g_ncmItf, reserved=1, compatibleID="WINNCM\0\0"
  o[16]=g_ncmItf; o[17]=1;
  memcpy(o+18, "WINNCM\0\0", 8);
}

// hal 的 tud_vendor_control_xfer_cb 兜底委托到本 weak 钩子
extern "C" bool tinyusb_vendor_control_request_cb(uint8_t rhport, uint8_t stage, tusb_control_request_t const* req) {
  if (stage == CONTROL_STAGE_SETUP) {
    g_msosClaimed = false;
    bool vendorIn = req->bmRequestType_bit.type == TUSB_REQ_TYPE_VENDOR &&
                    req->bmRequestType_bit.direction == TUSB_DIR_IN;
    bool ms20 = vendorIn && req->bmRequestType_bit.recipient == TUSB_REQ_RCPT_DEVICE &&
                req->bRequest == VENDOR_REQ_MS && req->wIndex == MSOS20_INDEX && g_ncmItf != 0xFF;
    bool ms10 = vendorIn && req->bmRequestType_bit.recipient == TUSB_REQ_RCPT_DEVICE &&
                req->bRequest == MSOS1_VENDOR && req->wIndex == MSOS1_COMPAT_WINDEX && g_ncmItf != 0xFF;
    if (ms20) {
      static uint8_t msos[MSOS20_XFER_LEN];
      buildMsOs20(msos);
      g_msosClaimed = true;
      return tud_control_xfer(rhport, req, msos, sizeof(msos));
    }
    if (ms10) {
      static uint8_t compat[40];
      buildMsOs1Compat(compat);
      g_msosClaimed = true;
      return tud_control_xfer(rhport, req, compat, sizeof(compat));
    }
    return false;                                                      // 非我方请求 → 交其它驱动
  }
  return g_msosClaimed;
}

// ---------------- NCM 接口描述符 ----------------
static uint16_t sgpNcmDescLoader(uint8_t* dst, uint8_t* itf) {
  // idProduct 现场换成 SGP_NET_PID（复合设备换新 PID）。bcdUSB 保持 hal 的 0x0200：
  // 实测 0x0201 会触发本机 Windows 的 BOS/LPM 协商路径，枚举在 SET_CONFIG 前失败。
#ifndef SGP_NET_NOPATCH
#define SGP_NET_NOPATCH 0
#endif
#if !SGP_NET_NOPATCH
  uint8_t* dev = (uint8_t*)tud_descriptor_device_cb();
  if (dev) { dev[10] = SGP_NET_PID & 0xFF; }
#endif

  snprintf(g_macStr, sizeof g_macStr, "%02X%02X%02X%02X%02X%02X",
           g_mac[0], g_mac[1], g_mac[2], g_mac[3], g_mac[4], g_mac[5]);
  uint8_t strIdx = tinyusb_add_string_descriptor("Shougongpai NIC");
  uint8_t macIdx = tinyusb_add_string_descriptor(g_macStr);
  g_ncmItf = *itf;
  uint8_t epN = tinyusb_get_free_in_endpoint();
  uint8_t epD = tinyusb_get_free_duplex_endpoint();
  const uint8_t desc[] = {
    TUD_CDC_NCM_DESCRIPTOR(*itf, strIdx, macIdx,
      (uint8_t)(0x80 | epN), 64,                                        // notif EP 与上游参考一致 64B
      epD, (uint8_t)(0x80 | epD), 64,
      CFG_TUD_NET_MTU, 50,
      (uint8_t)(NCM_NETWORK_CAPS_ETH_FILTER | NCM_NETWORK_CAPS_NTB_INPUT_SIZE))
  };
  memcpy(dst, desc, sizeof desc);
  *itf += 2;                                                            // comm + data 两个接口
  return sizeof desc;
}

// 全局构造函数：早于 main.cpp 的 Serial.begin()→USB.begin()（接口注册只在 init 前有效）
// SGP_NET_DISABLE：二分排障开关——置 1 时不注册 NCM 接口（退回纯 CDC，用于隔离枚举故障域）
#ifndef SGP_NET_DISABLE
#define SGP_NET_DISABLE 0
#endif
__attribute__((constructor)) static void sgpUsbNetCtor() {
  esp_read_mac(g_mac, ESP_MAC_WIFI_STA);
  snprintf(g_usbSerial, sizeof g_usbSerial, "%02X:%02X:%02X:%02X:%02X:%02X",
           g_mac[0], g_mac[1], g_mac[2], g_mac[3], g_mac[4], g_mac[5]);
  g_mac[0] = (g_mac[0] & 0xFC) | 0x02;                                  // 本地管理位 + 单播
  memcpy(tud_network_mac_address, g_mac, 6);
#if !SGP_NET_DISABLE
  tinyusb_enable_interface(USB_INTERFACE_CUSTOM, TUD_CDC_NCM_DESC_LEN, sgpNcmDescLoader);
#endif
}

// ---------------- TinyUSB netd ↔ lwIP netif ----------------
extern "C" bool tud_network_recv_cb(const uint8_t* src, uint16_t size) {
  if (g_netif && src && size && size <= 2000) {
    struct pbuf* p = pbuf_alloc(PBUF_RAW, size, PBUF_POOL);
    if (p) {
      pbuf_take(p, src, size);
      if (g_netif->input(p, g_netif) != ERR_OK) pbuf_free(p);           // tcpip_input → tcpip 线程
    }
  }
  tud_network_recv_renew();
  return true;
}

static void sgpDeferTx(void* arg) {                                     // USB 任务上下文
  struct pbuf* p = (struct pbuf*)arg;
  if (tud_network_can_xmit(p->tot_len)) tud_network_xmit(p, p->tot_len);
  else pbuf_free(p);                                                    // 驱动忙 → 丢（TCP 会重传）
}

static err_t sgpLinkOut(struct netif* nif, struct pbuf* p) {            // tcpip 线程上下文
  pbuf_ref(p);
  usbd_defer_func(sgpDeferTx, p, false);                                // 移交 USB 任务组 NTB
  return ERR_OK;
}

extern "C" uint16_t tud_network_xmit_cb(uint8_t* dst, void* ref, uint16_t arg) {
  struct pbuf* p = (struct pbuf*)ref;
  (void)arg;                                   // 驱动缓冲按 MTU 开：整帧拷贝
  uint16_t n = pbuf_copy_partial(p, dst, p->tot_len, 0);
  pbuf_free(p);
  return n;
}

extern "C" void tud_network_init_cb(void) {}                            // 驱动复位/重开时回调
extern "C" void tud_network_set_packet_filter_cb(uint16_t f) { (void)f; }

static err_t sgpNetifInit(struct netif* nif) {
  nif->name[0] = 'u'; nif->name[1] = 'n';
  nif->hostname = "shougongpai";
  nif->mtu = 1500;
  nif->hwaddr_len = 6;
  memcpy(nif->hwaddr, g_mac, 6);
  nif->flags = NETIF_FLAG_BROADCAST | NETIF_FLAG_ETHARP | NETIF_FLAG_ETHERNET | NETIF_FLAG_IGMP;
  nif->linkoutput = sgpLinkOut;
  nif->output = etharp_output;
  return ERR_OK;
}

// ---------------- TCP:80 → 隧道通道 ----------------
struct NetConn { int fd; SemaphoreHandle_t mtx; TaskHandle_t task; };
static NetConn g_conn[SGP_NET_SLOTS];

static void sgpConnTask(void* arg) {
  const uint8_t slot = (uint8_t)(intptr_t)arg;
  NetConn* c = &g_conn[slot];
  uint8_t buf[224];
  for (;;) {
    int n = recv(c->fd, buf, sizeof buf, 0);
    if (n <= 0) break;
    sgpUsbNetOnRx(slot, buf, (uint16_t)n);                              // 入队 → loopTask 解析
  }
  sgpUsbNetOnClose(slot);                                               // 先告知 loop 收尾
  xSemaphoreTake(c->mtx, portMAX_DELAY);
  close(c->fd); c->fd = -1;
  xSemaphoreGive(c->mtx);
  c->task = NULL;
  vTaskDelete(NULL);
}

static void sgpAcceptTask(void* arg) {
  (void)arg;
  for (int i = 0; i < 100 && !g_netif; i++) vTaskDelay(10);              // 等 tcpip 线程起好 netif
  if (!g_netif) { vTaskDelete(NULL); return; }
  int ls = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (ls < 0) { vTaskDelete(NULL); return; }
  int yes = 1;
  setsockopt(ls, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  struct sockaddr_in sa;
  memset(&sa, 0, sizeof sa);
  sa.sin_family = AF_INET;
  sa.sin_port = htons(80);
  sa.sin_addr.s_addr = g_netif->ip_addr.u_addr.ip4.addr;                // 只绑网卡 IP，不外溢
  if (bind(ls, (struct sockaddr*)&sa, sizeof sa) != 0 || listen(ls, 4) != 0) {
    close(ls); vTaskDelete(NULL); return;
  }
  static const char busy[] = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n";
  for (;;) {
    int fd = accept(ls, NULL, NULL);
    if (fd < 0) continue;
    int slot = -1;
    for (int i = 0; i < SGP_NET_SLOTS; i++)
      if (g_conn[i].fd < 0 && g_conn[i].task == NULL) { slot = i; break; }
    if (slot < 0) { send(fd, (const uint8_t*)busy, sizeof(busy) - 1, 0); close(fd); continue; }
    NetConn* c = &g_conn[slot];
    c->fd = fd;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof yes);
    struct timeval tv = { 0, 300000 };                                  // send 最多卡 300ms（防 host 停摆拖死 loop）
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    xTaskCreate(sgpConnTask, "sgp_conn", 4096, (void*)(intptr_t)slot, 1, &c->task);
  }
}

// netif 的全部操作收拢到 tcpip 线程
static void sgpNetifBringUp(void* arg) {
  static struct netif nif;
  ip4_addr_t ip, nm, gw;
  IP4_ADDR(&ip, 192, 168, 55, 1);
  IP4_ADDR(&nm, 255, 255, 255, 0);
  IP4_ADDR(&gw, 192, 168, 55, 1);
  netif_add(&nif, &ip, &nm, &gw, NULL, sgpNetifInit, tcpip_input);
  g_netif = &nif;
  netif_set_up(&nif);
  netif_set_link_up(&nif);
  dhcps_t* d = dhcps_new();
  if (d) dhcps_start(d, &nif, ip);                                       // 给 host 下发 192.168.55.x
  etharp_gratuitous(&nif);                                               // 宣告 MAC→IP，省一轮 ARP
  if (tud_mounted()) tud_network_link_state(0, true);                    // NCM 链路状态上报 host
}

bool sgpUsbNetSend(uint8_t slot, const uint8_t* data, uint16_t n) {
  if (slot >= SGP_NET_SLOTS) return false;
  NetConn* c = &g_conn[slot];
  bool ok = false;
  xSemaphoreTake(c->mtx, portMAX_DELAY);
  if (c->fd >= 0) {
    ok = true;
    uint16_t off = 0;
    while (off < n) {
      int w = send(c->fd, data + off, n - off, 0);
      if (w <= 0) { ok = false; break; }
      off += w;
    }
  }
  xSemaphoreGive(c->mtx);
  return ok;
}

void sgpUsbNetStart() {
  for (int i = 0; i < SGP_NET_SLOTS; i++) {
    g_conn[i].fd = -1;
    g_conn[i].mtx = xSemaphoreCreateMutex();
  }
  tcpip_callback(sgpNetifBringUp, NULL);
  xTaskCreate(sgpAcceptTask, "sgp_httpd", 3072, NULL, 1, NULL);
  Serial.println("[USBNET] ncm+httpd on 192.168.55.1:80");
}

#else  // CFG_TUD_NCM 未编进库
void sgpUsbNetStart() {}
bool sgpUsbNetSend(uint8_t, const uint8_t*, uint16_t) { return false; }
#endif

#else  // 非 TinyUSB 构建（hwcdc/无 USB）：空实现，ino 照常编译
void sgpUsbNetStart() {}
bool sgpUsbNetSend(uint8_t, const uint8_t*, uint16_t) { return false; }
#endif
