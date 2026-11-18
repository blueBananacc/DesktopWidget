# 故障排查

每条 `sgp-emulator` 命令都会说明出了什么问题、该怎么办；加 `--json` 时，回答里带有 `code` 和 `hint`。本页介绍命令本身无法告诉你的内容，以及你最常遇到的错误码。命令行程序位于 `%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe`；本页统一称其为 `sgp-emulator`。

## 所有系统通用

### `sgp-emulator: command not found`

命令行不在你的 `PATH` 上。本仓库的模拟器从源码检出运行：在检出目录里用 `node packages/server/cli/busy-emulator.mjs` 调用（后文记作 `<cli>`）。

### 端口 8640 被占用

模拟的收工牌要监听 `127.0.0.1:8640`，而另一个程序已经占用了它——多半是另一个模拟器实例，或你自己启动的某个服务。找到并停止它，然后在模拟器窗口中选择 **重试**：

```sh
lsof -nP -iTCP:8640 -sTCP:LISTEN
```

```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8640 -State Listen).OwningProcess
```

### 端口 8640 不可用

窗口提示该端口被保留。系统不让模拟器监听 `127.0.0.1:8640`：在 Windows 上，系统会为 Hyper-V、WSL 和 Docker 整段保留端口范围，安全软件也可能封锁某个端口。在命令提示符中列出被保留的范围：

```text
netsh int ipv4 show excludedportrange protocol=tcp
```

如果 8640 落在某个范围内，停止 Docker Desktop 和 WSL（`wsl --shutdown`），或重启电脑（保留范围会变化），然后在模拟器窗口中选择 **重试**。

### `not_running`

模拟器没在运行，或它的收工牌还没完成启动。在检出目录启动后端 `node packages/server/index.mjs`（它常驻占用终端），等收工牌应答后窗口在 `/sgp/emulator/` 打开。

### `blocked_network` 或 `blocked_file`

命令运行在 AI 代理的沙箱里，沙箱不让它访问 `127.0.0.1`（`blocked_network`）或模拟器的数据文件夹（`blocked_file`）。让你的代理在沙箱外运行 `sgp-emulator`，这样它才能在你的电脑上启动模拟器、构建并运行项目的代码。以 Claude Code 为例：当 Claude 请求在沙箱外运行该命令时批准它，或者在项目的 `.claude/settings.local.json` 中加入 `"sandbox": {"network": {"allowLocalBinding": true}}`。

### `untrusted_project`

构建一个项目会运行它文件夹里的代码：它的依赖、它的 npm 设置、它的构建配置。模拟器直接构建它自己的 `create` 创建的项目；其他任何文件夹（用 `npm create` 建的、克隆的、复制的）都要在你信任一次之后才会构建。只信任你愿意运行其代码的项目。

`sgp-emulator trust my-app` 会让模拟器在窗口里弹出对话框询问你。对话框会写明文件夹名；按钮是 **不信任** 和 **信任**。你或你的 AI 代理运行命令，但由你点击。没有别的途径能信任一个文件夹：命令行没有这样的选项（`--trust` 会回答 `trust_needs_person`），代理也不能替你回答。模拟器必须正在运行且开着窗口（`sgp-emulator start`）。命令会等你点击 120 秒（用 `--wait <秒数>` 可以等更久，最长 600）。

| 错误码 | 发生了什么 |
|---|---|
| `trust_refused` | 你选择了“不信任”。除非你发话，代理不应再次询问。 |
| `trust_refused_recently` | 你在不到 30 秒前刚选了“不信任”，模拟器暂时不会再就这个文件夹询问。 |
| `trust_no_answer` | 没人及时点击。重新运行该命令。 |
| `trust_refused_path` | 文件夹路径里有肉眼无法正常辨认的字符（不可见字符、换行、连续多个空格），模拟器不把它显示在询问里。提示会指出是哪个字符。重命名该文件夹。 |

你自己的项目在移动或重命名文件夹后同样会被拒绝：模拟器信任的是位于原位置的文件夹。提示会说 “it was moved or renamed since”，并给出原来的位置（JSON 中的 `"reason": "moved"` 和 `trusted_as`）。把文件夹移回去，或用同样的方式再信任一次。

