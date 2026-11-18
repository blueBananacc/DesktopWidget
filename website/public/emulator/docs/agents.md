# 在收工牌模拟器上开发 JS 应用

本文是给 AI 编程助手的说明：在用户没有收工牌的情况下，为收工牌开发 JavaScript 应用。若用户手头有收工牌，请改为遵循真机固件仓库里的《在收工牌上开发 JS 应用》。

收工牌模拟器是 macOS（Apple Silicon 和 Intel）与 Windows（x64）的桌面应用。它在 `127.0.0.1:8640` 运行收工牌固件，并自带 Node、npm 和 busy-tools。你通过它的命令行 `busy-emulator` 来驱动它。第 4 步之后，如何写应用见项目自带的 `AGENTS.md`；模拟器与收工牌的差异见「模拟器与真机差异」。

## 先告诉用户

在下载或运行任何东西之前，先把以下内容告诉用户，并等待同意：

- **从哪里下载、下载什么。** 如果模拟器尚未安装：它的安装脚本（几 KB）、模拟器本体（macOS 约 210 MB，Windows 约 250 MB）以及 `SHA256SUMS`，均来自 `github.com/busy-app/busybar-emulator` 的 releases。之后 `create` 会从 npm registry 下载应用模板及其依赖（约 110 MB）。
- **安装到哪里。** 仅当前用户，macOS 约 525 MB，Windows 约 580 MB：
  - 应用：`~/Applications`，或 `%LOCALAPPDATA%\Programs\BUSY Bar Emulator`；
  - 数据：`~/Library/Application Support/BUSY Bar Emulator`，或 `%LOCALAPPDATA%\BUSY Bar Emulator`；
  - 命令行：`~/.busy-emulator/bin`，或 `%LOCALAPPDATA%\busy-emulator\bin`。

  不需要管理员权限，不用 `sudo`，不改任何系统设置。由命令下载的文件会跳过系统的首次打开检查。校验和可证明下载是完整的。在 macOS 上，应用还经过 Apple 签名并公证；Windows 安装程序未签名，因此只有指向 github.com 的 HTTPS 连接能为其来源作证。
- **你会请求哪些允许。** 运行安装脚本、读取指针文件（第 1 步），以及在你的沙箱之外运行 `busy-emulator`。这让你能启动模拟器，并在本机上构建、运行项目的代码。若想只被询问一次，用户可以在你的工具的权限规则中，按该命令的完整路径允许这一条命令。

如果模拟器已安装、用户已经允许过 `busy-emulator`，就没有什么可等的：用一句话说明 `create` 会下载什么，然后继续。

## 1. 装好了吗？

读取指针文件；`busy-emulator` 通常不在 `PATH` 上：

- macOS：`~/Library/Application Support/BUSY Bar Emulator/install.json`
- Windows：`%LOCALAPPDATA%\BUSY Bar Emulator\install.json`

其中 `cli` 字段是命令行的完整路径，即下文的 `<cli>`：macOS 上是 `~/.busy-emulator/bin/busy-emulator`，Windows 上是 `%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe`。在 Windows 上，PowerShell 中以 `& "$env:LOCALAPPDATA\busy-emulator\bin\busy-emulator.exe"` 调用，Git Bash 中以 `"$LOCALAPPDATA/busy-emulator/bin/busy-emulator.exe"` 调用，cmd 中以 `"%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe"` 调用。

如果该文件存在且 `cli` 中的路径也存在，跳到第 3 步。否则去第 2 步：安装脚本也能找到被移动过的应用。

## 2. 安装

针对对应系统，以一条命令运行安装脚本。它会在解压或运行任何内容之前先对照 `SHA256SUMS` 校验下载，为当前用户安装，启动模拟器，并在最后打印 `cli=<path>`。在 Windows 上它不会在 `%TEMP%` 留下任何东西：下载的脚本会自我删除，安装成功后安装程序的日志也会被清除。

macOS（脚本会自动选择匹配 Mac 处理器的构建）：

```sh
curl -fsSL -o "$TMPDIR/busy-emulator-install.sh" https://github.com/busy-app/busybar-emulator/releases/latest/download/install-macos.sh && zsh "$TMPDIR/busy-emulator-install.sh"
```

Windows，在 PowerShell 中：

