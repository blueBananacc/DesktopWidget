# 收工牌屏幕 App 规范（WASM）v2

> 把这份文档和想要的图案/描述一起发给 Agent，让它产出可粘贴到「屏幕内容 → 按状态自定义屏幕」
> 编辑器的 **WAT** 源码，或一个编译好的 **.wasm** 文件。
> 设备端 wasm3 沙箱执行这份代码：写错了最多 wasm trap 回默认屏，弄不坏设备。

## 屏幕

- **128 × 64 像素，单色**（每像素只有亮/灭，无灰度、无彩色）
- 原点 (0,0) 在左上角；x 向右 0–127，y 向下 0–63
- 小屏建议：文字 ≥ 10px，元素之间留 2px+ 间隙，避免大面积填充

## 程序模型

```wat
(module
  ;; 需要哪个宿主函数就 import 哪个
  (import "env" "clear" (func $clear))
  (import "env" "show"  (func $show))
  (memory (export "memory") 1)
  (func $run (export "run")
    call $clear
    ;; …本帧的绘制…
    call $show))
```

- 必须导出 **`run()`**（无参无返回）。固件每 ~33ms 调用一次（≈30fps）
- 每帧自己 `clear()` → 绘制 → `show()`；不画的东西不会残留，但也不保证残留
- **没有帧号参数**：动画节奏用 `millis()` 自取（比如 `millis()/125` 当 tick）
- `run()` 里**不要写长循环**——它每帧都被调用，超时由设备任务看门狗兜底（复位后该 app 被禁用）
- 需要内存（字符串、位图、数组）就 `(memory (export "memory") 1)` + `(data (i32.const N) "...")`；最多 64KB
- **内存必须导出为 `memory`**：设备不要求，但网页预览要靠它读 `text()` 的字符串；没导出时预览会报错提示

## 宿主 API（import "env.*"）

| 函数 | 签名 | 语义 |
|---|---|---|
| `clear` | `()` | 清整个帧缓冲（每帧开头调用） |
| `show` | `()` | 帧缓冲刷上 OLED（每帧结尾调用） |
| `px` | `(i32 x, i32 y)` | 置一个像素为亮（越界自动裁剪，无"灭"——先 clear 再画） |
| `rect` | `(i32 x, i32 y, i32 w, i32 h, i32 fill)` | 矩形；fill≠0 实心，=0 描边 |
| `text` | `(i32 x, i32 y, i32 ptr, i32 len)` | 6×10 ASCII 字体；从线性内存 ptr 读 len 字节；y 是基线（约+8 可视） |
| `millis` | `() -> i32` | 设备毫秒计数（动画时钟） |
| `buttons` | `() -> i32` | K1-K4 按下位掩码：bit0=K1(收工键) bit1=K2 bit2=K3 bit3=K4 |
| `status` | `() -> i32` | 当前状态下标：0=work 1=busy 2=focus 3=meet 4=rest 5=off |
| `clock` | `() -> i32` | 本地时钟：今日已过分钟数 0–1439（/60=小时、%60=分钟）；设备未校时返回 -1 |
| `segSec` | `() -> i32` | 当前状态已持续的秒数（millis 域，未校时也可用；做状态计时用） |
| `nodeMin` | `() -> i32` | 距今日下个计划节点的分钟数；-1=无节点/今日暂停/已收工/未校时（"会议还 X 分钟结束"） |

## 示例

### 滚动字幕（text + 数据段）

```wat
(module
  (import "env" "clear"  (func $clear))
  (import "env" "show"   (func $show))
  (import "env" "text"   (func $text (param i32 i32 i32 i32)))
  (import "env" "millis" (func $millis (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 16) "GET OFF WORK!")          ;; 13 字节
  (func $run (export "run")
    (local $x i32)
    call $clear
    (local.set $x (i32.sub (i32.const 128)
      (i32.rem_u (i32.div_u (call $millis) (i32.const 120)) (i32.const 212))))
    (call $text (local.get $x) (i32.const 40) (i32.const 16) (i32.const 13))
    call $show))
```

### 按键交互（buttons 位掩码）

```wat
(local.set $b (call $buttons))        ;; bit0..3 = K1..K4
(if (i32.and (local.get $b) (i32.const 2))   ;; K2 按下？
  (then ;; …))
```

更多完整示例见「屏幕内容」页模板下拉：弹跳小球 / 滚动字幕 / 像素爱心 / 按键测试 / 自定义骨架。

## 用 C 写（可选，本地编译）

网页编辑器只接受 WAT；C 需在本地用 clang 编成 .wasm 再点「导入 .wasm」：

```c
// 宿主 API 声明（复制这段即可）
__attribute__((import_module("env"), import_name("clear")))   void clear(void);
__attribute__((import_module("env"), import_name("show")))    void show(void);
__attribute__((import_module("env"), import_name("px")))      void px(int x, int y);
__attribute__((import_module("env"), import_name("rect")))    void rect(int x,int y,int w,int h,int fill);
__attribute__((import_module("env"), import_name("text")))    void text(int x,int y,const char* s,int len);
__attribute__((import_module("env"), import_name("millis")))  int  millis(void);
__attribute__((import_module("env"), import_name("buttons"))) int  buttons(void);
__attribute__((import_module("env"), import_name("status")))  int  status(void);
__attribute__((import_module("env"), import_name("clock")))   int  clock(void);
__attribute__((import_module("env"), import_name("segSec")))  int  segSec(void);
__attribute__((import_module("env"), import_name("nodeMin"))) int  nodeMin(void);

void run(void) {                        // 必须导出 run
  clear();
  rect(0, 0, 128, 64, 0);               // 描边边框
  text(30, 36, "HELLO", 5);
  show();
}
```

```bash
clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export=run \
      -Wl,--export-memory -O2 -o screen.wasm screen.c
```

产物通常只有几百字节～几 KB，设备上限 48KB。

## 设备端行为

- 上传后写 flash `/app_<status>.wasm`：**进入该状态自动执行，断电/断连不丢**
- 状态切换即换 app；没有文件的状态显示默认屏
- 待办/休息提醒画面会**临时覆盖** app，通知结束自动恢复执行
- **trap**（越界内存、除零等）→ 卸载回默认屏，文件保留可修代码重传
- **死循环** → 任务看门狗复位设备 → 重启后该 app 文件改名 `.bad` 禁用（不会再死循环）；重新上传自动解除
- trap / 加载失败会上报 `appErr`，网页「屏幕内容」显示错误原因；安装情况以设备上报的 `apps` 清单为准
- 「恢复默认」删除该状态的 app 文件（含 `.bad`）
- 默认屏布局（状态+时间+说明 / 状态+时间 / 仅状态）只影响没有 app 的状态
