/**
 * 动效模板库：每个模板是一段符合 display-app-spec.md 的 JS。
 * 模板同时充当"可运行的示例代码"——用户可以在编辑器里改，或把规范文档发给 Agent 生成新的。
 * API 速查（worker 作用域内可用）：device.draw({elements})、meta 常量、
 * 元素 rect/text/bitmap/line/pixel、布局 row/column/stack、Math/JSON 白名单。
 */

export interface AnimTemplate {
  id: string;
  name: string;
  desc: string;
  code: string;
}

export const ANIM_TEMPLATES: AnimTemplate[] = [
  {
    id: "marquee",
    name: "滚动字幕",
    desc: "一行字从右往左循环滚过屏幕",
    code: `const meta = { name: "滚动字幕", frames: 16, fps: 8, loop: true };

const TEXT = "注意休息，起来活动一下";
const CHAR_W = 13; // 12px 中文字大约宽度

function draw(t) {
  const w = TEXT.length * CHAR_W;
  const x = 128 - ((t * 8) % (128 + w)); // 右进左出
  device.draw({ elements: [
    { type: "text", x, y: 24, text: TEXT, size: 14 },
  ] });
}`,
  },
  {
    id: "heart",
    name: "像素爱心",
    desc: "一颗心在两档大小之间跳动",
    code: `const meta = { name: "像素爱心", frames: 8, fps: 4, loop: true };

const SMALL = [
  ".##.##.",
  "#######",
  "#######",
  ".#####.",
  "..###..",
  "...#...",
];
const BIG = [
  ".###.###.",
  "#########",
  "#########",
  "#########",
  ".#######.",
  "..#####..",
  "...###...",
  "....#....",
];

function draw(t) {
  const big = t % 4 < 2; // 两拍大两拍小
  const rows = big ? BIG : SMALL;
  const w = rows[0].length, h = rows.length;
  device.draw({ elements: [
    { type: "bitmap", x: (128 - w) >> 1, y: (64 - h) >> 1, rows },
  ] });
}`,
  },
  {
    id: "ball",
    name: "弹跳小球",
    desc: "小球落地弹起，循环播放",
    code: `const meta = { name: "弹跳小球", frames: 16, fps: 10, loop: true };

function draw(t) {
  const phase = (t % 16) / 16;                 // 0..1 一轮
  const h = Math.abs(Math.sin(phase * Math.PI * 2)) * 44; // 抛物线高度
  const y = 56 - h;                            // 地面在 y=60
  const squash = h < 4 ? 1.4 : 1;              // 落地压扁
  const bw = Math.round(8 * squash), bh = Math.round(8 / squash);
  device.draw({ elements: [
    { type: "line", x1: 0, y1: 60, x2: 127, y2: 60 },
    { type: "rect", x: 60 - (bw >> 1), y: y - bh, w: bw, h: bh, fill: "#fff", radius: 3 },
  ] });
}`,
  },
  {
    id: "custom",
    name: "自定义代码",
    desc: "按 display-app-spec.md 规范写或粘贴 Agent 生成的代码",
    code: `// 自定义动效：每帧调用 draw(t)，t = 帧序号 0..frames-1
// 通过 device.draw({ elements: [...] }) 提交一帧的元素
// 元素类型：rect / text / bitmap / line / pixel；布局辅助：row / column / stack
// 颜色：#rgb / #rrggbb / #rrggbbaa，亮度 >= 128 显示为亮点
// 画布 128×64，左上为原点。完整规范见 doc/display-app-spec.md
const meta = { name: "我的动效", frames: 8, fps: 5, loop: true };

function draw(t) {
  device.draw({ elements: [
    { type: "text", x: 64, y: 26, text: "你好，收工牌", size: 12, align: "center" },
    { type: "rect", x: 4, y: 4, w: 120, h: 56, stroke: "#fff", radius: 4 },
  ] });
}`,
  },
];
