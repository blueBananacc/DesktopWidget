# 收工牌 OLED 动效 JS 规范 v1

> 把这份文档和想要的图案/描述一起发给 Agent，让它产出一段可直接粘贴到「动效」页编辑器的 JS。
> 代码在**网页沙箱**里求值（无网络、无 DOM），把每一帧画成 128×64 单色位图后上传设备。
> 设备只是播放器，不执行代码——写错了最多预览报错，弄不坏设备。

## 屏幕

- **128 × 64 像素，单色**（每像素只有亮/灭，无灰度、无彩色）
- 原点 (0,0) 在左上角；x 向右 0–127，y 向下 0–63
- 小屏建议：文字 ≥ 10px，元素之间留 2px+ 间隙，避免大面积填充（OLED 大白色块很刺眼）

## 程序结构

```js
// 必须：meta 常量（帧数/帧率/是否循环）
const meta = { name: "我的动效", frames: 16, fps: 8, loop: true };

// 必须：draw(t)，t = 帧序号 0 .. frames-1，每帧调用一次 device.draw()
function draw(t) {
  device.draw({ elements: [ /* 这一帧要画的元素 */ ] });
}
```

- `frames`：1–16 帧（设备内存上限）；`fps`：1–20；`loop`：false 时播完停在最后一帧
- 每帧独立重画，不需要管上一帧；`device.draw` 每帧最多调用一次（以最后一次为准）
- 动画时长 = frames / fps 秒；想让画面"停留"就重复画相同内容占帧

## 元素类型

坐标均为绝对像素值（row/column/stack 之外没有自动布局）。

| 类型 | 字段 | 说明 |
|---|---|---|
| `rect` | `x, y, w, h, fill?, stroke?, radius?` | 矩形；`fill` 实心（radius 圆角），`stroke` 描边 1px |
| `text` | `x, y, text, size?, color?, align?` | 文字；size 默认 12，align: left/center/right（center/right 以 x 为锚点）。中英文都支持 |
| `bitmap` | `x, y, rows` 或 `x, y, w, h, data` | 位图；`rows` 字符串数组（`.`/`空格`/`0` = 灭，其余 = 亮）。`data` 为 1bpp 行优先 hex（MSB 先） |
| `line` | `x1, y1, x2, y2, color?` | 1px 直线 |
| `pixel` | `x, y, color?` | 单像素点 |

### 颜色

`#rgb` / `#rrggbb` / `#rrggbbaa`；转单色规则：**alpha < 0.5 → 不画；亮度(0.299R+0.587G+0.114B) ≥ 128 → 亮**。`"none"`/`"transparent"` = 不画。省略 color 默认亮。

## 可用环境

- `device.W` / `device.H`：画布尺寸常量
- 元素构造辅助（可选）：`rect(o)` `text(o)` `bitmap(o)` `line(o)` `pixel(o)` —— 等价于 `{type: "…", ...o}`，直接写对象字面量也行
- 布局辅助：`row({x,y,gap}, kids)` `column({x,y,gap}, kids)` `stack({x,y}, kids)` —— 返回展开后的元素数组
- `Math` `JSON` `Object` `Array` `String` `Number` `Boolean` 可用
- **没有** `Date`、`setInterval`、`fetch`、网络、DOM——动画必须纯由 `t` 驱动

## 示例：弹跳小球

```js
const meta = { name: "弹跳小球", frames: 16, fps: 10, loop: true };
function draw(t) {
  const phase = (t % 16) / 16;
  const h = Math.abs(Math.sin(phase * Math.PI * 2)) * 44;
  const y = 56 - h;
  const squash = h < 4 ? 1.4 : 1;
  const bw = Math.round(8 * squash), bh = Math.round(8 / squash);
  device.draw({ elements: [
    { type: "line", x1: 0, y1: 60, x2: 127, y2: 60 },
    { type: "rect", x: 60 - (bw >> 1), y: y - bh, w: bw, h: bh, fill: "#fff", radius: 3 },
  ] });
}
```

## 设备端行为

- 动画是**按状态绑定**的：在「屏幕内容 → 按状态自定义屏幕」里为某个状态上传后，帧写入设备 flash（`/anim_<status>.bin`），**进入该状态自动播放，断电和断连都不丢**
- 没有自定义的状态显示默认屏幕（状态名 + 副标题 + 时间）
- 设备**任意按键**或切换到其他状态即退出播放；「恢复默认」删除该状态的动画文件
- 待办提醒、休息提醒画面会**临时覆盖**动画，通知结束后动画继续

## 常见错误

| 报错 | 原因 |
|---|---|
| `代码需要定义 draw(t) 函数` | 代码里没有顶层的 `function draw(t)` |
| `执行超时` | 代码里有死循环（动画必须靠 draw(t) 逐帧返回，不能自己跑 setInterval） |
| 画面全黑 | 颜色都映射成了"灭"（太暗或 alpha 太低），或元素画到屏幕外 |
