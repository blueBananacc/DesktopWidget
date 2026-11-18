# 收工牌模拟器

把收工牌搬上你的电脑：编写一个收工牌应用、运行它、给它截图和录一小段视频，并为上架应用目录做好准备——全程不需要收工牌硬件。

## 两种入门方式

第一次打开时，模拟器窗口会问你要做哪一件事。「I'll write the code」打开 Create app：选一个模板或空应用，设定名称、图标和文件夹；随后应用便会在收工牌上构建并运行。「My AI agent will」会给你一段文字，连同命令行在你电脑上的路径，供你粘贴给你的 AI 助手。这个问题只回答一次，之后不会自己再次出现；应用列表底部的「Getting started」可以让它重新显示。

### 我自己动手

1. 启动模拟器：在 sgp-emulator 源码检出目录运行 `node packages/server/index.mjs`，然后打开 `/sgp/emulator/`——窗口中会出现收工牌。
2. 在 PowerShell 中，用官方应用模板创建一个项目，并在模拟的收工牌上运行它（`<emu>` 换成你的检出目录）：

   ```powershell
   $cli = "<emu>/packages/server/cli/busy-emulator.mjs"
   node $cli create my-app --author "Your Name"
   cd my-app
   node $cli build
   node $cli run
   ```

3. 修改 `src/main.ts`，然后再次 `build` 和 `run`：`run` 会安装 `build` 产出的内容、启动它，并报告它是否在运行。也可以让 `dev` 一直运行：每次保存它都会完成这两步，并显示应用的控制台。窗口中的 Run（运行期间显示为 Refresh）会为应用执行一次构建、安装和启动。

   | 命令 | 作用 |
   |---|---|
   | `dev` | 每次保存时重新构建、安装并启动应用，并显示其控制台 |
   | `logs` | 显示应用用 `console.log` 打印的内容，以及它停止时的原因 |
   | `screenshot` | 把正面屏幕保存为应用目录格式的 PNG（`--back` 截背面屏幕） |
   | `record` | 录制应用在收工牌上的一小段视频，生成可发布的 MP4（`--gif` 生成 GIF） |
   | `check`、`submit` | 按应用目录的规则检查项目，并准备它的 pull request |
   | `publish`、`catalog-texts` | 一步步让项目为其公开仓库和应用目录做好准备 |
   | `help` | 列出所有命令 |

`create` 会从 npm registry 下载模板及其依赖；其余命令不需要联网。项目自带的 `busy-cli` 负责构建和安装，所以如果你自己装了 Node 24，`npx busy-cli app install --addr 127.0.0.1:8640` 同样可用。

### 交给我的 AI 助手

把下面这几行（连同你的想法）交给一个能运行命令的助手（Claude Code、Codex、Cursor）：

```text
帮我写一个收工牌应用：<你的想法>。
我没有收工牌硬件，请按 agents.md 的说明使用收工牌模拟器。
```

助手会在模拟器缺失时先安装它，然后创建项目、运行并检查截图。它会先征得你同意：

- 从模拟器项目的发布页下载并为当前用户安装；
- 运行 `sgp-emulator` 命令。允许之后，助手才能启动模拟器，并在你电脑上构建、运行项目的代码。

## 你能得到什么

- **窗口中的收工牌。** 两块屏幕，以及居中位于收工牌下方的控件：模式开关、带两颗状态 LED 的 Start / Pause、Back 和滚轮。可以是平面视图，也可以是可手动旋转缩放的 3D 模型，并带正面、背面、顶部和侧面的快捷视角。旁边是你的应用（Create app，以及每行菜单中的 Delete）、所选应用及其文件夹、Copy prompt for AI、Run 及其 Settings、Catalog 和 Files，还有它的控制台。
- **收工牌自己的代码。** JavaScript 运行时、绘图、系统界面和收工牌的本地 Web，都是固件 1.3.1 的代码编译成的 WebAssembly。它们的画面与真实收工牌逐像素比对过。本地 Web（含你应用的设置页）可从菜单中的 收工牌 → App Settings（Ctrl+,）打开，也可以在浏览器中访问 `http://127.0.0.1:8640`。
- **收工牌的速度与限制。** 你的应用的 JavaScript 会花费与在收工牌上相同的时间，并适用同样的内存、`fetch` 和 API 限制。在这里慢或过大的，在收工牌上也一样慢、一样大。
- **给应用目录用的截图。** 72×16 和 160×80 像素的 PNG 文件，除像素外不含任何其他内容：可用窗口中收工牌上方的 Screenshot（勾选 Front、Back 或两者；快捷键 Ctrl+Shift+S），也可用命令行的 `screenshot`。
- **给帖子用的一段视频。** 窗口顶栏的 **Record**，或命令行的 `record`，可录制模拟器窗口或单独收工牌画面的 MP4；`record --gif` 生成正面屏幕的 GIF：[给帖子录一段视频](first-app.md#给帖子录一段视频)。
- **提交前的应用目录检查。** `check` 会告诉你 收工牌应用目录会对你的项目说什么；`submit` 会写出其 pull request 所需的文件。
- **一步步发布。** 窗口中的 **Publish**，或命令行的 `publish`，带你依次完成应用目录文案、截图、README、许可证和仓库文件，经过预检和打包；然后把应用发布到你自己的公开 GitHub 仓库，并打开提给应用目录的 pull request。它通过 GitHub CLI 登录，GitHub CLI 已包含在应用内（[具体方式](first-app.md#分步发布)）。
- **面向人和助手的命令行。** `sgp-emulator`，每条命令都支持 `--json`。

Create app 可以从模板、空应用、你已有的文件夹、GitHub 上的仓库（Import from GitHub）或应用包（.tgz）启动项目：[在窗口中](first-app.md#在窗口中)。

## 更多

- [你在模拟收工牌上的第一个应用](first-app.md)：创建项目、构建、运行并截图；然后[提交到应用目录](first-app.md#提交到应用目录)
- [agents.md](agents.md)：给在没有收工牌的情况下开发应用的 AI 助手的说明

- [问题与想法](troubleshooting.md#报告问题)：报告里该写些什么
- [故障排查](troubleshooting.md)，含 Windows 常见问题和[全部错误码](troubleshooting.md#全部错误码-按字母排序)

- 应用本身的写法：项目中的 `AGENTS.md` 和 `README.md`，以及收工牌 HTTP API

收工牌模拟器是基于 GPL-2.0-or-later 的自由软件，© Flipper FZCO。