### `settings_invalid`，或收工牌显示“Settings file is invalid.”

应用的 `src/appmeta/settings.json` 不是收工牌固件能接受的格式。`build`、`dev` 和 `run` 会指出是哪个字段、为什么（JSON 中的 `field` 和 `problem`），并给出一个最小合法的示例文件。常见原因：`fields` 写成了数组（它应是以各字段 id 为键的映射）；用了固件没有的类型（`select` 应为 `enum`）；`enum` 的 `options` 不是 `{ "value": …, "label": … }` 形式；`default` 不在选项中或超出 `min`、`max` 范围；字段缺少 `label`。格式见项目的 `AGENTS.md` 和[你的第一个应用](first-app.md)。

### `app_crashed`，或 `run` 后收工牌无显示

`run` 启动应用并观察一秒。`app_crashed` 表示应用脚本立刻因错误停止了；提示会带上错误的第一行。`sgp-emulator logs` 显示应用的控制台：它用 `console.log` 打印的内容、错误以及结束原因。修好脚本，再 `build` 并 `run`。

### `start_interrupted`

模拟器在它的收工牌就绪之前就退出了：启动过程中有人调用了 `quit`、有人关掉了它，或它失败了。在检出目录重新运行 `node packages/server/index.mjs`；如果它又自己退出，见下文“模拟器反复停止”。

### `no_dependencies`、`install_running`、`network_failed`、`network_stalled`、`tool_failed`

- `no_dependencies`：项目还没有 `node_modules`。先运行 `sgp-emulator build`，它会安装依赖。
- `install_running`：另一条命令（窗口里的“构建”按钮、另一个代理）正在安装这个项目的依赖。等它结束后再运行该命令。
- `network_failed`：npm 连不上 registry。检查你的连接，以及 `%USERPROFILE%\.npmrc` 里的 registry 和代理——如果你设置过的话。
- `network_stalled`：registry 45 秒没有应答（Wi-Fi 信号差、代理挂起连接等），模拟器于是终止了 npm，不让它再等上几分钟。之前 create 拉取过的包可以走 npm 缓存，无需联网。
- `tool_failed`：模板的生成器、npm 或 busy-cli 失败了。回答末尾附有该工具打印的内容和它的退出码：按它说的修。失败的 `build` 不会改变收工牌上已有的应用。

### 应用行上显示“Dependencies not installed”

项目已建好，但 npm 没能取到它的依赖包：那一行会写明原因（“no network”、“no answer from the npm registry”、“the install was stopped”）。**重试** 即可安装；电脑恢复联网后窗口也会自动再试。命令行里 `sgp-emulator build --dependencies-only` 效果相同。然后 **刷新** 把应用装到收工牌上。

### 应用被停止：“did not return for 2 s”

应用的 JavaScript 连续运行 2 秒没有返回——比如 `for (;;) {}` 或 `while (!ready) {}` 这样的循环——模拟器便停止了它，如同收工牌上长按 Back 会停止应用一样。`run` 回答 `app_crashed`，`sgp-emulator logs` 里有原因。改用 `setTimeout` 或 `await` 来等待，不要用循环：永不返回的循环。

### 收工牌卡死

有的应用会让收工牌不再响应按键：其 JavaScript 内存耗尽后监督程序发出的警告，或定格在不再变化的画面。真机收工牌上要同时按住 Back 和 Start；在这里按窗口中收工牌卡片上（背面屏幕下方）的 **重启收工牌**，或运行 `sgp-emulator restart-bar`（MCP 工具 `restart_bar`），它会等到收工牌重新应答。已安装的应用及其设置都会保留。如果应用启动后再次卡死，对它执行 `sgp-emulator uninstall` 并修复它。

### `10.0.4.20` 无应答

那是通过 USB 连接的收工牌的地址；模拟器没有。用 `sgp-emulator status` 打印的地址，默认是 `http://127.0.0.1:8640`；busy-cli 用 `--addr 127.0.0.1:8640`。API 文档在该地址的 `/docs/` 下。

### 收工牌上仍是我应用的旧版本

