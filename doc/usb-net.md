# USB 虚拟网卡（USB-NCM over 原生口）规范

> 状态：已实现并实机验证（`firmware/shougongpai/usb_net.cpp`），TinyUSB 构建下启用。
> 前置：[HARDWARE.md §15](HARDWARE.md) 原生 USB 口实测。

把收工牌的原生 USB 口做成 **CDC + NCM 复合设备**：电脑插线即得一张网卡，拿到
`192.168.55.x` 地址后直接 `http://192.168.55.1/api/*` 访问设备——HTTP/1.1 语义与隧道
完全同一套路由表，只是字节通道换成了 TCP socket，不再需要桥/串口工具。

## 1. 分层

```
HTTP/1.1 请求/响应 + 事件流      ← 与 BLE/串口隧道同一解析器与路由表（tunnel.md）
────────────────────────────────
TCP :80（lwIP socket）           ← 每连接映射一个 CH_NETx 通道
────────────────────────────────
IPv4 192.168.55.0/24 + ARP      ← 设备 = 192.168.55.1，内置 DHCP 给主机发址
────────────────────────────────
以太网帧                         ← 设备 MAC = WiFi MAC 置本地管理位
────────────────────────────────
USB NCM（NTB 批量传输）          ← TinyUSB netd 驱动
────────────────────────────────
原生 USB OTG（GPIO19/20）        ← 与 CH343 串口完全独立的第二条物理通路
```

## 2. USB 设备形态（描述符）

| 项 | 值 | 说明 |
|---|---|---|
| VID / PID | `303A` / **`1003`** | 复合设备身份。`1001` 留给 ROM 下载器/纯 CDC；`1002` 的开发节点曾被早期崩溃版污染，再换新 |
| bcdUSB | **`0x0200`**（hal 默认，不打补丁） | **实测 bcdUSB=0x0201 会让本机 Windows 在 SET_CONFIG 前判 DeviceFailedEnumeration**（BOS/LPM 协商路径）。WINNCM 因此走 MS OS 1.0 通路广播（见 §3），不依赖 BOS |
| 设备类 | MISC/IAD 复合 | `0xEF/0x02/0x01`（hal 默认） |
| itf 0–1 | CDC-ACM | 原 TinyUSB CDC，日志+隧道照旧 |
| itf 2–3 | **CDC-NCM** | comm(IAD)+data(NTB)，`TUD_CDC_NCM_DESCRIPTOR`；中断通知 EP + bulk IN/OUT 各一 |

接口注册走 hal 的 `tinyusb_enable_interface(USB_INTERFACE_CUSTOM, ...)`：
- **必须在 `tinyusb_init` 之前**——`main.cpp` 在 `setup()` 之前就 `Serial.begin()`，
  所以注册放在 `usb_net.cpp` 的全局构造函数里；NCM 接口号由加载回调从 `*itf` 读出。
- 端点经 `tinyusb_get_free_in_endpoint` / `get_free_duplex_endpoint` 动态分配（CDC 已占 in4/in5/out3）。
- `idProduct` 在 NCM 描述符加载回调内现场补丁（`tud_descriptor_device_cb()` 返回的
  `tinyusb_device_descriptor` 上改 `dev[10]`）——避开 ESPUSB setter 的全局构造顺序不确定性。

## 3. Windows 驱动绑定：WINNCM（MS OS 1.0 主通路）

`usbncm.inf`（Win10 1903+）**不按类码绑定**，只认 `USB\MS_COMP_WINNCM`——设备必须通过
Microsoft OS 描述符自报 compatible id `"WINNCM"`。固件备好两条通路：

**通路 A — MS OS 1.0（本机实测走通）**：不依赖 BOS，任何 bcdUSB 都工作。

1. Windows 枚举时请求 string descriptor `0xEE`。固件覆写 weak 回调
   `tud_descriptor_string_cb`，在 `0xEE` 上回 `MSFT100` + vendor code `0x03`；
   其余索引复刻 hal 字符串表（hal 的表是 static，外部够不着，只能整体覆写）。
2. Windows 发 vendor 控制请求 `bRequest=0x03, wIndex=0x0004`（Extended Compat ID，
   device→host）。`tinyusb_vendor_control_request_cb` 应答 40B compat-id 集：
   `bFirstInterfaceNumber = NCM comm itf` + `compatibleID = "WINNCM"`。
3. Windows 得 hwid `USB\MS_COMP_WINNCM` → 绑 `UsbNcm.sys` →
   出现 `USB NCM Host Device`（Class=Net）+ 以太网适配器。

**通路 B — MS OS 2.0（备用，BOS 可用时自动生效）**：

1. 主机若 `bcdUSB≥2.01` 且读 BOS：hal 的 `tud_descriptor_bos_cb` 返回固定 BOS，
   内含 MS OS 2.0 平台能力（vendor code = **2**）。
2. vendor 请求 `bRequest=2, wIndex=7` → 同一弱钩子应答 MS OS 2.0 描述符集
   （Set Header + Function Subset + Compatible ID `"WINNCM"`）。hwid 与通路 A 相同。

> 两条通路产出的 `USB\MS_COMP_WINNCM` 完全一致，绑定同一个 `UsbNcm.sys`。

## 4. IP 面

| 项 | 值 |
|---|---|
| 设备 IP / 掩码 | `192.168.55.1 / 24`（独立网段，不与常见 LAN 冲突） |
| DHCP | esp-lwip `dhcps`：`netif_add` 后在 tcpip 线程 `dhcps_start`，主机自动获址 `192.168.55.x` |
| 监听 | TCP `192.168.55.1:80`（只绑网卡 IP 不外溢），并发槽 `SGP_NET_SLOTS=3`，满时新连接收 `503` |
| MAC | `esp_read_mac(WIFI_STA)` 置本地管理位（`b0|0x02, &~0x01`），与 NCM 描述符 iMACAddress 一致 |
| 宣告 | bring-up 时 `etharp_gratuitous` 发一帧，省主机一轮 ARP |

