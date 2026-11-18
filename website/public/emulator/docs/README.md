<img src="images/emulator-logo.png" width="96" height="96" alt="收工牌模拟器的图标：蓝图网格上的 BUSY 标志">

# 收工牌模拟器

把收工牌搬上你的电脑：编写一个收工牌应用、运行它、给它截图和录一小段视频，并为上架应用目录做好准备——全程不需要收工牌硬件。

这是首个试用版本，0.1.0-beta.1。

| | 下载 | |
|---|---|---|
| **macOS**，Apple Silicon（M1 及更新机型） | **busybar-emulator-mac-arm64.dmg** | 约 210 MB |
| **macOS**，Intel | **busybar-emulator-mac-x64.dmg** | 约 215 MB |
| **Windows**（x64） | **busybar-emulator-win-x64-setup.exe** | 约 250 MB |

怎么分辨你的 Mac 是哪一种：Apple 菜单 →「关于本机」中，Apple Silicon 显示"芯片：Apple M…"，Intel 机型显示"处理器：… Intel …"。SHA256SUMS 列出了每个文件的校验和。

在 macOS 上，应用已由 Apple 签名并公证，打开时没有安全警告。在 Windows 上，安装程序尚未签名，因此首次运行时 SmartScreen 会警告你：[应对方法](install.md#首次打开)。它仅为当前用户安装，不需要管理员权限。Node、npm 和收工牌工具都已包含在内。

## 两种入门方式

第一次打开时，模拟器窗口会问你要做哪一件事。「I'll write the code」打开 Create app：选一个模板或空应用，设定名称、图标和文件夹；随后应用便会在收工牌上构建并运行。「My AI agent will」会给你一段文字，连同命令行在你电脑上的路径，供你粘贴给你的 AI 助手。这个问题只回答一次，之后不会自己再次出现；应用列表底部的「Getting started」可以让它重新显示。

### 我自己动手

1. 下载对应你系统的文件。在 macOS 上，把 BUSY Bar Emulator 拖进「应用程序」（Applications）；在 Windows 上，运行安装程序。打开应用：窗口中会出现收工牌。
2. 在终端里，用官方应用模板创建一个项目，并在模拟的收工牌上运行它。

   macOS：

   ```sh
   cli=~/.busy-emulator/bin/busy-emulator
   "$cli" create my-app --author "Your Name"
   cd my-app
   "$cli" build
   "$cli" run
   ```

   Windows，在 PowerShell 中：

   ```powershell
   $cli = "$env:LOCALAPPDATA\busy-emulator\bin\busy-emulator.exe"
   & $cli create my-app --author "Your Name"
   cd my-app
   & $cli build
   & $cli run
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
Make me a BUSY Bar app: <your idea>.
Follow https://go.busy.app/agents. I have no BUSY Bar, so use BUSY Bar Emulator as that page says.
```

助手会在模拟器缺失时先安装它，然后创建项目、运行并检查截图。它会先征得你同意：

- 从 GitHub 上本仓库的 releases 下载模拟器（大小见上表）并为当前用户安装；
- 运行 `busy-emulator` 命令。允许之后，助手才能启动模拟器，并在你电脑上构建、运行项目的代码。

助手如何安装它：[install.md](install.md#给-agent-安装并启动模拟器)。

无法运行命令的聊天客户端（如 Claude Desktop）则以 MCP 工具的形式获得模拟器：[聊天客户端中的收工牌模拟器](mcp.md)。

## 你能得到什么

- **窗口中的收工牌。** 两块屏幕，以及居中位于收工牌下方的控件：模式开关、带两颗状态 LED 的 Start / Pause、Back 和滚轮。可以是平面视图，也可以是可手动旋转缩放的 3D 模型，并带正面、背面、顶部和侧面的快捷视角。旁边是你的应用（Create app，以及每行菜单中的 Delete）、所选应用及其文件夹、Copy prompt for AI、Run 及其 Settings、Catalog 和 Files，还有它的控制台。
- **收工牌自己的代码。** JavaScript 运行时、绘图、系统界面和收工牌的本地 Web，都是固件 1.3.1 的代码编译成的 WebAssembly。它们的画面与真实收工牌逐像素比对过。本地 Web（含你应用的设置页）可从应用 Settings 标签页末尾的 Open in Local Web 打开（或菜单中的 BUSY Bar → App Settings，Cmd+, 或 Ctrl+,），也可以在浏览器中访问 http://127.0.0.1:8640。
- **收工牌的速度与限制。** 你的应用的 JavaScript 会花费与在收工牌上相同的时间，并适用同样的内存、`fetch` 和 API 限制。在这里慢或过大的，在收工牌上也一样慢、一样大。
- **给应用目录用的截图。** 72×16 和 160×80 像素的 PNG 文件，除像素外不含任何其他内容：可用窗口中收工牌上方的 Screenshot（勾选 Front、Back 或两者；macOS 快捷键 Cmd+Shift+S，Windows 为 Ctrl+Shift+S），也可用命令行的 `screenshot`。
- **给帖子用的一段视频。** 窗口顶栏的 **Record**，或命令行的 `record`，可录制模拟器窗口或单独收工牌画面的 MP4；`record --gif` 生成正面屏幕的 GIF：[给帖子录一段视频](first-app.md#给帖子录一段视频)。
- **提交前的应用目录检查。** `check` 会告诉你 BUSY 应用目录会对你的项目说什么；`submit` 会写出其 pull request 所需的文件。
- **一步步发布。** 窗口中的 **Publish**，或命令行的 `publish`，带你依次完成应用目录文案、截图、README、许可证和仓库文件，经过预检和打包；然后把应用发布到你自己的公开 GitHub 仓库，并打开提给应用目录的 pull request。它通过 GitHub CLI 登录，GitHub CLI 已包含在应用内（[具体方式](first-app.md#分步发布)）。
- **面向人和助手的命令行。** `busy-emulator`，每条命令都支持 `--json`。

Create app 可以从模板、空应用、你已有的文件夹、GitHub 上的仓库（Import from GitHub）或应用包（.tgz）启动项目：[在窗口中](first-app.md#在窗口中)。真机拥有最终发言权：[模拟器与收工牌的差异](differences.md)。

## 更多

- [从零到应用目录提交](from-zero-to-catalog.md)：完整流程，在窗口中手动操作或借助 AI 助手，从下载一路到 pull request
- [你在模拟收工牌上的第一个应用](first-app.md)：创建项目、构建、运行并截图；然后[提交到应用目录](first-app.md#提交到应用目录)
- [agents.md](agents.md)：给在没有收工牌的情况下开发应用的 AI 助手的说明
- [安装收工牌模拟器](install.md)：从哪里下载什么、首次打开、给助手的安装流程、卸载
- [聊天客户端（MCP）中的收工牌模拟器](mcp.md)：面向 Claude Desktop、Cursor 及其他客户端的模拟器工具
- [问题与想法](troubleshooting.md#报告问题)：报告里该写些什么
- [模拟器在网络上和磁盘上做了什么](network-and-disk.md)
- [故障排查](troubleshooting.md)，含 Windows 专节和[全部错误码](troubleshooting.md#全部错误码-按字母排序)
- [模拟器与收工牌有何不同](differences.md)
- 应用本身的写法：项目中的 `AGENTS.md` 和 `README.md`，以及收工牌 HTTP API

收工牌模拟器是基于 GPL-2.0-or-later 的自由软件，© Flipper FZCO。