`build` 只负责打包，不改变收工牌。`run` 安装 `build` 的产物并启动它（单独的 `install` 只安装不启动）。如果应用正在运行时安装失败，先 `stop` 它。应用在启动时读取自己的设置：在本地网页里改过设置后，用那里的 **重启**。

### 我的应用访问不到我电脑上的服务

这是有意为之：在收工牌上，`localhost` 就是收工牌自己；而在模拟器里，同一地址会连到你自己的数据库和开发服务器。应用的控制台会说明请求被拒绝的原因。`sgp-emulator allow-local <port>` 会在模拟器的对话框里询问你；选择 **允许** 后，那个端口在模拟器退出前都可以访问：收工牌上的应用可以访问什么。

### 网页无法调用模拟器（`403`）

与收工牌不同，模拟器会拒绝其他网站的页面：谁可以调用模拟器。不带浏览器的程序（`busy-cli`、`curl`、脚本）不受影响，所以你自己的页面可以请你电脑上的某个程序代为发请求。桌面应用没有放行页面的设置；拒绝信息里提到的 `--allow-origin` 是从模拟器源码启动的服务端的选项。

### 模拟器反复停止，或没能启动

在窗口里选择 **重试**。再次失败的话，日志是数据文件夹里的 `logs/shell.log`（`%LOCALAPPDATA%\BUSY Bar Emulator\`）。带上这个文件报告此问题。

### 动画跳帧，或录出的短片中有跳帧

模拟的收工牌跟着你电脑的时钟走；当电脑把模拟器卡住超过半秒（高负载、睡眠、调试器），收工牌会跳过那段时间里没能画出的内容：电脑很忙时。关掉占资源的东西再录。真的收工牌不会这样。

### `record` 回答无法生成短片

`record` 需要模拟器在运行（否则报 `not_running`）。默认布局录制的是模拟器窗口：命令会把它带到前台，你关了的话还会重新打开。`--layout post`、`front` 和 `both` 不需要窗口。GIF 的帧数上限取决于 `--scale` 和 `--fps`，回答里会写怎样才放得下。服务端以 `--fast` 运行时不能录制短片。

### 发布到 GitHub：“GitHub CLI 请求访问你的仓库”

模拟器通过 GitHub CLI（`gh`，GitHub 官方出品，内置在应用里）登录 GitHub，GitHub 页面要求你授权的是 **GitHub CLI**，不是收工牌模拟器。GitHub CLI 每次都请求相同的权限：你的仓库（公开和私有）、你所在组织的成员资格和你的 gists。模拟器用它创建应用的公开仓库、fork 应用目录并发起拉取请求。令牌由 GitHub CLI 保存在系统的密码存储里，模拟器从不持有它。

这个登录属于这台电脑上的 GitHub CLI：其他程序，包括 AI 代理，也能使用它。模拟器的确认只覆盖它自己的命令；自己运行 `gh` 的程序不会被模拟器询问任何事。如果你不想要这样，在模拟器中退出登录时勾选“同时在此电脑上退出 GitHub CLI 登录”（如果 GitHub CLI 此前没有账号，它一开始就是勾选的），或者改用手动发布（`SUBMIT.md`）。

要收回这份授权：在“发布到 GitHub”中退出登录（如果该登录是模拟器建立的，勾选“同时在此电脑上退出 GitHub CLI 登录”），然后到 GitHub 设置里的 Authorized OAuth Apps 页下撤销 **GitHub CLI**。这会让此账号下所有地方的 GitHub CLI 都退出登录。

### 发布到 GitHub：“此电脑上的 GitHub CLI 已登录为 <login>”

模拟器通过 GitHub CLI 发布，与你电脑上的 GitHub CLI 共用账号。选择 **使用 <login>** 即用该账号发布；在模拟器里退出登录只是让模拟器忘掉它。**使用其他账号登录** 会给 GitHub CLI 添加一个账号并设为当前所用——你的终端里也一样。想换回去：在模拟器中退出并保留勾选“将 GitHub CLI 切换回原账号”，或运行 `gh auth switch`。

命令行上 `publish signin` 会回答 `choose_account`：加 `--use-existing` 或 `--new-account` 运行。

### 发布到 GitHub 看不到 GitHub CLI 的账号

模拟器在 GitHub CLI 的默认位置找它的设置：`%APPDATA%\GitHub CLI`。如果你用 `GH_CONFIG_DIR` 或 `XDG_CONFIG_HOME` 改过位置，模拟器不会跟随——它不读环境变量，而环境变量决定程序去哪里找设置，进而（通过 GitHub CLI 的设置）决定 GitHub CLI 带着你的令牌把请求发到哪里。改为在模拟器里用另一个账号登录，或把设置移回去。

### “系统的密码存储未能保存登录信息”

GitHub CLI 无法把令牌存进凭据管理器，而模拟器不允许它把令牌存成明文文件：于是会把该账号再从 GitHub CLI 退出。在凭据管理器中检查并解锁对应条目，然后重新登录。

## Windows

### Windows 防火墙询问收工牌模拟器

模拟器只监听 `127.0.0.1`，不需要防火墙规则，所以 Windows 不应询问。如果它问了，选 **取消**：模拟器照常工作。然后报告此问题，并说明你当时在做什么。

### 在 PowerShell、Git Bash 或 cmd 中运行命令行

Windows 上的代理在不同的 shell 里跑命令：Codex 和 Cursor 用 PowerShell，Claude Code 用 PowerShell 或 Git Bash。本仓库的模拟器从源码检出运行，命令行是检出目录里的 `busy-emulator.mjs`，统一用 `node` 调用（`<emu>` 换成你的检出目录，路径不含空格时三种 shell 写法相同）：

```sh
node <emu>/packages/server/cli/busy-emulator.mjs status
```

路径含空格时需要引号，每种 shell 写法不同。PowerShell 里以变量给出脚本路径时直接传给 `node` 即可：

```powershell
$cli = "<emu>/packages/server/cli/busy-emulator.mjs"
node $cli status
```

在 Git Bash 和 cmd 中：

```sh
node "<emu>/packages/server/cli/busy-emulator.mjs" status
```

```bat
node "<emu>\packages\server\cli\busy-emulator.mjs" status
```

在 Git Bash 里反斜杠是转义符：`C:\Users\you\…` 不加引号会丢掉反斜杠。`sgp-emulator help` 会按各 shell 需要的形式打印命令：一种写法在三个 shell 里都通用时只给一行。`--out` 的文件夹绝不能以 `\"` 结尾：PowerShell 会把这个引号传下去并吞掉该行剩下的部分。以 `/` 结尾或不带斜杠。