### 主机获址现状（实机验证记录）

- **设备端 DHCP 服务端已验证**：注入合成 DISCOVER → `dhcps` 解析 → OFFER 经
  lwIP→NCM→主机全程送达（Windows 侧 `ReceivedBytes` 实收）。
- **静态 IP 端到端已验证**：主机配 `192.168.55.2/24` 后 `ping 192.168.55.1` 与
  `curl http://192.168.55.1/api/*` 全通。
- **个别 Windows 主机的 DHCP 客户端可能不在此适配器上发 DISCOVER**（DHCP 已启用、
  绑定正常、重插也不发；疑为机器级怪癖）。**兜底：管理员 PowerShell 执行**
  ```powershell
  New-NetIPAddress -InterfaceIndex <ifIndex> -IPAddress 192.168.55.2 -PrefixLength 24
  ```
  之后 `curl http://192.168.55.1/api/version` 即通。恢复 DHCP：`netsh interface ip set address "<名>" dhcp`。

## 5. 数据面胶水（TinyUSB netd ↔ lwIP netif）

- **RX（主机→设备）**：`tud_network_recv_cb` 拷帧进 `PBUF_RAW` → `netif->input`
  （= `tcpip_input`，投递到 tcpip 线程）→ `tud_network_recv_renew`。
- **TX（设备→主机）**：netif `linkoutput = sgpLinkOut`（tcpip 线程）`pbuf_ref` 后经
  `usbd_defer_func` 移交 USB 任务 → `tud_network_can_xmit`/`tud_network_xmit` →
  驱动回调 `tud_network_xmit_cb` 整帧拷入 NTB（返回 `tot_len`）后 `pbuf_free`。
  驱动忙时丢帧，TCP 层负责重传。
- netif：`un0`，MTU 1500，flags = `BROADCAST|ETHARP|ETHERNET|IGMP`，`output=etharp_output`；
  全部初始化在 `tcpip_callback(sgpNetifBringUp)` 内完成；`tud_network_link_state` 上报链路。

## 6. 通道整合（固件内）

- 通道编号：`CH_NET0 = 2`，`CH_COUNT = 2 + SGP_NET_SLOTS`（0=串口,1=BLE,2+=网卡）。
- **收**：每连接一个 `recv` 任务 → `sgpUsbNetOnRx` 切片入 `netRxQ` → `loopTask` 统一 `httpFeed`。
  与 BLE 同一模型：解析/路由/事件广播永远在 loop 线程单线程执行。
- **发**：`httpWrite(ch>=CH_NET0)` → `sgpUsbNetSend` → `send(fd)`（每槽 mutex，SO_SNDTIMEO 300ms）。
- **事件流**：`GET /api/events` 订阅走 `evSub[ch]`，SSE 帧原样流式下发，无需改动。
- **断连**：`sgpUsbNetOnClose` 置位 → loop 收尾：`evSub[ch].on=false` + `httpRxReset(ch)`（同 `bleDropped` 模型）。

## 7. 构建与烧录

CDC+NIC 复合固件只在 TinyUSB 构建生效（`usb_net.cpp` 内 `#if !ARDUINO_USB_MODE && CFG_TUD_NCM`）：

```
<板型 FQBN>:USBMode=default,CDCOnBoot=cdc,FlashSize=16M,PSRAM=opi,PartitionScheme=esp_sr_16
```

- **一根线即可完成烧录**：原生口 CDC 置 1200 波特触发下载模式（`USBCDC` 内置 esptool
  兼容复位），原生口随即回落为 `VID_303A&PID_1001` ROM 引导器，esptool 直刷；刷完自动
  复位回应用态。无需再碰 CH343 口，也无需按 BOOT/RST 键。脚本：`bridge/cdc-1200-touch.ps1`
  + `bridge/find-serial-paths.ps1`。
- 原生口应用态下：`Serial`（CDC）= 日志+隧道；NCM = 网卡，互不干扰。

## 8. 客户端用法

```powershell
curl.exe http://192.168.55.1/api/version
curl.exe http://192.168.55.1/api/state
curl.exe -X PUT http://192.168.55.1/api/state -H "Content-Type: application/json" -d "{...}"
curl.exe -N http://192.168.55.1/api/events     # SSE 事件流
```

与串口隧道差异：TCP 无杂散日志字节、无 DTR 门控、X-Request-Id 语义不变；`503` 仅在并发槽满时出现。

## 9. 排错

| 现象 | 检查 |
|---|---|
| 设备管理器只见串口、无网卡 | string `0xEE` 是否应答 `MSFT100`；`g_ncmItf` 是否已赋值；bcdUSB 是否被打成 0x0201（本机实测会枚举失败，见 §2） |
| `USB NCM Host Device` 出现但报黄叹号 | compat-id 的 `bFirstInterfaceNumber` 是否指向 NCM comm itf |
| 网卡在但没 IPv4 | 先确认是主机 DHCP 客户端没发包（抓包/`Get-NetAdapterStatistics`），服务端用注入法验证；兜底配静态 `192.168.55.2/24`（§4） |
| ping 不通 `.1` | `arp -a` 是否有设备 MAC；netif link 是否 up |
| curl 503 | 并发槽（3）占满——关掉旧连接或重启设备 |

Windows 上串口侧注意：复合设备换 PID 后 CDC 会按新身份重新绑定（§2）；CDC 设备路径用
`bridge/find-serial-paths.ps1` 查（本机 usbser 不分配 COM 号，须走 `\\?\usb#...` 设备路径）。
