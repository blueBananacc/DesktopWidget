/** 自定义屏幕的 WAT 模板。WAT 由网页端 wabt 编译成 wasm 上传；设备 wasm3 按状态执行。 */
export interface WatTemplate { id: string; name: string; desc: string; code: string }

const COMMON = `;; 宿主 API（doc/display-app-spec.md）：
;;   clear()              清帧缓冲（每帧开头调用）
;;   show()               帧缓冲刷上屏（每帧结尾调用）
;;   px(x, y)             置像素（越界自动裁剪）
;;   rect(x, y, w, h, f)  矩形（f=1 实心，0 描边）
;;   text(x, y, ptr, len) ASCII 文本（6x10 字体；ptr/len 指线性内存里的字节）
;;   millis() -> i32      设备毫秒计数（动画的时钟来源）
;;   buttons() -> i32     K1-K4 按下位掩码（bit0=K1 … bit3=K4）
;;   status() -> i32      当前状态下标（0..5）
`;

export const WAT_TEMPLATES: WatTemplate[] = [
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
  (memory 1)
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
  (memory 1)
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
  (memory 1)
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
  (memory 1)
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
  (memory 1)
  (func $run (export "run")
    call $clear
    ;; 你的绘制代码……（每帧调用一次，~30fps）
    call $show))`,
  },
];
