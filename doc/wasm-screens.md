# 设备端自定义屏幕（路径 B）：C → WebAssembly → wasm3

> 状态：**可行性已验证**（2026-11-03，ESP32-S3 真机实测）
> 结论：**可以立项**。成本远低于 Busy Bar 的 JerryScript 方案；flash 紧张但不需换芯片。

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
- 与现有按状态帧动画并存：有 wasm 的状态跑程序，没有的播帧动画或默认屏

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

## 后续要做成产品还缺什么

1. **宿主 API 规范**：绘图（线段/矩形/文字/位图）、`on_button`/`on_knob` 事件、状态上下文（当前状态 id、待办数）——即给 Agent 的 C 头文件 + 文档
2. **编译通道**：云端 C→wasm 服务，或本地 Agent 调 clang（`--target=wasm32 -nostdlib`）；网页端"上传 .wasm"
3. **协议**：`app` 消息族（begin/status/size → chunk → run），与 anim 帧协议同构
4. **生命周期**：进入状态加载、切状态停止、运行时销毁、trap 自动恢复默认屏、看门狗超时
5. **分区表调整**（可选）：给 app 存储和固件升级留余量

## 对比参照

- Busy Bar：JerryScript + 设备内 HTTP 服务器 + tar.gz 包管理——重一个数量级（每 app 128–512KB 堆、引擎 200KB+ flash）
- 本方案：wasm3（57KB flash）+ 固定线性内存 + 几 KB 的 wasm 模块——**同能力、低一个量级**
- 现有 anim 帧方案：动画在上传时定格；wasm 方案屏幕可以是活的（按键交互、实时数据）