```powershell
curl.exe -fsSL -o "$env:TEMP\busy-emulator-install.ps1" https://github.com/busy-app/busybar-emulator/releases/latest/download/install-windows.ps1; if ($LASTEXITCODE -eq 0) { powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\busy-emulator-install.ps1" }
```

模拟器现在已在运行：去第 4 步。

## 3. 启动

```text
<cli> start
```

`start` 打开模拟器窗口，并在其收工牌应答后返回；你结束后模拟器会继续运行。只能用这种方式启动它，绝不要用 `open` 或 `Start-Process`。对于每一条 `busy-emulator` 命令：

- 用完整路径单独运行它，不要与其他命令拼接。它的提示信息就以该路径称呼它；在 Windows 上，当路径不含空格时，可用正斜杠写法（`C:/Users/<name>/AppData/Local/busy-emulator/bin/busy-emulator.exe`），它在 PowerShell、Git Bash 和 cmd 中都能直接运行；
- 加上 `--json` 可获得一行 JSON：`"ok":true`，或 `"ok":false` 附带 `code`、`message` 和 `hint`：按 hint 说的做；
- `<cli> help` 列出命令，`<cli> help <command>` 解释单条命令。

## 4. 创建应用并运行

```text
<cli> create my-app --name "<App Name>" --description "<one line>"
```

`create` 用 `npm create @busy-app/app` 所用的官方模板创建项目，并已装好依赖。它会自己创建文件夹：请指定一个新文件夹名，而不是 `.`。作者信息取自 git，取不到则用用户账户，应用 id 由作者和文件夹名生成：不要向用户询问作者信息。

**新项目的 `AGENTS.md` 开头有一节模拟器自己的内容。阅读并遵循它。** 它列出了每一步的命令、设置格式以及网络和内存限制，并替代该文件其余部分和项目 README 中的 `npm run ...`。循环流程如下，在项目文件夹中运行，或把文件夹作为参数（`<cli> dev my-app --once`）：

```text
<cli> dev --once
<cli> screenshot --scale 8
<cli> logs --since-run
<cli> press start
<cli> time advance 25m
<cli> settings set <field>=<value> --restart
<cli> typecheck
```

`dev --once` 构建、安装并启动应用：退出码 0 表示它在运行。`screenshot` 写入当前文件夹的 `screenshots/`（`--out` 可指定别处）；打开 `front-<n>@8x.png`，确认收工牌显示的是用户要的效果。模拟器以收工牌的速度运行应用：在这里慢的，在收工牌上也慢。把项目留在 `create` 创建它的位置。完成后用 `<cli> stop` 停止应用；让模拟器继续运行，留给用户。

信任文件夹、登录 GitHub、许可证、AI 使用情况、推送、pull request 以及应用目录的确认清单，都是用户的事：要询问，绝不替他们选择、确认或勾选。`refused` 或 `trust_refused` 表示他们选择了取消：不要再问。把应用送去应用目录：`<cli> help publish`。
在 `publish pr` 之前，告诉用户模拟器的对话框还提供应用目录的可选项，例如 BUSY JS Apps Contest：由用户自己勾选，或留空。

## 命令被拒绝时

- `blocked_network`、`blocked_file` 或 "Operation not permitted"：你的沙箱挡了路。每条 `busy-emulator` 命令都要访问 `127.0.0.1` 并写入模拟器的数据文件夹，所以它们都得在沙箱外运行；按你的工具提供的方式向用户请求。安装脚本和 `create` 也会下载。
- 如果你的权限规则拒绝了某条命令，不要寻找绕过的办法：说明是哪条命令被拒绝，并请用户允许它。
- `not_running`：运行 `<cli> start`。
- `untrusted_project`：该文件夹不是 `create` 创建的，或已被移动。运行 `<cli> trust <folder>`；用户在模拟器的对话框中作答。
- `app_crashed`：阅读 `<cli> logs --since-run`，修好脚本，再跑一次 `<cli> dev --once`。

## 收尾之前

- `<cli> typecheck` 和 `<cli> build` 成功。
- `<cli> dev --once` 以 0 退出，且你看过收工牌显示内容的截图。
- 告诉用户它是在收工牌模拟器上运行的，而不是在收工牌真机上。
