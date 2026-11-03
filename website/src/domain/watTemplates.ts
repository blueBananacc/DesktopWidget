/** 自定义屏幕的 WAT 模板。WAT 由网页端 wabt 编译成 wasm 上传；设备 wasm3 按状态执行。 */
export interface WatTemplate { id: string; name: string; desc: string; code: string }

/** 宿主 API v1（与固件 m3_LinkRawFunction 列表一致）：页面速查表与模板注释共用这一份 */
export const HOST_API: { sig: string; desc: string }[] = [
  { sig: "clear()", desc: "清帧缓冲（每帧开头调用）" },
  { sig: "show()", desc: "帧缓冲刷上屏（每帧结尾调用）" },
  { sig: "px(x, y)", desc: "置像素（越界自动裁剪）" },
  { sig: "rect(x, y, w, h, f)", desc: "矩形（f=1 实心，0 描边）" },
  { sig: "text(x, y, ptr, len)", desc: "ASCII 文本（6x10 字体，y 为基线；ptr/len 指线性内存里的字节，len≤64）" },
  { sig: "millis() -> i32", desc: "设备毫秒计数（动画的时钟来源）" },
  { sig: "buttons() -> i32", desc: "K1-K4 按下位掩码（bit0=K1 … bit3=K4）" },
  { sig: "status() -> i32", desc: "当前状态下标（0 工作中 1 勿扰 2 专注 3 会议 4 休息 5 已下班）" },
  { sig: "clock() -> i32", desc: "本地时钟：今日已过分钟数 0–1439（未校时 -1）" },
  { sig: "segSec() -> i32", desc: "当前状态已持续的秒数（专注/会议计时用它）" },
  { sig: "nodeMin() -> i32", desc: "距今日下个计划节点的分钟数（-1：无节点/已暂停/已收工）" },
];

const COMMON = `;; 宿主 API（doc/display-app-spec.md）：
${HOST_API.map((a) => `;;   ${a.sig.padEnd(20)} ${a.desc}`).join("\n")}
`;

