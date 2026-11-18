# 模拟器在网络上和磁盘上做了什么

本页依据此版本模拟器的代码写成。模拟器不做任何此处未列出的事。如果你发现它做了，那是一个 bug：请报告它。

## 网络上

### 监听哪些地址

| 地址 | 那里是谁在应答 | 谁可以使用 |
|---|---|---|
| `127.0.0.1:8640` | 模拟的收工牌：它的 HTTP API、状态流、本地网页，以及模拟器的窗口。 | 本机上的程序，与使用收工牌时一样：`busy-cli`、`curl`、脚本、AI 代理。其他网站的网页会被拒绝（[这与收工牌有何不同](differences.md)）。 |
| `127.0.0.1:<系统挑选的端口>` | 管理地址，供模拟器自己的命令行使用。 | 仅限发送服务器密钥的程序；密钥位于下文的数据文件夹中，且只有你的用户可读。 |

其他任何地址都不监听：不在你的网络上，不在 IPv6 上，也不在 UDP 上。你的防火墙没有任何需要询问的。收工牌的端口始终是 8640。如果另一个程序占用了它，模拟器会说明这一点并拒绝启动（[故障排除](troubleshooting.md#端口-8640-被占用)）。

### 向外发送什么

- **你的应用自己发出的请求。** 当模拟的收工牌上的应用调用 `fetch` 时，模拟器的服务器按收工牌固件的方式发出该请求：HTTP/1.0、固件自己的请求头、不跟随重定向。请求发往应用指定的地址。指向本机的地址会被拒绝，因为它会到达你自己的服务而不是收工牌（[详见](differences.md#收工牌上的应用可以访问什么)）。
- **带收工牌私有密钥的请求。** 收工牌会用一把私有密钥为发往 BUSY 应用 API（`apps-api.busy.app`）的部分请求签名；模拟器没有这把密钥。对于它认识的唯一一个请求——天气预报（`GET /weather/v1/forecast`）——它用保存的答案自行应答，不发送任何内容。其他任何带密钥的请求都会在不带密钥的情况下发出，视同普通请求。
- **窗口不访问任何外部地址。** 窗口只显示模拟器自身服务器在 `127.0.0.1:8640` 上的页面：收工牌，以及收工牌的本地网页（"App settings"）。对页面的其他任何请求都会被拒绝，包括域名解析。拼写检查（在 Windows 上会下载词典）已关闭。本地网页的图标——收工牌的页面本是从 `api.iconify.design` 获取的——来自应用内部的文件。指向其他网站的链接不会在应用内打开：`https:` 链接交给你的浏览器，其余一律丢弃。
- **项目命令使用 npm registry。** `create` 下载应用模板的生成器（`@busy-app/create-app`）和项目的依赖（项目中约 60 MB）；`build`、`dev` 和 `typecheck` 仅在项目没有依赖时才下载依赖。它们使用你 npm 设置中的 registry 和代理（`~/.npmrc`、`npm_config_registry`、`HTTPS_PROXY`），默认为 `https://registry.npmjs.org`，npm 会向 registry 发送它一贯发送的内容。模拟器给 npm 60 秒超时和两次重试，45 秒无应答就停止它；然后尝试它数据文件夹里的 npm 缓存。`install`、`run`、`stop`、`record` 及其他命令只与 `127.0.0.1` 通信；`check`、`submit`、`catalog-texts` 和发布的第一阶段不与任何对象通信，但 `publish prepare` 会构建项目，因此可能像 `build` 一样需要 registry。
- **发布到 GitHub，仅在你要求时。** "发布到 GitHub"（Publish to GitHub）和"发送到应用目录"（Send to catalog）（以及 `publish signin`、`push` 和 `pr`）会运行 GitHub CLI（`gh`，由 GitHub 出品，内置在应用中），它只与 `github.com` 和 `api.github.com` 通信：登录、你的公开仓库、提交的文件、应用目录的 fork、分支和 pull request。GitHub CLI 运行时关闭了更新检查和遥测。在你登录 GitHub 或选择 **Use <login>** 之前，没有任何内容发往 GitHub；每次 push 和每个 pull request 都各自等待你的点击确认（从命令行发起时，则等待你在应用自己的对话框中确认）。
- **一次新版本检查。** 应用每次启动时（距上次应答不到一分钟则不重复），以及运行期间每天一次，会向 GitHub 询问模拟器的最新版本：`GET https://api.github.com/repos/busy-app/busybar-emulator/releases/latest`。该请求携带固定的 `User-Agent: busybar-emulator`（不含应用版本）和一个 `Accept` 头：没有标识符，没有任何关于你电脑的信息。GitHub 会看到你的网络地址，正如你打开它的任何页面时一样。如果有更新的版本，窗口会显示 **Update to <version>**（更新到该版本；若此副本无法自我替换，则显示指向发布页的 Download 链接）；在你点击之前不会下载或安装任何内容。检查失败则不显示任何内容。要关闭检查，在菜单中取消勾选 **Check for New Versions at Start**（启动时检查新版本；macOS 上在应用自己的菜单中，Windows 上在 **Options** 中），或者以环境变量 `BUSY_EMULATOR_NO_UPDATE_CHECK=1` 启动应用。
- **更新，在你点击 Update 时。** 应用会下载该版本的两个小文件 `update.json` 和 `update.json.sig`，然后下载本系统对应的文件（`busybar-emulator-mac-arm64.zip`、`busybar-emulator-mac-x64.zip` 或 `busybar-emulator-win-x64-setup.exe`，150 至 250 MB），下载地址为 `https://github.com/busy-app/busybar-emulator/releases/download/v<version>/`，跟随 GitHub 的重定向但仅限其自身主机（`objects.githubusercontent.com`、`release-assets.githubusercontent.com`），且仅走 HTTPS。请求携带同样的固定 `User-Agent`，别无其他。文件保存在数据文件夹的 `tmp/update-<version>/` 中，只有当清单（manifest）的签名是发布密钥（内置于应用中）、且文件的大小和 SHA-256 与清单一致时才会安装。在 macOS 上，新应用解压到已安装应用旁边的隐藏文件夹 `.busy-emulator-update-<version>` 中，旧应用保留在那里直到新应用成功启动一次。**Restart to update**（重启以更新）会再询问你一次；应用退出、放置新版本并打开它。更新本身不触碰你的数据文件夹；如果新版本有新的布局，它会把数据文件夹迁移过去。`busy-emulator update` 在你在应用对话框中确认后执行相同操作；`busy-emulator update --check` 只向 GitHub 询问最新版本，与启动时的检查相同。
- **无遥测，无崩溃报告。** 模拟器不向任何地方发送关于你或其使用情况的任何信息。关闭新版本检查后，应用本身不发出任何网络请求。

安装模拟器时会从 GitHub 下载它的文件：[install.md](install.md#下载什么-从哪里下载)。

## 磁盘上

| 内容 | macOS | Windows |
|---|---|---|
| 应用本体 | `/Applications/BUSY Bar Emulator.app` 或 `~/Applications/BUSY Bar Emulator.app` | `%LOCALAPPDATA%\Programs\BUSY Bar Emulator\`（内含 `uninstall.exe`）、开始菜单中的快捷方式，以及 Settings → Apps 中显示的条目，位于注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\app.busy.emulator` 下 |
| 数据文件夹 | `~/Library/Application Support/BUSY Bar Emulator/` | `%LOCALAPPDATA%\BUSY Bar Emulator\` |
| 命令行，应用每次启动时重写，位于仅你的用户可访问的文件夹中 | `~/.busy-emulator/bin/busy-emulator` | `%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe` 及其旁边的 `busy-emulator.launch` |
| macOS 为每个应用保存的偏好设置文件（系统对该应用自身的设置；模拟器不在其中存放自己的内容） | `~/Library/Preferences/app.busy.emulator.plist` | 无 |

数据文件夹内：

| | 内容 |
|---|---|
| `bar/<firmware>/ext/` | 模拟的收工牌的存储，每个固件一份（`bar/1.3.1/ext/`）：你安装的应用、它们的设置和数据。它在两次启动之间保留。收工牌自身的设置（音量、名称、时区）不保留：每次启动都是一台刚开箱的收工牌，上面装着你的应用。 |
| `install.json` | 应用及其命令行的位置。AI 代理读取它来找到命令行。 |
| `key` | 管理地址的服务器密钥：每次启动时新生成，仅你的用户可读，模拟器退出时（从其菜单退出或用 `busy-emulator quit`）删除。如果模拟器以其他方式被结束，该文件会保留到下次启动写入新密钥为止；旧密钥不再有任何应答。 |
| `set-aside/` | 仅在更新无法把文件夹迁移到新布局时出现（`logs/shell.log` 中会说明）：当时文件夹里的内容，原样未动。模拟器不会再读取它；不再需要时自行删除即可。 |
| `format`、`run/` | 文件夹的布局版本（更新的模拟器首次启动时会把旧文件夹迁移到自己的布局）；哪个进程在使用该文件夹、它的收工牌在哪里应答（`run/server.lock` 和 `run/emulator.json`，均在模拟器退出时删除），以及 `start` 与 `quit` 互相留下的两个小记号，使得 `start` 期间的 `quit` 不会留下仍在运行的东西。`run/build-lines.jsonl` 保存窗口按钮运行过的内容（构建、安装、启动、各项检查），供控制台和 `logs --kind build` 使用；每次启动时清空。 |
| `logs/shell.log` | 应用的日志，包含服务器打印的全部内容：最多约 2 MB（`shell.log.1` 保存前 1 MB）。 |
| `shell/` | 窗口自己的浏览器文件。 |
| `app-settings.json` | 应用自身的设置：是否检查新版本、上次询问的时间及结果，以及你是否回答过窗口的第一个问题（手动回答或由 AI 代理回答）。 |
| `captures/`、`mcp/screenshots/` | `record` 制作期间的短片（命令完成后会把它移到你指定的位置；遗留的短片 24 小时后删除）；MCP 服务器的 `screenshot` 在项目之外截取的截图，保留 7 天。 |
| `tools/`、`npm-cache/` | 模板的生成器和 npm 的缓存，供项目命令使用。 |
| `projects/trusted.json`、`projects/registry.json` | `create` 创建的项目文件夹，以及你在模拟器对话框中信任过的文件夹（`trust`）；模拟器所知的项目及其依赖的安装状态。 |
| `github/` | GitHub CLI 自己的状态、数据和缓存（`gh-state/`、`gh-data/`、`gh-cache/`）；`signed-in.json` 记录发布所用的账号和 GitHub CLI 之前使用的账号；`published.json` 记录应用为每个项目创建的仓库和 pull request。不含令牌：GitHub CLI 把它保存在系统的密码存储中（macOS 上的登录钥匙串，Windows 上的凭据管理器），其设置保留在你电脑上 GitHub CLI 惯用的位置——`~/.config/gh` 或 `%APPDATA%\GitHub CLI`。 |

在你的项目和你工作的文件夹中：

- 窗口中的"创建应用"（Create app）会在 `~/BUSY Bar projects`（Windows 上为 `%USERPROFILE%\BUSY Bar projects`）中创建项目文件夹，除非你另选 Location（位置）。
- `create` 按模板创建项目文件夹，如果你装有 git 还会在其中运行 `git init`。当你已登录 GitHub（在模拟器中或 GitHub CLI 中）且未给出 `--author` 时，它取你的 GitHub 登录名作为作者；否则取你的 git `user.name`；再否则取你在这台电脑上的账户名；然后把它写入 `package.json` 和应用的清单，并说明它这么做了。许多电脑共用的名字（"User"、"admin"）绝不会被采用：此时 `create` 会要求 `--author`。
- `build` 会添加 `node_modules/`（当它不存在时）和 `dist/<app id>.tgz`。在 Windows 上它还会修复 `node_modules/@busy-app/cli/dist/lib/fontMapsPlugin.js` 中的一行——busy-cli 0.6.0 的一个 bug，会让那里的每次构建失败。
- 窗口的"截图"（Screenshot）会把 `screenshots/front-<n>.png` 和 `back-<n>.png` 连同它们的 `@8x` 副本写入正在运行的应用所属的项目；对没有项目的应用，写入你在保存对话框中选择的位置。
- `screenshot` 在当前文件夹写入 `screenshots/front-<n>.png`（或 `back-<n>.png`），或写入 `--out` 指定的位置。没有 `--out` 时不替换任何已有文件。
- `record` 在当前文件夹写入 `media/clip-<n>.mp4`（或 `.gif`），或写入 `--out` 指定的位置。没有 `--out` 时不替换任何已有文件。
- `icon` 把应用的两个图标写入 `src/appmeta/`，已有的图标只有加 `--force` 才会替换。
- `check` 和 `submit` 在项目没有 `catalog.json` 时写入它——应用目录文案的空白表单；`submit` 还会写入 `submission/` 文件夹。`catalog-texts set` 把文案写入 `catalog.json`。
- 发布（窗口的"发布"（Publish），或 `publish`）会分别在你要求时写入：`catalog.json` 和清单中的应用名；`LICENSE`；`README.md`（只有通过 `--readme replace` 或 README 步骤提供，才会写入你自己的 README）；追加到 `.gitignore` 的行；截取或上传的截图及其放大副本存入 `screenshots/`，你移除的放入 `.busy/removed/`；`submission/`。已完成的步骤记录在 `.busy/publish.json`；`.busy/` 有自己的 `.gitignore`，使其不被 git 跟踪。
- 应用列表中的"删除"（Delete），或 `uninstall --delete-files`，会把项目文件夹移入废纸篓（Windows 上的回收站），你可以从那里恢复。没有东西被彻底删除。

模拟器不写入其他任何位置，不要求管理员权限，不修改 `PATH`，也不添加任何随电脑启动的项。macOS 和 Windows 自行保存的关于任何应用的信息（崩溃报告、最近使用的程序列表）不在此列出，也未被检查。

## 卸载

- Windows：**Settings → Apps → BUSY Bar Emulator → Uninstall**（设置 → 应用 → BUSY Bar Emulator → 卸载），或应用文件夹中的 `uninstall.exe`。它会退出模拟器并删除应用文件夹、快捷方式、"设置"中的条目、`%LOCALAPPDATA%\busy-emulator\` 以及安装程序的日志 `%TEMP%\busybar-emulator-setup.log`；删除数据文件夹 `%LOCALAPPDATA%\BUSY Bar Emulator\` 前会询问，除非你同意，否则保留它。
- macOS：退出模拟器，然后删除 `BUSY Bar Emulator.app`、文件夹 `~/.busy-emulator/`、文件 `~/Library/Preferences/app.busy.emulator.plist`，以及数据文件夹 `~/Library/Application Support/BUSY Bar Emulator/`。

具体步骤、供 AI 代理使用的静默卸载及其退出码见 [install.md](install.md#卸载)。删除数据文件夹也会删除模拟的收工牌上的应用。你的项目保留在原处。
