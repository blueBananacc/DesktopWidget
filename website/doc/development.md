# 网站开发

## 命令（website/ 目录下，PowerShell）

```
npm install        # 首次
npm run dev        # 开发服务器（默认 5173，占用时自动换端口，看输出）
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build（构建即类型检查）
npm run preview    # 预览构建产物
```

没有 lint 和测试框架；验证方式 = `npm run build` + 浏览器手动走查。

技术栈：Vite 8 + React 19 + TypeScript + react-router-dom 7 + lucide-react。系统自带字体，不加载外部字体。

## src/ 结构

- `domain/`：类型与纯逻辑。`statuses.ts` 6 种状态（色值三端统一）、`schedule.ts`、`time.ts`、`voiceParse.ts`（本地规则解析，非真实语音识别）
- `device/`：设备通信抽象，详见 [device-protocol.md](device-protocol.md)
- `store/`：`AppStore.tsx` 全局状态（React Context），`seed.ts` 演示数据
- `ui/`：`HoldButton`（按住 1.5s 收工 + 10s 撤销）、`Toast`、`DeviceMirror`（OLED 屏镜像）、`WeekBars` 等
- `layout/`：`AppShell`（侧栏三组导航 + 顶栏 + 移动端底部 5 标签）、`VoiceDialog`（语音创建提醒）
- `pages/`：Overview / Schedule / Reminders / Review / Board / DevicePage / SettingsPages
- `pages/Product.tsx` + `styles/product.css`：电商式产品介绍页，路由 `/product`（不在 AppShell 内，类名 `pd-` 前缀）。图位组件 `Shot` 按 `public/product/<name>.(png|jpg|jpeg|webp)` 自动加载，缺图显示占位框；视频位 `VideoShot` 读 `public/product/<name>.mp4`，IntersectionObserver 进视口播/出视口停。价格/配色在文件顶部 `PRICE` / `COLORS` 常量。控制台截图 `public/product/app-*.png` 用模拟设备（localStorage `sgp-last-transport=mock`）截取
- `hooks/useOffwork.ts`：收工逻辑
