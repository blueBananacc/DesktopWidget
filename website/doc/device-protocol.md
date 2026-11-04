# 网页 ⇄ 设备通信

代码在 `src/device/`：

- `protocol.ts`：`DeviceTransport` 接口、`OutboundMessage` / `InboundMessage` 消息类型、BLE UUID 常量
- `mockTransport.ts`：模拟设备，可触发触摸区 / 快捷键 / 收工键 / 旋钮输入
- `bleTransport.ts`：Web Bluetooth 实现

## 协议草案（固件已实现，与 `../firmware/shougongpai` 对齐）

- JSON 文本消息，`\n` 分帧；串口波特率 **460800**（v0.6 起，音频帧流带宽所需）
- BLE 下单条按 180 字节分包（`bleTransport.ts` 的 `CHUNK`）；固件按行重组。**双向都需要分片**：v0.7 起固件 `sendLine` 对超 200B 的上行消息也按 200B 分片 notify（agentReq/appData 等长消息不再被 MTU 截断）
- 自定义状态（v0.9 起）：状态可扩展——6 个内建之外，设备 LittleFS `/stdefs.json` 存自定义状态注册表（≤8 个：`{id,zh,hint?,c,work?}`，id ≤7 字符以 c 开头网页生成或设备分配 c<N>，zh=屏显名 wqy16 大字，c=0xRRGGBB 网页与 RGB 灯共用，work=计入工作时长/休息提醒）。下行 `stdef{op:"set"{id?,zh,hint?,c,work?}|"del"{id}|"list"}`；上行 `stdefs{list}` hello 后与每次 op 后推送、`stdefErr{msg:"full"}`；del 连带清除该状态的 /app_<id>.wasm(.bad) 并回报 apps，正在使用则退回 work。**自定义状态全链路可用**：默认屏显示 zh/hint、RGB 用注册色、按键/触摸可绑定、计划表节点可引用、status() host API 返回 6+注册序号、设备按键循环包含自定义（off 仍除外）、agent status_set 可切；**状态注册表事实源在设备**（v1.0 起）：网页 `customStatuses` 只是 `stdefs` 快照的会话镜像，不持久化；新建/编辑/删除都需连接——下发 stdef set/del 后等快照整表替换镜像。断连时页面保留上次镜像作只读参考，状态名下拉/历史仍可用（名字缓存兜底）。**删掉自定义状态后**：引用它的计划表不可启用——`sched use` 返回 `schedErr{badStatus}`、已在生效表的对应节点到点跳过不切状态（节点保留，重新注册同名 id 或修正后恢复）；区间记录里残留的该 id 在网页按名字缓存继续显示原名/原色（历史是记录不随定义删除）
- 设备端 Agent（v0.7 起）：网页 ASR 完成后发 `sttResult{text}` → 设备跑最小 agent 循环（system 提示词含当前时间/状态 + user 转写文本 → `agentReq` 携带 msgs+工具 schema → 网页用已配置 LLM 代理调用 → `agentRes` 回传 assistant 消息 → 设备执行 tool_calls（reminder_add/reminder_list/status_get/status_set）回填后最多 4 轮、每轮 30s 超时、断连中止）；下行新增 `sttResult{text}` / `agentRes{message}` / `agent{op:"cancel"}`；设备待办下行 `todo{op:add{text,at?,trig?,show?,src?}|set{id,text?,at?,trig?,show?,done?}|done{id,done?}|del{id}|clear|list}`（`trig:"offwork"`=收工后触发；`at`=绝对 epoch ms；`show`=正文可否上 OLED 屏，缺省可上；`src`=web|voice|…）；agent 等回复时 OLED 显示"AI 思考中"、RGB 紫色呼吸，回复上屏 8s
- 语音转文字（v0.6 起）：网页发 `stt{op:start|stop}` → 设备 I2S 采音（INMP441，16kHz）→ IMA-ADPCM 逐帧上行 `aud` → 网页 `src/device/audio.ts` 解码拼 WAV → POST 到用户配置的 ASR 端点（OpenAI 兼容 `/audio/transcriptions`）显示文本；录音 60s 自动收尾、BLE 断线即停；音频不上设备文件系统、网页不保存原始录音
- **UUID 已正式启用**（`protocol.ts` 底部三个 NUS 风格 UUID，固件同款）；设备广播名 `Shougong-A1`，前缀 `Shougong`
- 上行（设备→网页）：hello（客户端订阅 TX 后发）/ touch(left|right) / shortcut(single|long) / offworkKey / enc{dir}（旋钮步进：S2 未接时单相兜底、按住 KEY 转=反向；S2 接回自动双相）/ knob（暂留）/ sttState{state:recording|idle|error,rate,codec,ms,msg?}（v0.6 起：录音状态回报）/ aud{seq,data}（v0.6 起：IMA-ADPCM 音频帧 base64，16kHz 单声道，~68 帧/秒；帧自洽 [pred:int16LE,stepIdx:u8,nibbles]，丢帧只留缺口）/ breakState（休息提醒计时镜像：minutes+accumMs+enabled+offToday+due，连接后、每 10s、到点各发一次）/ wantTime（设备未校时请求 time）/ segments{phase:begin|end} + seg{status,start,end?}（今日状态区间全量推送：连接后、状态变化 ~2s 内、每 10 分钟兜底）/ apps{list:[{status,size,bad?}]}（**v0.5.0 起**：设备 LittleFS 里实际安装的自定义屏幕；hello 后、app run/clear/list 后上报；bad=曾导致复位已被禁用；网页「屏幕内容」以此显示"已装到设备/未上传/已禁用"，旧固件不发则网页显示"无法核对"）/ appErr{status,msg}（v0.5.0 起：app trap 或加载失败，设备已回默认屏）/ appData{status,seq,last,data|missing}（v0.5.0 起：对 dump 的应答，把设备上的 .wasm 按 768B 原始分片 base64 逐行回传，seq 从 0 递增、last 收尾；文件不存在则 last+missing 无 data；网页收到 apps 清单里有而本机没有源码的程序时主动 dump 取回，按真实二进制渲染缩略图）/ agentReq{round,msgs,tools}（**v0.7 起**：设备端 agent 循环请求网页代理调 LLM——msgs=OpenAI 消息数组、tools=function schema；网页回 agentRes）/ agentDone{text}（v0.7 起：agent 循环结束，最终回复；OLED 同步上屏 8s）/ agentErr{msg}（v0.7 起：agent 中止——timeout/disconnected/cancelled/bad_response/busy）/ todos{list:[{id,at?,trig?,show?,created,src,done}]}（**v0.7 起：设备待办事实源**——网页整表替换镜像含空表；待办页=这份清单的视图，增删改全下发设备执行、断连只读；at/created 为绝对 epoch（tz 仅用于"今天 HH:MM"解析与跨天）；跨天清已完成、id 单调不复用；todoFired{ids,count}=待办真实触发事件——定时到点或进入 off 收工触发，网页据此弹 toast————LittleFS `/todos.json` ≤16 条；hello 后、增删改、到点触发后推送；at=epoch ms，缺省=无定时清单项）/ schedules{act,paused,mode,list}（v0.8 起：计划表事实源在设备 `/schedules.json`，hello 后与每次 sched op 后推送整表，网页整表替换镜像）/ stdefs{list}（v0.9 起：自定义状态注册表事实源在设备 `/stdefs.json`，hello 后与每次 stdef op 后推送整表）/ keys{k1,k2,k3,k4}（**v1.0 起：按键映射事实源**——设备 `/keys.json` 持久化，hello 后与每次 keys 写入后推送整组）/ led{map,br,night}（**v1.0 起：灯效设置事实源**——设备 `/led.json` 持久化：map=每状态档位 solid|breath|off、br=亮度 0–100、night=22:00–07:00 自动关灯；hello 后与每次 led 写入后推送整表）
- 下行（网页→设备）：state（status+screen+sub+layout，led/brightness 0–100 可选——v1.0 起灯效设置事实源在设备 `/led.json`，字段缺失时设备按本地持久配置出光、携带则仅当次覆盖显示不回写；layout=full|clock|status 只作用于默认屏——full=连接点+时钟+状态+说明，clock=去掉说明行、状态字下移居中，status=只显示状态字；提醒/休息画面不受影响；v0.5.0 起设备存 LittleFS `/layout`，重启保留）/ sched{op:"set"{id?,name,kind:repeat|date,wd?:[0-6],date?,ns:[{t:HH:MM,st,n?:备注}]≤20}|"del"{id}|"use"{id}|"pause"{paused}|"mode"{next|today}|"list"}（**计划表事实源在设备 `/schedules.json`**（v1.0 起）：≤8 张计划表+执行态全部存设备，网页只是镜像/编辑器——全部 sched 操作（含新建编辑复制删除）需连接后下发，快照整表替换镜像、无增量合并；设备自行推导今日生效表——单日计划(date=今天)优先，其次 act 指定的重复计划按星期位；paused=今日暂停日编号跨天自动失效；mode=手动干预恢复——next=挂起到下个节点，today=今日暂停；**今天进入过 off 即视今日计划完成，后续节点作废**；use 仅对 repeat 生效，含已删状态的表 use 返回 schedErr{badStatus}、生效中遇失效节点到点跳过；删掉 act 表则不再启用任何表；节点上限 20/表；上行 `schedules{act,paused,mode,list}` hello 后与每次 op 后推送整表；旧版 `schedule` 编译下发消息已废除）/ time（epoch ms + tzOffsetMin，驱动 OLED 时钟与计划表；设备需先校时一次，之后不断电即可断连自治）/ break（minutes+enabled+offToday，可选 accumMs；仅用户操作时发送，连接快照不携带）/ keys（k1–k4 动作映射：offwork/focus25/pauseToday/状态 id；v1.0 起设备写 `/keys.json` 断电保留并回 keys 快照；设备离线时按键按此执行，连接时按键只上报事件由网页 runKey 统一处理）/ led{op:"set",map?,br?,night?}（**v1.0 起**：灯效写入设备 `/led.json`——map=每状态档位、br=亮度、night=夜间自动关，缺省字段保持原值；设备保存后回 led 快照，网页镜像随之校准；连接快照不主动携带 led，避免网页旧值覆盖设备真值）/ reminder（网页待办到点/收工后触发时下发：text 仅当用户允许上屏才携带正文，否则只给 count；设备 OLED 显示"有新待办+正文/有 N 条待办"15s + RGB 状态色 4Hz 闪烁 3s，任意按键提前关闭）/ app（按状态自定义屏幕，v0.6 起 WASM 方案：op=begin{status,size} → op=chunk{base64 数据分片}×N → op=run（收齐落盘；上传的是当前状态则立即重载执行；不完整则删除半截文件）/ op=stop / op=clear{status}（同时删除 .bad）/ op=list（回 apps）/ op=dump{status}（回传该状态的 .wasm：appData 分片流）；begin 会清掉该状态的 .bad（重新上传 = 解除禁用）；.wasm 写 LittleFS `/app_<status>.wasm`（≤48KB），断电/断连不丢，进入该状态由 wasm3 沙箱执行（宿主 API：clear/show/px/rect/text/millis/buttons/status，~30fps 调 run()），没有该文件则显示默认状态屏；trap→卸载回默认屏，死循环→看门狗复位后文件改名 .bad 禁用；remind/break 通知临时覆盖；按键可通过 buttons() 被 app 读取做交互）