### 删除（或 `uninstall --delete-files`）仍保留文件夹

模拟器只把项目文件夹移到回收站，绝不彻底删除。当 Windows 无法为它提供回收站时——网络共享盘、可移动磁盘上，或命令运行在没有桌面的会话中（经 SSH）——它会在改动任何东西之前拒绝（`not_deletable`）。改用模拟器里的 **移除**（或不带 `--delete-files` 的 `uninstall`），然后想删的话自己动手删文件夹。

### 项目路径含英文字母以外的字符时 `build` 失败

busy-cli 用 Windows 自带的 `tar.exe` 打包应用，而 `tar.exe` 处理不了含系统代码页之外字符的路径（例如用户名或文件夹名中有西里尔、希腊或中文字符）。`build` 和 `dev` 会明确报错。把项目移到只含拉丁字母的路径下。这是 busy-cli 的一个 bug。

### `npm run build` 报 `Rolldown failed to resolve import`，或 `npm create @busy-app/app` 什么都没装

这两个都是 busy-tools 在 Windows 上的 bug（busy-cli 0.6.0 和 create-app 0.5.0）。`sgp-emulator create` 和 `sgp-emulator build` 已绕开它们；请用这两个命令代替 npm 脚本。

## 全部错误码（按字母排序）

回答中每个 `code` 的含义和应对方法。命令行的回答和窗口中发布相关的提示使用同一套错误码。上文有对应小节的错误码会链接过去。退出码：`usage` 和 `unknown_command` 为 2，其余一律为 1。发布步骤见窗口中的 Publish 向导。

### 创建与运行应用