export const WAT_TEMPLATES: WatTemplate[] = [
  {
    id: "default",
    name: "默认屏幕",
    desc: "状态名 + 时钟 + 说明行：设备默认屏的程序版，可改文字和排版；演示 status() + clock()",
    code: `${COMMON}
(module
  (import "env" "clear"  (func $clear))
  (import "env" "show"   (func $show))
  (import "env" "text"   (func $text (param i32 i32 i32 i32)))
  (import "env" "clock"  (func $clock (result i32)))
  (import "env" "status" (func $status (result i32)))
  (memory (export "memory") 1)
  ;; 时钟缓冲 HH:MM（未校时显示 --:--）
  (data (i32.const 16) "--:--")
  ;; 状态名表：每 8 字节一个 ASCII 名（补空格对齐），status() 下标 ×8 取地址
  (data (i32.const 32) "WORKING BUSY    FOCUS   MEETING REST    OFF DUTY")
  ;; 说明行表：每 16 字节一条，与名表同下标顺序
  (data (i32.const 80) "COME FIND ME    DO NOT DISTURB  FOCUSING        IN A MEETING    BE RIGHT BACK   SEE YOU TOMORROW")
  (func $digit (param $v i32) (result i32) (i32.add (i32.const 48) (i32.rem_u (local.get $v) (i32.const 10))))
  (func $run (export "run")
    (local $s i32) (local $m i32) (local $c i32)
    call $clear
    ;; 右上角时钟 HH:MM（clock()=-1 时缓冲保持 --:--）
    (local.set $c (call $clock))
    (if (i32.ge_s (local.get $c) (i32.const 0))
      (then
        (local.set $m (i32.div_u (local.get $c) (i32.const 60)))
        (local.set $s (i32.rem_u (local.get $c) (i32.const 60)))
        (i32.store8 (i32.const 16) (call $digit (i32.div_u (local.get $m) (i32.const 10))))
        (i32.store8 (i32.const 17) (call $digit (local.get $m)))
        (i32.store8 (i32.const 19) (call $digit (i32.div_u (local.get $s) (i32.const 10))))
        (i32.store8 (i32.const 20) (call $digit (local.get $s)))))
    (call $text (i32.const 92) (i32.const 14) (i32.const 16) (i32.const 5))
    ;; 状态名（text 只有 6x10 ASCII：固件默认屏的中文大字这里用英文名近似，想画中文要用位图）
    (call $text (i32.const 30) (i32.const 40)
      (i32.add (i32.const 32) (i32.mul (call $status) (i32.const 8)))
      (i32.const 8))
    ;; 说明行（下标 ×16）
    (call $text (i32.const 22) (i32.const 56)
      (i32.add (i32.const 80) (i32.mul (call $status) (i32.const 16)))
      (i32.const 16))
    call $show))`,
  },
  {
    id: "ball",
    name: "弹跳小球",
    desc: "实心小球斜向往复弹跳；演示 px + millis 动画",
    code: `${COMMON}
(module
  (import "env" "clear"  (func $clear))
  (import "env" "show"   (func $show))
  (import "env" "px"     (func $px (param i32 i32)))
  (import "env" "millis" (func $millis (result i32)))
  (memory (export "memory") 1)
  (func $run (export "run")
    (local $t i32) (local $cx i32) (local $cy i32)
    (local $dx i32) (local $dy i32) (local $p i32)
    (local.set $t (i32.div_u (call $millis) (i32.const 125)))
    call $clear
    ;; cx = 8 + t % 112
    (local.set $cx (i32.add (i32.const 8) (i32.rem_u (local.get $t) (i32.const 112))))
    ;; cy 三角波：8 + (p < 48 ? p : 96 - p)，p = t % 96
    (local.set $p (i32.rem_u (local.get $t) (i32.const 96)))
    (local.set $cy
      (i32.add (i32.const 8)
        (if (result i32) (i32.lt_s (local.get $p) (i32.const 48))
          (then (local.get $p))
          (else (i32.sub (i32.const 96) (local.get $p))))))
    ;; 实心圆 r=6
    (local.set $dx (i32.const -6))
    (block $bx_done
      (loop $bx
        (br_if $bx_done (i32.gt_s (local.get $dx) (i32.const 6)))
        (local.set $dy (i32.const -6))
        (block $by_done
          (loop $by
            (br_if $by_done (i32.gt_s (local.get $dy) (i32.const 6)))
            (if (i32.le_s
                  (i32.add (i32.mul (local.get $dx) (local.get $dx))
                           (i32.mul (local.get $dy) (local.get $dy)))
                  (i32.const 36))
              (then (call $px
                (i32.add (local.get $cx) (local.get $dx))
                (i32.add (local.get $cy) (local.get $dy)))))
            (local.set $dy (i32.add (local.get $dy) (i32.const 1)))
            (br $by)))
        (local.set $dx (i32.add (local.get $dx) (i32.const 1)))
        (br $bx)))
    call $show))`,
  },
  {
    id: "marquee",
    name: "滚动字幕",
    desc: "一行文字从右向左滚动；演示 text + 内存数据段",
    code: `${COMMON}
(module
  (import "env" "clear"  (func $clear))
  (import "env" "show"   (func $show))
  (import "env" "text"   (func $text (param i32 i32 i32 i32)))
  (import "env" "millis" (func $millis (result i32)))
  (memory (export "memory") 1)
  ;; 文字内容放在线性内存 16 号偏移，共 13 字节（改内容要同步改 text 的 len 和滚动总宽）
  (data (i32.const 16) "GET OFF WORK!")
  (func $run (export "run")
    (local $x i32)
    call $clear
    ;; x = 128 - (millis()/120 % 212)：从右侧滚入、左侧滚出循环
    (local.set $x (i32.sub (i32.const 128)
      (i32.rem_u (i32.div_u (call $millis) (i32.const 120)) (i32.const 212))))
    (call $text (local.get $x) (i32.const 40) (i32.const 16) (i32.const 13))
    call $show))`,
  },
  {
    id: "heart",
    name: "像素爱心",
    desc: "位图数据段 + 心跳位移；演示内存位图扫描",
    code: `${COMMON}
(module
  (import "env" "clear"  (func $clear))
  (import "env" "show"   (func $show))
  (import "env" "px"     (func $px (param i32 i32)))
  (import "env" "millis" (func $millis (result i32)))
  (memory (export "memory") 1)
  ;; 9x8 爱心位图：'X'=亮 '.'=灭，按行拼接共 72 字节
  (data (i32.const 16) ".XX...XX.XXXX.XXXXXXXXXXXXXXXXX.XXXXXXX...XXXXX.....XXX.......X....")
  (func $run (export "run")
    (local $i i32) (local $s i32)
    call $clear
    ;; s = 心跳相位（每 400ms 上下跳动 1px）
    (local.set $s (i32.rem_u (i32.div_u (call $millis) (i32.const 400)) (i32.const 2)))
    (local.set $i (i32.const 0))
    (block $done
      (loop $l
        (br_if $done (i32.ge_s (local.get $i) (i32.const 72)))
        (if (i32.eq (i32.load8_u (i32.add (i32.const 16) (local.get $i))) (i32.const 88))
          (then (call $px
            (i32.add (i32.const 60) (i32.rem_u (local.get $i) (i32.const 9)))
            (i32.add (i32.const 24) (i32.add (i32.div_u (local.get $i) (i32.const 9)) (local.get $s))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    call $show))`,
  },
  {
    id: "keys",
    name: "按键测试",
    desc: "按下 K1-K4 对应方格填实；演示 buttons() 交互",
    code: `${COMMON}
(module
  (import "env" "clear"   (func $clear))
  (import "env" "show"    (func $show))
  (import "env" "rect"    (func $rect (param i32 i32 i32 i32 i32)))
  (import "env" "text"    (func $text (param i32 i32 i32 i32)))
  (import "env" "buttons" (func $buttons (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 16) "PRESS K1-K4")
  (func $run (export "run")
    (local $b i32) (local $i i32)
    call $clear
    (call $text (i32.const 30) (i32.const 14) (i32.const 16) (i32.const 11))
    (local.set $b (call $buttons))
    (local.set $i (i32.const 0))
    (block $done
      (loop $l
        (br_if $done (i32.ge_s (local.get $i) (i32.const 4)))
        (call $rect
          (i32.add (i32.const 14) (i32.mul (local.get $i) (i32.const 30)))
          (i32.const 24) (i32.const 22) (i32.const 22)
          (i32.and (i32.shr_u (local.get $b) (local.get $i)) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    call $show))`,
  },
  {
    id: "segTimer",
    name: "状态计时",
    desc: "大字显示进入当前状态以来的 MM:SS；演示 segSec() + 内存写数字",
    code: `${COMMON}
(module
  (import "env" "clear"  (func $clear))
  (import "env" "show"   (func $show))
  (import "env" "text"   (func $text (param i32 i32 i32 i32)))
  (import "env" "segSec" (func $segSec (result i32)))
  (import "env" "clock"  (func $clock (result i32)))
  (memory (export "memory") 1)
  ;; 数字缓冲区在内存 16..20：手动把数值拆成 ASCII 数字写进去；clock()=-1（未校时）时保持 "--:--"
  (data (i32.const 16) "--:--")
  (func $digit (param $v i32) (result i32) (i32.add (i32.const 48) (i32.rem_u (local.get $v) (i32.const 10))))
  (func $run (export "run")
    (local $s i32) (local $m i32) (local $c i32)
    call $clear
    ;; 顶部居中：当前时钟 HH:MM（clock() 返回分钟数；-1 时显示 --:--）
    (local.set $c (call $clock))
    (if (i32.ge_s (local.get $c) (i32.const 0))
      (then
        (local.set $m (i32.div_u (local.get $c) (i32.const 60)))  ;; 小时
        (local.set $s (i32.rem_u (local.get $c) (i32.const 60)))  ;; 分钟
        (i32.store8 (i32.const 16) (call $digit (i32.div_u (local.get $m) (i32.const 10))))
        (i32.store8 (i32.const 17) (call $digit (local.get $m)))
        (i32.store8 (i32.const 18) (i32.const 58))                ;; ':'
        (i32.store8 (i32.const 19) (call $digit (i32.div_u (local.get $s) (i32.const 10))))
        (i32.store8 (i32.const 20) (call $digit (local.get $s)))))
    (call $text (i32.const 50) (i32.const 20) (i32.const 16) (i32.const 5))
    ;; 中部大字：本状态已持续 MM:SS（segSec()；分钟数超 99 取模防溢出）
    (local.set $s (call $segSec))
    (local.set $m (i32.rem_u (i32.div_u (local.get $s) (i32.const 60)) (i32.const 100)))
    (local.set $s (i32.rem_u (local.get $s) (i32.const 60)))
    (i32.store8 (i32.const 16) (call $digit (i32.div_u (local.get $m) (i32.const 10))))
    (i32.store8 (i32.const 17) (call $digit (local.get $m)))
    (i32.store8 (i32.const 19) (call $digit (i32.div_u (local.get $s) (i32.const 10))))
    (i32.store8 (i32.const 20) (call $digit (local.get $s)))
    (call $text (i32.const 44) (i32.const 46) (i32.const 16) (i32.const 5))
    call $show))`,
  },
  {
    id: "custom",
    name: "自定义代码",
    desc: "空白骨架：全部宿主 API 已 import，直接在 run() 里画",
    code: `${COMMON}
(module
  (import "env" "clear"   (func $clear))
  (import "env" "show"    (func $show))
  (import "env" "px"      (func $px (param i32 i32)))
  (import "env" "rect"    (func $rect (param i32 i32 i32 i32 i32)))
  (import "env" "text"    (func $text (param i32 i32 i32 i32)))
  (import "env" "millis"  (func $millis (result i32)))
  (import "env" "buttons" (func $buttons (result i32)))
  (import "env" "status"  (func $status (result i32)))
  (import "env" "clock"   (func $clock (result i32)))
  (import "env" "segSec"  (func $segSec (result i32)))
  (import "env" "nodeMin" (func $nodeMin (result i32)))
  (memory (export "memory") 1)
  (func $run (export "run")
    call $clear
    ;; 你的绘制代码……（每帧调用一次，~30fps）
    call $show))`,
  },
];