## 设备端事件映射（固件 v0.1）

| 输入 | 上报事件 | 网页响应 |
|---|---|---|
| K1 收工键（**按住 1.5s 才触发**，松早了取消；离线同规则） | `offworkKey` | 触发收工流程 |
| K2 快捷键 短按/长按 | `shortcut` | 按设置切换状态/启动专注 25′ |
| K3 / K4（暂代触摸区） | `touch` left / right | 切到 touchLeft / touchRight 状态 |
| 电容触摸 GPIO13/14 | 同 touch（`ENABLE_CAPSENSE=1` 后启用） | 同上 |
| 网页为状态大脑：设备只报事件，显示文本由 `state.screen/sub` 决定；未连接时按键按 `/keys.json` 里持久化的映射本地执行（出厂默认 K1=收工、K2=请勿打扰、K3/K4=状态循环），其中 pauseToday 直接切换本地 schedPausedLocal |

## 休息提醒（固件 v0.2 起设备自治）

- 设备按当前状态自行累计工作类时长（work/busy/focus；meet/rest/off 自动暂停），到点：`accumMs` 清零进入下一轮 + RGB 状态色 4Hz 闪烁 3s + OLED 显示"起来活动一下"15s（任意按键提前关闭）+ 上报 `breakState{due:true}`
- 跨天自动清零（用已校时的 epoch 判断日期变化）；`offToday` 由网页下发，午夜后自动恢复
- 职责分工：**设备是唯一事实来源**——间隔、开关、今日停用、累计值、到点全部以设备为准，网页通过 `breakState`（连接后 + 每 10s + 到点）采纳设备全部字段；用户在网页改设置时发 `break` 消息（设备应用后回执 `breakState`），连接快照不下发 break；网页在两次心跳间本地累加做平滑显示

