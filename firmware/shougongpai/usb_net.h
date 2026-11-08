// usb_net.h — USB NCM 虚拟网卡（doc/usb-net.md）
// 原生 USB 口上除 CDC 串口外再声明一张 NCM 网卡；Windows 经 MS OS 1.0(WINNCM) 绑定 UsbNcm.sys。
// 设备在 192.168.55.1/24 上起 DHCP 与 TCP:80 HTTP 服务，报文复用现有隧道路由表（CH_NET0.. 通道）。
#pragma once
#include <stdint.h>
#include <stddef.h>

constexpr uint8_t SGP_NET_SLOTS = 3;   // 并发 TCP 连接数

// ino 侧调用（任何构建下都安全，非 TinyUSB 构建为空实现）
void sgpUsbNetStart();                                     // setup 末段调用：起 netif+DHCP+监听
bool sgpUsbNetSend(uint8_t slot, const uint8_t* data, uint16_t n);  // httpWrite 的网卡通道写出

// ino 侧实现（由 usb_net.cpp 的连接任务回调，运行在 socket 任务上下文）
void sgpUsbNetOnRx(uint8_t slot, const uint8_t* data, uint16_t n);  // 收到 TCP 字节 → 入队给 loop 解析
void sgpUsbNetOnClose(uint8_t slot);                                // 连接断开 → 结束该通道订阅/解析态
