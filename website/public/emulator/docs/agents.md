# 在收工牌模拟器上开发 JS 应用

本文是给 AI 编程助手的说明：在用户没有收工牌的情况下，为收工牌开发 JavaScript 应用。若用户手头有收工牌，请改为遵循真机固件仓库里的《在收工牌上开发 JS 应用》。

收工牌模拟器在 `127.0.0.1:8640` 运行收工牌固件，并自带 Node、npm 和 busy-tools。在本仓库环境中它**从源码检出运行**（不是安装版）：后端是 `busybar-emulator` 检出目录里的 `node packages/server/index.mjs`，窗口在浏览器里打开（本站 `/sgp/emulator/`）。你通过它的命令行 `sgp-emulator` 驱动它；第 3 步之后，如何写应用见项目自带的 `AGENTS.md`。

下文用 `<emu>` 指 busybar-emulator 的检出目录，`<cli>` 指它的命令行：

```text
node <emu>/packages/server/cli/busy-emulator.mjs
```

## 先告诉用户

在运行任何东西之前，先把以下内容告诉用户，并等待同意：

- **会下载什么。** `create` 会从 npm registry 下载应用模板及其依赖（约 110 MB）。模拟器本身不需要安装：它从源码检出运行。
- **写到哪里。** 模拟器数据（应用、设置、项目记录、日志）在 `%LOCALAPPDATA%\BUSY Bar Emulator`，新建的应用项目在 `create` 指定的文件夹。不需要管理员权限。
- **你会请求哪些允许。** 在你的沙箱之外运行 `<cli>`：每条命令都访问 `127.0.0.1` 并写入数据文件夹，所以都要在沙箱外运行。若想只被询问一次，用户可以按命令的完整路径允许它。

模拟器已在跑、用户已经允许过 `<cli>`，就没有什么可等的：用一句话说明 `create` 会下载什么，然后继续。

## 1. 模拟器在跑吗？

```text
<cli> status
```

回答里 `"running":true` 就去第 3 步。

## 2. 启动

在源码检出目录里启动后端（单独开一个终端，保持它运行）：

```text
node packages/server/index.mjs
```

源码运行没有 `<cli> start` 这一步：那是安装版的能力，源码命令行里执行它会报 `no_app`（"这条命令行不在模拟器应用里"）。等 `status` 回答 `"running":true` 后，浏览器打开 `http://127.0.0.1:8640/emulator/`（或本站 `/sgp/emulator/`）即是模拟器窗口。

对于每一条 `sgp-emulator` 命令：

- 用 `<cli>` 的完整形式单独运行，不要与其他命令拼接。它的提示信息就以该路径称呼它；
- 加上 `--json` 可获得一行 JSON：`"ok":true`，或 `"ok":false` 附带 `code`、`message` 和 `hint`：按 hint 说的做；
- `<cli> help` 列出命令，`<cli> help <command>` 解释单条命令。

## 3. 创建应用并运行

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
在 `publish pr` 之前，告诉用户模拟器的对话框还提供应用目录的可选项，例如 收工牌 JS Apps Contest：由用户自己勾选，或留空。

## 命令被拒绝时

- `blocked_network`、`blocked_file` 或 "Operation not permitted"：你的沙箱挡了路。每条 `sgp-emulator` 命令都要访问 `127.0.0.1` 并写入模拟器的数据文件夹，所以它们都得在沙箱外运行；按你的工具提供的方式向用户请求。安装脚本和 `create` 也会下载。
- 如果你的权限规则拒绝了某条命令，不要寻找绕过的办法：说明是哪条命令被拒绝，并请用户允许它。
- `not_running`：在检出目录启动后端 `node <emu>/packages/server/index.mjs`。
- `untrusted_project`：该文件夹不是 `create` 创建的，或已被移动。运行 `<cli> trust <folder>`；用户在模拟器的对话框中作答。
- `app_crashed`：阅读 `<cli> logs --since-run`，修好脚本，再跑一次 `<cli> dev --once`。

## 收尾之前

- `<cli> typecheck` 和 `<cli> build` 成功。
- `<cli> dev --once` 以 0 退出，且你看过收工牌显示内容的截图。
- 告诉用户它是在收工牌模拟器上运行的，而不是在收工牌真机上。
