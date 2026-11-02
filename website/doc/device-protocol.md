# 网页 ⇄ 设备通信

代码在 `src/device/`：

- `protocol.ts`：`DeviceTransport` 接口、`OutboundMessage` / `InboundMessage` 消息类型、BLE UUID 常量
- `mockTransport.ts`：模拟设备，可触发触摸区 / 快捷键 / 收工键 / 旋钮输入
- `bleTransport.ts`：Web Bluetooth 实现

## 协议草案（固件已实现，与 `../firmware/shougongpai` 对齐）

- JSON 文本消息，`\n` 分帧
- BLE 下单条按 180 字节分包（`bleTransport.ts` 的 `CHUNK`）；固件按行重组
- **UUID 已正式启用**（`protocol.ts` 底部三个 NUS 风格 UUID，固件同款）；设备广播名 `Shougong-A1`，前缀 `Shougong`
- 上行（设备→网页）：hello（客户端订阅 TX 后发）/ touch(left|right) / shortcut(single|long) / offworkKey / knob（暂留）/ breakState（休息提醒计时镜像：minutes+accumMs+enabled+offToday+due，连接后、每 10s、到点各发一次）/ wantTime（设备未校时请求 time）/ segments{phase:begin|end} + seg{status,start,end?}（今日状态区间全量推送：连接后、状态变化 ~2s 内、每 10 分钟兜底）
- 下行（网页→设备）：state（status+screen+sub+led+brightness 0–100）/ schedule（固件 v0.1 暂不处理）/ time（epoch ms + tzOffsetMin，驱动 OLED 时钟）/ break（minutes+enabled+offToday，可选 accumMs；仅用户操作时发送，连接快照不携带）

## 设备端事件映射（固件 v0.1）

| 输入 | 上报事件 | 网页响应 |
|---|---|---|
| K1 收工键 | `offworkKey` | 触发收工流程 |
| K2 快捷键 短按/长按 | `shortcut` | 按设置切换状态/启动专注 25′ |
| K3 / K4（暂代触摸区） | `touch` left / right | 切到 touchLeft / touchRight 状态 |
| 电容触摸 GPIO13/14 | 同 touch（`ENABLE_CAPSENSE=1` 后启用） | 同上 |
| 网页为状态大脑：设备只报事件，显示文本由 `state.screen/sub` 决定；未连接时按键仅本地演示 |

## 休息提醒（固件 v0.2 起设备自治）

- 设备按当前状态自行累计工作类时长（work/busy/focus；meet/rest/off 自动暂停），到点：`accumMs` 清零进入下一轮 + RGB 状态色 4Hz 闪烁 3s + OLED 显示"起来活动一下"15s（任意按键提前关闭）+ 上报 `breakState{due:true}`
- 跨天自动清零（用已校时的 epoch 判断日期变化）；`offToday` 由网页下发，午夜后自动恢复
- 职责分工：**设备是唯一事实来源**——间隔、开关、今日停用、累计值、到点全部以设备为准，网页通过 `breakState`（连接后 + 每 10s + 到点）采纳设备全部字段；用户在网页改设置时发 `break` 消息（设备应用后回执 `breakState`），连接快照不下发 break；网页在两次心跳间本地累加做平滑显示

## 状态时长记录（固件 v0.3 起设备记录）

- 设备常插电视为常驻在线：自开机起记录今日状态区间（上限 96 段），跨天清零开新段；时间戳存 millis，推送时按 `time` 校时基准换算 epoch（校时前不开推）
- 推送时机：收到 `sync` 握手 / 本地状态变化（2s 内合并）/ 每 10 分钟兜底
- 网页收到 `segments{end}` 后**整表替换** `segments` 与 `current`（source=`device`），最后一段即当前状态；`off` 段会使 `offworkToday` 置位；网页断连期间的本地改动被覆盖
- 注意：手动收工要求设备连接（见 Overview 收工卡片）；设备记录的区间在断电后丢失（NVS 持久化属后续工作）

## 接入约束

- Web Bluetooth 需 HTTPS 或 localhost、Chrome/Edge、用户手势触发；iOS Safari 不可用
- 换传输方式只需实现 `DeviceTransport`，页面不感知
- **网页无法直接收 ESP-NOW**：同区域设备互见需指定网关设备转发到 BLE 或 Wi-Fi/MQTT 服务端
- 网页做不到、App 才能做的：手机静音联动、iOS 后台 BLE、系统日历访问、关页后的可靠提醒