## 状态时长记录（固件 v0.3 起设备记录）

- 设备常插电视为常驻在线：自开机起记录今日状态区间（上限 96 段），跨天清零开新段；时间戳存 millis，推送时按 `time` 校时基准换算 epoch（校时前不开推）
- 推送时机：收到 `sync` 握手 / 本地状态变化（2s 内合并）/ 每 10 分钟兜底
- 网页收到 `segments{end}` 后**整表替换** `segments` 与 `current`（source=`device`），最后一段即当前状态；`off` 段会使 `offworkToday` 置位；网页断连期间的本地改动被覆盖
- **连接握手顺序（设备为准）**：网页连接后挂监听发 `sync`，设备 hello 后连发 `breakState → apps → todos → schedules → stdefs → keys → led → seg` 全量事实——网页据此整表替换各处镜像；**不先发 state**；等设备推完 `segments`、网页采纳其末段状态后，才恢复在快照中携带 `state`（同状态不切段，只同步屏幕配置）。采纳完成前网页侧的本地状态变更不会下发设备，避免网页旧状态覆盖设备当前状态
- 注意：手动收工要求设备连接（见 Overview 收工卡片）；设备记录的区间在断电后丢失（NVS 持久化属后续工作）

## 接入约束

- Web Bluetooth 需 HTTPS 或 localhost、Chrome/Edge、用户手势触发；iOS Safari 不可用
- 换传输方式只需实现 `DeviceTransport`，页面不感知
- **网页无法直接收 ESP-NOW**：同区域设备互见需指定网关设备转发到 BLE 或 Wi-Fi/MQTT 服务端
- 网页做不到、App 才能做的：手机静音联动、iOS 后台 BLE、系统日历访问、关页后的可靠提醒
