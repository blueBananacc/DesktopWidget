# 设备端自定义屏幕（路径 B）：C/WAT → WebAssembly → wasm3

> 状态：**已实现**（2026-11-03；可行性验证 + 完整落地，替代原"JS→帧上传"方案）
> 结论：wasm3 沙箱按状态执行 .wasm 屏幕 app，成本远低于 Busy Bar 的 JerryScript 方案。

## 方案

```
Agent/用户按宿主 API 规范写的 C 代码
        ↓ clang/emscripten 编译（云端服务或本地工具链）
.wasm 模块（实测弹跳小球 = 228 字节，典型 < 50KB）
        ↓ BLE/串口上传 → LittleFS /app_<status>.wasm
固件内 wasm3 加载执行 → 调宿主函数控制屏幕/读按键
```

- wasm3 是**解释器沙箱**：用户代码崩溃 = wasm trap，不会砖设备；线性内存有固定上限
- 设备端跑的是编译产物，不解析源码——保持"设备不执行用户文本代码"的安全边界
- 有 wasm 的状态跑程序，没有的显示默认屏（帧动画方案已移除）

## 实测数据（ESP32-S3，真机）

| 项 | 数值 | 说明 |
|---|---|---|
| wasm3 引擎 flash | **+57KB** | 基线（core+Wire+u8g2）349,612B → +wasm3 406,716B |
| 合并进主固件预估 | 1,256KB / 1,310KB（≈96%） | 不需要换芯片；更宽裕需调分区表（8MB flash 有空间） |
| 运行时堆占用 | **~23KB** | env + 16KB wasm 栈/线性内存 + 模块；对比 Busy Bar 每 app 128–512KB JS 堆 |
| 静态 RAM 增量 | +184B | 可忽略 |
| wasm 模块大小 | **228B**（弹跳小球） | LittleFS 轻松存几十个 app |

真机行为：`wasmtest.ino` 烧录后无 trap 报错，`run()` 每帧执行，OLED 上小球弹跳（用户目测确认）。

## 验证用的最小宿主 API（已跑通）

| import | 签名 | 语义 |
|---|---|---|
| `env.clear` | `v()` | 清帧缓冲 |
| `env.show` | `v()` | 帧缓冲刷上 OLED |
| `env.px` | `v(ii)` | 置像素（越界裁剪） |
| `env.millis` | `i()` | 设备毫秒计数 |

测试草图：`code/firmware/wasmtest/`（wasm 以 C 数组内嵌；后续走 LittleFS）。
测试 wat 源与构建脚本：`ball.wat` → `wabt` 编译（228B）。

## 落地实现（v2，已替代帧方案）

- **宿主 API v1**：`clear / show / px / rect / text / millis / buttons / status`（见 `code/website/doc/display-app-spec.md`）
- **协议**：`app` 消息族 `begin{status,size} → chunk{base64}×N → run / stop / clear{status}`（`doc/device-protocol.md`）
- **存储**：LittleFS `/app_<status>.wasm`，≤48KB，断电不丢；状态切换自动加载
- **安全**：trap→卸载回默认屏；死循环→TWDT 复位→文件改名 `.bad` 防 bootloop
- **网页端**：WAT 编辑器（wabt 客户端编译）+ WebAssembly 实例化预览（按键 1-4 模拟 K1-K4）+ .wasm 文件上传
- **固件占用**：编译后 97% flash（1,277,349/1,310,720）、12% RAM——紧但装得下；后续扩容需调分区表

## 屏幕内容页优化（固件 v0.5.0，2026-11-04）

页面按"真实设备能力"重排，不再展示固件做不到的东西：

- **各状态屏幕总览**：6 个状态的 128×64 画布缩略图——有程序就跑真实 wasm，没有就按固件 `drawOled` 坐标/字号画默认屏（浏览器字体近似）；每格标注来源（默认 / 已装到设备 / 未上传 / 有改动未上传 / 设备上有但本机无源码 / 已被禁用）和"当前"状态
- **默认屏布局**：旧的"大字/状态+时间/极简"三选项固件从未实现（纯网页假象），改为固件真实支持的 `full / clock / status`，经 `state.layout` 下发并存 LittleFS `/layout`
- **以设备为准的安装状态**：固件新增 `apps` 清单上报（hello / run / clear / list 后）与 `appErr`（trap/加载失败）；`clear` 同时删 `.bad`，`begin` 解除禁用，不完整上传删除半截文件。设备只报大小，网页本机记录最近一次上传的二进制指纹（FNV-1a，localStorage `shougongpai.screenDeployed`）识别同体积改动
- **编辑器**：预览左（可点按/按住的虚拟 K1–K4、体积条、设备安装情况）+ 代码右；停手 450ms 自动重编译预览；预览 `status()` 返回所选状态下标（与固件 STATUSES 顺序一致）；空状态直接给模板卡片
- **速查与规则**：宿主 API 表（与模板注释同源 `HOST_API`）+「复制给 Agent」一键生成提示词；运行规则卡（离线运行、trap 回默认、卡死禁用、提醒优先、烧屏）
- **修复**：wabt 对 JS string 用 `writeAsciiToMemory`，中文注释被截成单字节乱码导致编译失败——改为传 UTF-8 字节；模板改为 `(memory (export "memory") 1)`，否则预览读不到 `text()` 字符串
- **固件默认文案**与网页 `STATUSES.hint` 对齐（离线时设备说明行与网页一致）；固件 +2.4KB，仍为 97%

## 对比参照

- Busy Bar：JerryScript + 设备内 HTTP 服务器 + tar.gz 包管理——重一个数量级（每 app 128–512KB 堆、引擎 200KB+ flash）
- 本方案：wasm3（57KB flash）+ 固定线性内存 + 几 KB 的 wasm 模块——**同能力、低一个量级**
- 现有 anim 帧方案：动画在上传时定格；wasm 方案屏幕可以是活的（按键交互、实时数据）
