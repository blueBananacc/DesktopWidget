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
- 下行（网页→设备）：state（status+screen+sub+led+brightness 0–100）/ schedule（**设备自治执行，v0.4.0 起**：kind=repeat 按 weekdays / kind=date 按单日；nodes={time,status} 最多 32 个；override=当天单日计划覆盖主表；paused=网页今日暂停；mode=next|today 为手动干预恢复策略——next=手动切状态挂起到下个节点，today=手动切状态即今日暂停；**今天进入过 off 即视今日计划完成，后续所有节点作废**，手动切回工作/其他状态不受影响且正常记录；跨天全部重置）/ time（epoch ms + tzOffsetMin，驱动 OLED 时钟与计划表；设备需先校时一次，之后不断电即可断连自治）/ break（minutes+enabled+offToday，可选 accumMs；仅用户操作时发送，连接快照不携带）/ keys（k1–k4 动作映射：offwork/focus25/pauseToday/状态 id；设备离线时按键按此执行，连接时按键只上报事件由网页 runKey 统一处理）/ reminder（网页待办到点/收工后触发时下发：text 仅当用户允许上屏才携带正文，否则只给 count；设备 OLED 显示"有新待办+正文/有 N 条待办"15s + RGB 状态色 4Hz 闪烁 3s，任意按键提前关闭）/ anim（按状态自定义屏幕，v0.5 起：op=begin{status,frames,fps,loop} → op=frame{i, base64(u8g2 页序 1bpp, 1024B)}×N → op=play（收齐落盘，上传的是当前状态则立即播）/ op=stop / op=clear{status}；帧写 LittleFS `/anim_<status>.bin`（4B 头 + N×1024B），断电/断连不丢，每次进入该状态自动加载播放，没有该文件则显示默认状态屏；上限 16 帧，任意按键退出，remind/break 通知临时覆盖）

## 设备端事件映射（固件 v0.1）

| 输入 | 上报事件 | 网页响应 |
|---|---|---|
| K1 收工键（**按住 1.5s 才触发**，松早了取消；离线同规则） | `offworkKey` | 触发收工流程 |
| K2 快捷键 短按/长按 | `shortcut` | 按设置切换状态/启动专注 25′ |
| K3 / K4（暂代触摸区） | `touch` left / right | 切到 touchLeft / touchRight 状态 |
| 电容触摸 GPIO13/14 | 同 touch（`ENABLE_CAPSENSE=1` 后启用） | 同上 |
| 网页为状态大脑：设备只报事件，显示文本由 `state.screen/sub` 决定；未连接时按键按最近一次下发的 keys 映射本地执行（出厂默认 K1=收工、K2=请勿打扰、K3/K4=状态循环），其中 pauseToday 直接切换本地 schedPausedLocal |

## 休息提醒（固件 v0.2 起设备自治）

- 设备按当前状态自行累计工作类时长（work/busy/focus；meet/rest/off 自动暂停），到点：`accumMs` 清零进入下一轮 + RGB 状态色 4Hz 闪烁 3s + OLED 显示"起来活动一下"15s（任意按键提前关闭）+ 上报 `breakState{due:true}`
- 跨天自动清零（用已校时的 epoch 判断日期变化）；`offToday` 由网页下发，午夜后自动恢复
- 职责分工：**设备是唯一事实来源**——间隔、开关、今日停用、累计值、到点全部以设备为准，网页通过 `breakState`（连接后 + 每 10s + 到点）采纳设备全部字段；用户在网页改设置时发 `break` 消息（设备应用后回执 `breakState`），连接快照不下发 break；网页在两次心跳间本地累加做平滑显示

## 状态时长记录（固件 v0.3 起设备记录）

- 设备常插电视为常驻在线：自开机起记录今日状态区间（上限 96 段），跨天清零开新段；时间戳存 millis，推送时按 `time` 校时基准换算 epoch（校时前不开推）
- 推送时机：收到 `sync` 握手 / 本地状态变化（2s 内合并）/ 每 10 分钟兜底
- 网页收到 `segments{end}` 后**整表替换** `segments` 与 `current`（source=`device`），最后一段即当前状态；`off` 段会使 `offworkToday` 置位；网页断连期间的本地改动被覆盖
- **连接握手顺序（设备为准）**：网页连接后先挂监听再下发 time/schedule/keys 配置，**不先发 state**；等设备推完 `segments`、网页采纳其末段状态后，才恢复在快照中携带 `state`（同状态不切段，只同步屏幕/灯光配置）。采纳完成前网页侧的本地状态变更不会下发设备，避免网页旧状态覆盖设备当前状态
- 注意：手动收工要求设备连接（见 Overview 收工卡片）；设备记录的区间在断电后丢失（NVS 持久化属后续工作）

## 接入约束

- Web Bluetooth 需 HTTPS 或 localhost、Chrome/Edge、用户手势触发；iOS Safari 不可用
- 换传输方式只需实现 `DeviceTransport`，页面不感知
- **网页无法直接收 ESP-NOW**：同区域设备互见需指定网关设备转发到 BLE 或 Wi-Fi/MQTT 服务端
- 网页做不到、App 才能做的：手机静音联动、iOS 后台 BLE、系统日历访问、关页后的可靠提醒