| 错误码 | 发生了什么 | 怎么办 |
|---|---|---|
| `app_crashed` | 应用刚启动就因错误停止 | [run 后收工牌无显示](#app_crashed-或-run-后收工牌无显示) |
| `author_required` | `create` 没找到作者，只找到一个很多电脑通用的名字（“User”、“admin”），用它会让别人的应用得到相同的 id | 用 `--author` 给出你的 GitHub 登录名或你的名字，或先登录 GitHub |
| `bar_off` | 模拟的收工牌在窗口中处于关机，或电池耗尽 | 在窗口里开机，再试 |
| `blocked_file`、`blocked_network` | 代理的沙箱挡了路 | [沙箱](#blocked_network-或-blocked_file) |
| `build_failed`、`install_failed`、`run_failed` | 一轮 `dev` 在该阶段失败；收工牌保留上一个构建成功的版本 | 看输出，修好再保存 |
| `folder_not_empty` | `create` 需要新文件夹名，或空文件夹 | 给个没被占用的名字：`create` 自己建文件夹 |
| `icon_exists` | 项目已有图标，会保留 | 加 `--force` 替换 |
| `interrupted` | npm 或 busy-cli 没跑完就被中止 | 重新运行该命令 |
| `network_failed`、`network_stalled`、`no_dependencies`、`tool_failed` | npm 或 busy-cli 没完成它那份工作 | [项目的工具](#no_dependencies-install_running-network_failed-network_stalled-tool_failed) |
| `no_node_tools` | 这份模拟器缺少自带的 Node | 重装模拟器 |
| `no_settings` | 应用没有 `src/appmeta/settings.json` | 补一个：[你的第一个应用](first-app.md#每条命令的作用) |
| `no_typecheck` | 项目的 `package.json` 没有 typecheck 脚本 | 无需处理：模板项目自带 |
| `not_a_project` | 该文件夹不是应用项目，或不存在 | 在项目文件夹里运行，或指明文件夹 |
| `not_built` | 还没构建过 | 先 `build` |
| `not_installed`、`no_app_named` | 应用不在模拟的收工牌上 | 先 `run`，或用 `--app` 指明应用 |
| `not_running` | 模拟器没在运行 | [启动它](#not_running) |
| `package_too_large` | 包超过 100 MiB，大于收工牌能容纳的上限 | 别把大文件放进应用 |
| `picture_unreadable` | 图片做不了图标 | 用 PNG |
| `port_busy` | 另一个程序在监听 8640 端口 | [端口 8640 被占用](#端口-8640-被占用) |
| `settings_invalid` | `settings.json` 不是固件接受的格式 | [设置文件](#settings_invalid-或收工牌显示-settings-file-is-invalid) |
| `settings_refused` | 收工牌拒绝了某个值；回答里有原因 | 给一个该字段接受的值 |
| `start_failed`、`server_failed`、`start_interrupted`、`start_timeout` | 模拟器没能启动，或在启动中退出 | [模拟器反复停止](#模拟器反复停止-或没能启动) |
| `typecheck_failed` | 项目的 TypeScript 有错；每条都指明文件和行号 | 修好它们；`build` 不检查类型 |
| `untrusted_package`、`untrusted_project`、`trust_needs_person` | 该文件夹未被信任 | [信任它](#untrusted_project) |
| `trust_refused`、`trust_refused_recently`、`trust_no_answer`、`trust_refused_path` | 信任询问被拒、间隔太短再次询问、无人应答或未能询问 | [信任相关错误码](#untrusted_project) |
| `trust_busy`、`trust_unavailable` | 模拟器里还有另一个询问开着，或窗口无法询问 | 回答已开的询问或打开窗口，再试 |
| `watch_failed` | 系统无法为 `dev` 监视该文件夹 | 确认文件夹存在且可读；`dev --once` 不需要监视 |

### 截图与短片

| 错误码 | 发生了什么 | 怎么办 |
|---|---|---|
| `catalog_check` | 截图已保存，但应用目录不收 | 让应用显示在屏幕上重新截；回答里说了原因 |
| `encode_failed`、`record_failed` | 短片没能生成 | [record 失败时](#record-回答无法生成短片) |
| `fast_mode` | 模拟器比收工牌跑得快，短片会不对 | 不带 `--fast` 启动 |
| `record_busy` | 另一个短片正在录制 | 等它录完再录 |
| `screen_failed` | 收工牌没给出画面帧 | 再试；反复出现就[报告](#报告问题) |
| `window_hidden` | 模拟器窗口被关闭或隐藏，无法录制也无法询问 | 打开窗口，或用 `--layout post` 录 |

### 应用目录准备（第 1 阶段）

| 错误码 | 发生了什么 | 怎么办 |
|---|---|---|
| `bad_name` | 应用目录不接受应用名，或 GitHub 不接受仓库名 | 应用名：最多 32 个字符，拉丁字母、数字和少量符号。仓库名：字母、数字、`.`、`-`、`_` |
| `check_failed` | 应用目录的部分检查未通过；什么都没写入 | 每条失败都指明步骤和要改什么。改好后重新打包 |
| `details_unreadable` | `catalog.json` 不是 JSON | 修好该文件，或在“应用信息”里重写文案 |
| `no_author` | LICENSE 里无人可署名 | 写上版权人（`--author "Your Name"`） |
| `no_manifest` | 项目没有 `src/appmeta/manifest.json` | 在应用的项目里运行 |
| `not_a_license`、`not_found` | 许可证文件不是 200 KB 以内的纯文本，或读不了 | 选许可证的文本文件 |
| `not_screenshots` | 没有文件被采用 | 正面截图是 72×16 的 PNG，背面是 160×80，或等比放大图 |
| `readme_incomplete` | README 还没写 | 在 README 步骤里写，至少一行“使用方法” |
| `submission_exists` | `submission/` 已存在且不是模拟器建的 | 把它挪走，再打包 |
| `write_failed` | 文件写不进去 | 确认项目文件夹可写、磁盘没满 |

### 发布到 GitHub 并发送到应用目录（第 2 阶段）

| 错误码 | 发生了什么 | 怎么办 |
|---|---|---|
| `account_gone` | GitHub CLI 不再有该账号的登录 | 重新选择账号 |
| `bad_answer` | GitHub CLI 给出了不属于 GitHub 的代码或页面 | 稍后再试 |
| `bad_catalog` | `--catalog` 的值不是 GitHub 仓库 | 写成 `owner/name`，或它在 GitHub 上的地址 |
| `busy` | 有上传正在进行 | 等它，或取消 |
| `canceled`、`upload_canceled` | 登录或上传被中止；仓库保持原样 | 想发的时候再开始 |
| `catalog_closed` | 看不到应用目录仓库（是私有的，或不存在） | 核对地址，稍后再试，或[手动发送](first-app.md#手动发送) |
| `catalog_empty` | 应用目录仓库还没有文件 | 稍后再试，或手动发送 |
| `changed_outside`、`signed_in_other` | GitHub CLI 在模拟器之外被切到了别的账号 | 重新登录并选好用来发布的账号 |
| `changed_since_upload` | 项目发布之后又有改动 | 再发布到 GitHub 一次，然后发送 |
| `checklist_too_long` | 应用目录的 checklist 超过 50 项，或单项超过 500 字符，模拟器不显示也不发送 | 确认是那个应用目录，或手动发送（SUBMIT.md） |
| `choose_account` | 这台电脑上的 GitHub CLI 已有账号 | [选一个](#发布到-github-此电脑上的-github-cli-已登录为)，或用别的账号登录 |
| `denied` | 登录在 GitHub 上被取消了 | 想发布时再登录 |
| `expired` | 验证码在输入前过期了 | 取新码到 GitHub 上输入 |
| `forbidden` | GitHub 拒绝了 | 退出再登录，然后重试 |
| `fork_not_allowed` | 你的账号不能 fork 该应用目录 | 手动发送 |
| `fork_pending` | GitHub 还在生成你的应用目录副本 | 过一分钟再试 |
| `github_unavailable` | 命令行联系不上模拟器应用 | 打开模拟器，再试 |
| `keyring_refused` | 系统的密码存储没能保存登录信息 | [密码存储](#系统的密码存储未能保存登录信息) |
| `name_taken` | 你有同名仓库，而这个项目没发到那里 | 换个名字；会提供一个可用的 |
| `network` | 连不上 GitHub | 检查连接，再试 |
| `no_ai_choice` | 没说明 AI 的使用情况 | 选“未使用 AI”“部分由 AI 辅助”或“完全由 AI 生成” |
| `no_existing` | 这台电脑的 GitHub CLI 没有该账号 | 用其他账号登录 |
| `no_files`、`no_license` | 没有可发布的内容，或还没有许可证 | 看“仓库文件”；选一个许可证 |
| `no_version` | manifest 缺少应用目录要的 id 或 version | 修好 `src/appmeta/manifest.json`，再构建打包 |
| `not_configured` | 此构建没有 GitHub CLI | 手动发送 |
| `not_landed` | 发出的文件 GitHub 没存下 | 重新发布 |
| `not_packaged` | 还没有应用目录条目 | 先构建打包 |
| `not_pushed` | 应用还没从这台电脑上发到 GitHub | 先发布到 GitHub |
| `not_signed_in`、`not_signing_in`、`signing_in`、`unauthorized` | 未登录、已有登录在进行中，或 GitHub 不再认它 | 登录 GitHub，或完成进行中的登录 |
| `not_ticked` | 应用目录的 checklist 没有逐项勾完（可选项可以不勾）；什么都没发出 | 把属实的项都勾上 |
| `other_catalog` | 应用目录不是官方的那个（或其开发副本），而你没确认它的名字 | 发给官方应用目录仓库，或在模拟器询问时按名字确认该应用目录 |
| `outside`、`bad_path`、`too_large`、`too_many_files` | 文件在项目之外、文件名 GitHub 不接受、超过 50 MB，或文件太多 | 在“仓库文件”里排除它，或改名 |
| `rate_limited` | 触到 GitHub 的请求频率上限 | 按提示说的时间再试 |
| `refused` | 你选了取消；什么都没发出 | 除非你发话，代理不应再次询问 |
| `secrets` | 某文件疑似密钥或个人数据，会被发布出去 | 在“仓库文件”里排除它，或在那里选“仍然发布” |
| `unprocessable` | GitHub 没接受 | 稍后再试；还是这样就手动发送 |

### 其他

| 错误码 | 发生了什么 | 怎么办 |
|---|---|---|
| `internal` | 模拟器没预料到的失败 | [报告](#报告问题)，附上完整回答 |
| `log_failed`、`bar_failed`、`press_failed`、`time_failed`、`settings_failed`、`restart_failed`、`uninstall_failed` | 模拟的收工牌没有按预期应答 | 再试；反复出现就退出模拟器再启动 |
| `no_management`、`person_only`、`port_refused` | `allow-local` 无法询问你，或端口是模拟器自己的 | [访问电脑上的服务](#我的应用访问不到我电脑上的服务) |
| `no_project_folder`、`several_folders`、`trash_failed`、`not_deletable` | `uninstall --delete-files` 移不走项目文件夹 | [删除保留文件夹](#删除-或-uninstall-delete-files-仍保留文件夹) |
| `quit_failed`、`quit_timeout` | 让模拟器退出它没退 | 在它的菜单里选 **退出** |
| `tool_timeout` | 某个 MCP 工具超时被中止 | 再跑一次 |
| `unknown_command`、`usage` | 没有此命令，或选项不对 | `sgp-emulator help` 列出全部命令和选项 |

## 报告问题

在模拟器仓库的 issues 区开一个 issue。写入：

- `sgp-emulator version` 的输出（模拟器版本、它的固件和它使用的工具；代理用 `--json`），以及你的 Windows 版本；
- 你做了什么、预期什么、实际发生了什么：命令及其完整回答（如果是代理运行的，带 `--json`），或你在窗口里点了什么；
- 与收工牌显示内容有关时，一张截图（`sgp-emulator screenshot --scale 8`）或一段短片（`sgp-emulator record`）；
- 模拟器停止或没能启动时，数据文件夹里的 `logs/shell.log`（`%LOCALAPPDATA%\BUSY Bar Emulator\`）；
- 如果可以分享，能复现问题的最小项目。

日志和回答会写出你工作用的文件夹名，也就是你的用户名：附上前先过一遍。如果你的应用在收工牌上表现不同，请说明并附上收工牌的固件版本：以收工牌为准。
