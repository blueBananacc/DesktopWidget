# 你在模拟收工牌上的第一个应用

从装好的模拟器，到在它里面的收工牌上运行你自己的应用并截一张图。这里的一切都运行在模拟器内置的
Node 里：你自己不需要 Node，也不需要 npm。`<cli>` 是命令行的路径：
macOS 上是 `~/.busy-emulator/bin/busy-emulator`，Windows 上是
`%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe`
（安装过程会把它打印成 `cli=<path>`）。在 Windows 上要写成带正斜杠、不带引号的形式，
`C:/Users/you/AppData/Local/busy-emulator/bin/busy-emulator.exe`，它在 PowerShell、Git Bash 和 cmd 里都一样运行；
路径含空格时需要加引号，在 PowerShell 里引号前还要加 `&`。

每条命令都接受 `--json`，然后输出一行：`{"ok":true,…}` 或 `{"ok":false,"code":…,"message":…,"hint":…}`。
hint 会指出下一步该运行哪条命令。

## 在窗口中

**Create app**（在 Apps 列表顶部，或 File → New App…）会在窗口上方打开，提供这些开始方式：

- **Templates**：官方模板，或三个示例之一，每个都带一张图；然后是应用的名字和
  Location——项目要放进去的文件夹（除非你改它，默认是 `~/BUSY Bar projects`）。
- **Empty app**：名字、简短描述、分类、图标（由名字生成的字母、手绘的像素
  图标，或你自己的 8×8 和 11×11 PNG）以及 Location。你输入时，各字段会按应用目录的规则即时检查。
- **Open existing**：这台电脑上已有的应用项目；模拟器会先问你是否信任它的文件夹。
- **Import from GitHub**：github.com 上的一个仓库，下载到新文件夹并作为项目打开。
  如果仓库里没有应用项目、但最新 release 里有应用的 `.tgz`，会提供 **Install the
  release package** 选项，流程同下。
- **Install a package (.tgz)**：别人构建好的应用包（`busy-cli build` 就能做出一个）。
  模拟器读它的 manifest，并按收工牌的方式检查，然后给你看应用的名字、id、版本和
  文件来源，只有当你选择 Install 时才安装并启动它。它在 Apps 里列为从包安装，
  没有项目文件夹。在终端里：`busy-emulator install <file.tgz> --check` 只查看
  包；`busy-emulator install <file.tgz>` 从被你信任过的文件夹中安装一个。

Create 会像 `create` 命令一样创建项目、构建它、放上收工牌并启动。然后编辑 `src/main.ts`，
按下应用的 **Refresh**（应用停止时是 **Run**：两者都会先构建）。如果你填的名字已被占用，
它会提示，并给出 Open it 让你跳到那个应用。

Apps 列表的每一行都有 Start 或 Stop 按钮和一个菜单（右键，或行上的 More 按钮）：Show in
Finder（Windows 上是 Show in Explorer）和 **Delete…**——它会把应用从模拟器上移除并忘掉它的项目；
如果你选择 Remove and delete its files，还会把它的文件夹移到废纸篓（Windows 上是回收站）。命令行的
`uninstall` 效果相同。

没有网络时，Create app 仍会创建项目：它的行会显示 "Dependencies not installed: no network" 并带
**Retry**，等电脑联网后自行重试。如果过去某次 create 已经取回过这些包，项目会由 npm 的缓存建成，
不需要网络。

## 命令流程

```text
<cli> start                                  # the emulator, if it is not running
<cli> create my-app                          # a project from the official template, dependencies installed
cd my-app
                                             # edit src/main.ts: what the app draws
<cli> build                                  # dist/<app id>.tgz
<cli> run                                    # installs what build made and starts it; says whether it runs
<cli> logs                                   # the app's console.log output and errors, when the BUSY Bar shows nothing
<cli> screenshot --scale 8                   # screenshots/front-1.png (72×16) and front-1@8x.png, enlarged, to look at
<cli> record                                 # media/clip-1.mp4: 5 s of the app on the BUSY Bar, a video to post
<cli> press ok                               # a button: ok, start, back; up and down turn the wheel one click
<cli> time advance 25m                       # 25 minutes pass at once: the app's timers that were due fire now
<cli> settings set hour24=false --restart    # change a setting of the app and start it again with it
<cli> typecheck                              # the project's TypeScript check
<cli> stop                                   # the app stops; the emulator stays
```

改动之后：先 `build`，再 `run`。项目类命令也可以直接带上项目文件夹（`<cli> build my-app`、
`<cli> run "my folder/my app"`），所以不需要 `cd`。单独的 `install` 只把构建好的包放上收工牌而不启动它。
`screenshot` 写进你调用它时所在文件夹的 `screenshots/`，不会覆盖已有文件；
`--back` 截背面屏幕（160×80），`--out <file.png>` 指定文件名。

## 开发循环：`dev`

一条命令代替每次编辑后的 `build` 和 `run`：

```text
<cli> dev                                    # build, install, start; then again on every save, until Ctrl+C
<cli> dev --once                             # one round, then it ends: exit code 0 the app runs, 1 it does not
```

`dev` 监视项目的文件（不含 `dist/`、`node_modules/`、`screenshots/`、`media/` 以及以点开头的名字）。
你一保存，它就重新构建、安装并启动应用：模板项目约 0.5 秒。每一轮打印一行耗时，
并随时带出应用的控制台输出：应用用 `console.log` 打印的内容，以及运行时的错误。

```text
12:08:00  watch    /Users/you/my-app (app.your_name.my-app) for the emulated BUSY Bar at 127.0.0.1:8640. Ctrl+C stops watching; the app stays on the BUSY Bar.
12:08:00  build    the project as it is
12:08:01  ready    app.your_name.my-app was started on the BUSY Bar (0.56 s: build 0.24 s, install 0.20 s, start 0.12 s)
12:08:01  log      hello from my app
12:08:03  build    src/main.ts changed
12:08:03  failed   busy-cli build failed with exit code 1:
…                  (what busy-cli says: the file, the line, the error)
12:08:03  watch    still watching: save a file to try again. The app on the BUSY Bar is as it was.
12:08:09  build    src/main.ts changed
12:08:10  ready    app.your_name.my-app was started on the BUSY Bar (0.43 s: build 0.16 s, install 0.17 s, start 0.11 s)
12:08:10  error    [JsRunner] Error running script: ReferenceError: draw is not defined
12:08:10  exited   the app stopped: error running main.js: Error running script: ReferenceError: draw is not defined
```

- 构建失败不会打断循环，收工牌上保留最后一次构建成功的版本。修好文件再保存即可。
- 一轮进行中发生的保存会在这一轮之后再补一轮；各轮永不重叠。
- Ctrl+C 停的是监视，不是应用。`<cli> stop` 才停应用。
- 模拟器必须在运行（否则报 `not_running`：`<cli> start`）。模拟器退出时，`dev` 也随之结束。
- 它也接受项目文件夹参数：`<cli> dev my-app`。

**写给 agent。** `<cli> dev --json` 为每个事件输出一行 JSON，每行都带 `event` 和 `time`：
`watching`、`build_started`（`changed`：改动的文件）、`build_failed`（`output`：busy-cli 的文本；
还有 `install_failed`、`run_failed`）、`installed`、`running`（本轮各阶段耗时，单位 `ms`）、`app_log`
（`level`、`text`）、`app_error`（`text`）、`app_exited`（`reason`、`crashed`）。保存之后，
一直读到 `running` 或某个 `…_failed` 事件为止。启动即失败的应用会先给出 `running`，
然后是 `app_error` 和带 `"crashed":true` 的 `app_exited`。

不能保持进程常驻的 agent 可以在每次编辑后用 `<cli> dev --once --json`：同样的一轮事件行，
最后一行是结果。`{"ok":true,…,"running":true}` 且退出码 0：应用在运行。
`{"ok":false,"code":"tool_failed",…}`：构建失败，`output` 是 busy-cli 的文本。
`{"ok":false,"code":"app_crashed",…}`：应用刚启动就停了，`error` 是运行时的第一个错误，
`log` 是应用打印的内容。

## 每条命令的作用

- **`create` 建文件夹。** 它接受一个未被占用的名字，或一个空文件夹：`<cli> create my-app`。
  `<cli> create .` 只在空文件夹里有效。在已有文件的文件夹中（比如里面有 `AGENTS.md`），
  返回 `folder_not_empty`，并说明挡路的是什么、可改用哪条命令。
- **`create` 的作者取自 `--author "Your Name"`，否则取 git 的 `user.name`，再否则取你的账户名。**
  你没指定时，返回结果会说明它用了哪个作者（JSON 里的 `author`）以及去哪里改：
  `package.json` 和 `src/appmeta/manifest.json` 里的 `"author"`。应用的 id 由作者名和文件夹生成，
  形如 `app.your_name.my-app`；`--id` 可指定别的。
- **`create` 需要 npm registry。** 模板和项目的依赖都从那里来：项目里约 60 MB，
  模拟器数据文件夹里的 npm 缓存约 110 MB。`build` 只在依赖缺失时才需要 registry；
  `<cli> build --dependencies-only` 只装依赖、不构建。registry 无响应时，
  npm 会在 45 秒后停止并报 `network_stalled`，而不是白等几分钟；没装上依赖而建成的项目
  会在列表中注明原因。在无网络的沙箱中返回 `blocked_network`。
- **只有 `start` 启动模拟器。** `install`、`run`、`stop`、`dev`、`logs`、`screenshot`、`record`、`press`、
  `settings`、`uninstall` 和 `trust` 在模拟器未运行时都回答 `not_running`：先运行 `<cli> start`。
- **`run` 安装构建好的包、启动应用并观察片刻。** 在第一次 `build` 之前它回答 `not_built`。
  `"running": true` 表示应用正在运行。脚本一启动就失败的应用返回 `ok: false`、错误码 `app_crashed`、
  退出码 1，以及错误的第一行：

  ```json
  {"ok":false,"command":"run","code":"app_crashed","message":"app.your_name.my-app started on the emulated BUSY Bar and stopped at once: [JsRunner] Error running script: ReferenceError: draw is not defined","hint":"Its console and the error are in <cli> logs. Fix the script, then <cli> build and <cli> run again.","running":false}
  ```

  返回结果还带 `error`、`exited`、`log` 和 busy-cli 的 `output`。脚本无错跑到结尾、
  且没有留下任何在跑的东西时，返回 `ok` 并带 `"running": false, "exited": "finished"`：
  收工牌回到 APPS 菜单里该应用的卡片。
- **`logs` 显示应用的控制台。** 应用用 `console.log` 和 `console.error` 打印的内容、
  运行时的错误和应用结束的原因，针对你调用它时所在文件夹对应的应用（连同收工牌自己的行；
  `--app <id>` 指定别的应用，`--all` 显示所有应用的，`--since-run` 只看最近一次启动的）：最新 50
  行（`--lines 200` 看更多，`--json` 得 `{"lines":[{"time":…,"kind":…,"text":…}]}`）：

  ```text
  12:04:31  app     Launch app.your_name.my-app (heap 128 KiB)
  12:04:31  log     app.your_name.my-app log: hello from my app
  12:04:31  error   app.your_name.my-app [JsRunner] Error running script: ReferenceError: draw is not defined
  12:04:31  app     App app.your_name.my-app exited: error running main.js: …
  ```

  `<cli> logs --follow` 持续打印新行，直到你停掉它。模拟器运行期间保留最新 500 行。
  同样的行、连同模拟器输出的其他一切，都在它数据文件夹的 `logs/shell.log` 里
  （macOS `~/Library/Application Support/BUSY Bar Emulator/`，Windows `%LOCALAPPDATA%\BUSY Bar Emulator\`）。

  `--kind` 像窗口 Console 的过滤器那样选行：`console`（应用打印的、警告和错误）、
  `lifecycle`（installed、launched、exited）、`build`（窗口按钮跑过的：构建、安装、启动、
  各项检查）和 `system`（收工牌自己的行）中的几种，用逗号分隔。不带它时得到除 `build`
  之外的所有种类。`--since <ms>` 只显示某个时刻之后的行，按电脑时钟的 Unix 毫秒计。

  ```text
  <cli> logs --kind console,lifecycle --since-run    # what the app printed and its life, from its latest launch
  <cli> logs --all --kind build --lines 200          # what the window's buttons ran, for every app
  ```

  在模拟器窗口里，Console 的 "Open in Terminal" 按钮（Windows 上是 "Open in cmd"）在系统终端里
  打开这份日志，目录是你的项目文件夹，沿用窗口中开着的过滤器和上次 Clear 以来的范围。
- **`typecheck` 查类型；`build` 不查。** 它指出每个错误的文件和行（`typecheck_failed`，
  JSON 里带 `errors`）。
- **项目的 `AGENTS.md` 有一节专给模拟器的内容。** `create` 把它写在
  `<!-- busy-emulator:begin -->` 和 `<!-- busy-emulator:end -->` 之间：该用的命令、
  `settings.json` 的格式、怎么读设置。它还会改写那里模板留下的 `npm run …` 行。
  项目的 `README.md` 是模板原文，仍在讲 `npm run …` 和通过 USB 连接的收工牌：

  | 模板 README 里写的 | 改用 |
  |---|---|
  | `npm run build` | `<cli> build` |
  | `npm run app:install` | `<cli> install` |
  | `npm run app:run` | `<cli> run`（它会先安装） |
  | `npm run app:stop` | `<cli> stop` |
  | `npm run typecheck` | `<cli> typecheck` |

- **设置在新项目里就能用。** 在 `src/appmeta/settings.json` 里描述它们；收工牌会画出
  它们的界面（APPS → 应用卡片 → Setup）和本地网页里的设置页。最小的合法文件：

  ```json
  {"format_version":1,"version":1,"fields":{"hour24":{"type":"boolean","label":"24-hour clock","default":true}}}
  ```

  `fields` 是以各字段 id 为键的映射，不是列表。每个字段都有 `type`（`boolean`、`integer`、`string`、
  `enum`、`color`、`time`、`geolocation`、`group`）、`label` 和 `default`。`build`、`dev` 和 `run`
  会像固件一样检查这个文件并指出有问题的字段（`settings_invalid`：`field`、`problem`）；
  真收工牌只会显示 "Settings file is invalid."。应用用 `@shared/settings` 的 `loadValues()` 读这些值：

  ```ts
  import { loadValues } from "@shared/settings";

  const values = (await loadValues()) ?? {};
  const hour24 = values.hour24 !== false;
  ```

  `create` 会把模板的助手换成另一个实现——模板自带的 `loadValues()` 在已发布的固件上
  总是返回 `null`——新实现向收工牌请求（`GET /api/apps/settings`）。收工牌返回每个字段：
  已保存的值，或文件里的 `default`。应用在询问时才读设置，所以要在启动时问。应用不能写设置。
- **`settings` 读取并修改应用的设置**，如同收工牌的网页那样：`<cli> settings get`、
  `<cli> settings set minutes=45 theme=blue --restart`（组里的字段写作 `group.field=value`）、
  `<cli> settings reset`。`--restart` 会重启应用让它重新读取，并说明它是否在运行。
  在项目文件夹之外，要指明文件夹或应用：`<cli> settings get my-app`、
  `<cli> settings get --app app.your_name.my-app`。收工牌拒收的值返回 `settings_refused`，并附原因。
- **`press` 按收工牌的按键**：`<cli> press ok`、`<cli> press start`、`<cli> press back`。
  `<cli> press up` 和 `<cli> press down` 把滚轮转一格（应用收到的键是 `encoder`）。
  `--times 3` 重复按；`<cli> press start --hold 800` 按住按键 800 毫秒，即长按。
  然后看效果：`<cli> screenshot --scale 8`、`<cli> logs`。
- **`time` 拨动收工牌的时钟**，这样 25 分钟的定时器、整点变化之类不用干等就能验证。
  `<cli> time advance 25m`（也可以是 `90s`、`2h`、`1h30m`）让时间一下子流逝：
  收工牌的时钟和应用的 `Date.now()` 一起前进，其间到点的每个 `setTimeout` 和 `setInterval`
  立即触发（interval 只触发一次），固件的 `countdown` 元素和动画也随之推进；网络请求不加速。
  `<cli> time set 14:59:50` 像收工牌自己的 API 那样设置时钟，不催促定时器；
  `<cli> time reset` 把它还原成这台电脑的时间；`<cli> time` 显示当前时间。
- **项目就放在 `create` 建它的地方。** 模拟器构建它创建的、或你信任过的项目，
  信任的是那个位置上的文件夹。被移动或改名的项目返回 `untrusted_project`，
  带 `"reason": "moved"` 和 `trusted_as` 里的旧位置：移回去，或重新信任。
  拷贝、克隆、或用 `npm create` 做的项目，是模拟器不认识的文件夹（`"reason": "unknown_folder"`）。
  `<cli> trust <folder>` 让模拟器在窗口里弹对话框问你；你在那里的点击是唯一能让文件夹受信的途径。
  该命令最多等 120 秒（`--wait <seconds>`，上限 600），且需要模拟器在运行。
  其余见[故障排查](troubleshooting.md#untrusted_project)。
- **`uninstall` 把应用从模拟器上拿掉。** `<cli> uninstall app.your_name.my-app`
  （或项目文件夹，`<cli> uninstall ./my-app`）停掉应用、把它从模拟收工牌上移除并忘掉它的项目；
  文件夹保留。`--delete-files` 还会把项目文件夹移到废纸篓（Windows 上是回收站）。
- **紧跟 `start` 的 `quit` 什么都不留。** `start` 还在等待时到来的 `quit`，
  会让应用一起来就被结束，那个 `start` 回答 `start_interrupted`。

## 从示例开始

模拟器自带三个做完的小应用。每个都是按模板结构来的完整项目：应用、设置页、两枚图标，
以及带两块屏效果图的 README。从其中一个开始你自己的应用，而不是模板的 "Hello"。

```text
<cli> create --examples                               # the examples, a line each
<cli> create my-app --example focus-timer             # your project, made from one; then build and run as above
```

| 示例 | 它在收工牌上显示什么 | 能学到什么 |
| --- | --- | --- |
| `focus-timer` | 一棵随专注生长的树，你放弃就枯萎，完成就汇入森林 | 每种状态一段的动画、固件驱动的倒计时、一个定时器、`localStorage` |
| `meeting-cost` | 一摞着火的钞票，和会议已经烧掉的钱数，每秒上涨 | 每拍只更新两个小元素的计数器、用滚轮改数字、字体没有字形时用图片 |
| `status-board` | 给一个应答 JSON 的地址做心跳：绿色脉动，或一条红色平线加原因 | `fetch` 的各种失败都写上屏、超时、小应答、收工牌的灯 |

`create --example` 像 `create` 一贯那样建项目——同样的由作者和文件夹生成 id，
同样的 `--author`、`--id`、`--name` 和 `--description`——然后把示例的应用放进模板应用的位置。
项目的 `README.md` 是示例自带的：它显示什么、怎么操控、每个设置改什么、以及它是怎么做出来的。

这些示例的共同点——因为收工牌有这样的要求：

- **固件负责动画。** 收工牌用 JavaScript 画一整个 72×16 帧，大约每秒 3.5 次。
  示例里的动效放在 `.anim` 文件和 `countdown` 元素里，由固件自己播放；
  应用只说放哪一段，并且只发送变化了的元素（`shared/screen.ts`）。
- **能改变应用行为的设置页。** 收工牌没有键盘：一切都在它的网页上、Apps 下面设置。
  `src/appmeta/settings.json` 描述字段；应用在启动时用收工牌的 HTTP API 读一次保存的值
  （`shared/settings.ts`：模板自带的 `loadValues()` 读的是固件 1.3.1 没有的全局量），
  保存之后页面上会出现 Restart。
- **两块屏。** 正面屏（72×16，彩色）朝向房间；背面屏（160×80，灰度）朝向桌前的人，
  说明各操控键的作用。带 `display: "back"` 的元素去那里。
- **96 KiB 堆**，在 manifest 里设置（`heap_size_kib`）：即收工牌从命令行启动应用时给的大小。
  应用超出堆时模拟器会结束它，和收工牌一样。

## 网络与内存

要从互联网取数据展示的应用，会先撞上收工牌的限制。模拟器发请求的方式和收工牌固件一样，
所以也会撞上它们。2026 年 11 月 12 日用六个小应用对公共 API
（Open-Meteo、GitHub 状态页、Frankfurter、BBC 的 RSS、httpbin）和这台电脑上的一个服务实测：

- **请求小端点，只取你要显示的字段。** 应用的堆默认 128 KiB。`res.json()` 大约能在其中
  解析 70 KiB 的 JSON，`res.text()` 约 120 KiB 文本；更大的响应会让应用崩溃
  （"JS heap overflow"），收工牌上则是重启。GitHub 的 `incidents.json`（290 KiB）会把它压垮；
  `status.json`（200 字节）没事。用 API 自带的过滤：`?fields=`，或 Open-Meteo 的
  `current=temperature_2m`（320 字节），而不是 16 天逐小时预报。manifest 里的 `heap_size_kib`
  可把堆抬到 512 KiB，那时大约装得下 275 KiB 的 JSON。
- **大响应分块读。** `res.body.getReader()` 让响应体随到随取，一次几千字节；
  每块只留你要的，或用 `indexOf` 和 `slice` 把需要的文本切出来。没有 `TextDecoder`：
  对 ASCII，`String.fromCharCode(...bytes)` 能把一块转成文本。
- **写最终地址。** 收工牌不跟随重定向：`http://feeds.bbci.co.uk/news/rss.xml` 回了 302，
  应用拿到空响应体；`api.frankfurter.app` 回了 301，`res.json()` 失败。
  写重定向指向的那个 `https://` 地址。模拟器的日志会指出它。
- **5 秒无数据就结束请求**，报 `"Inactivity timeout"`，从请求发起时开始计——所以响应前
  先思考半天的服务器在收工牌上会失败。流读到一半时 reader 不抛错：
  `reader.read()` 返回 `{ done: true, value: "Inactivity timeout" }`，
  所以 `done` 提前到来时要检查 `value`。
- **HTTPS 在收工牌上约 1.5 秒**，大头是收工牌处理器上的 TLS 握手；纯 HTTP 约 0.1 秒。
  测试应用里每个 https 请求都是 1.43 秒，和收工牌一致。刷新不要比数据变化更勤：
  状态每分钟、天气每 15 分钟、汇率每小时。
- **证书。** 收工牌信任其固件内置清单里的证书机构（Mozilla，2026 年 10 月），模拟器同样。
  证书链落在清单之外的根上的站点，会报 `"Failed to establish TLS connection"` 失败。
- **你的电脑不是收工牌的。** 在收工牌上 `localhost` 是收工牌自己，
  所以发给你电脑上服务的请求会被拒。测试时放行它的端口：`<cli> allow-local 8080`。

失败的请求，或收工牌不会按你预期处理的应答，都会在 `<cli> logs` 里得到模拟器的一行说明：
地址、发生了什么、应用看到了什么。收工牌什么都不会说；见
[日志会说什么](differences.md#日志会记录应用的哪些错误)。

## 给帖子录一段视频

给应用发帖时，配一小段视频很方便。在窗口里，按顶栏的 **Record**，选 Window、
Post（1080×1920）或 Front display；再按一次停止，Save 对话框会问 MP4 存哪。
2 分钟后它会自己停。从命令行：先跑起应用，然后：

```text
<cli> record                                 # media/clip-1.mp4: 5 s of the emulator's window, as you see it
<cli> record --seconds 10                    # longer: up to 120 s
<cli> record --layout post                   # 1080×1920: the BUSY Bar alone, for a vertical post
<cli> record --gif                           # media/clip-1.gif: the front display, for places that take no video
```

默认录的是模拟器的整个窗口，像它的屏幕录像：收工牌、按键、背面屏、Apps 列表和 Console，
录制中怎么变就怎么录。录制时在窗口里点击、转滚轮、按 Start（或让 agent 跑 `<cli> press start`）：
视频里都有。分辨率是窗口的像素尺寸（Retina 屏上是点数的两倍），H.264、每秒 30 帧
（`--fps` 1 到 60）。鼠标指针不在画面里。`record` 先把窗口带到最前，被你关了也会重新打开；
录制中调窗口大小，视频保持开头的大小。

`--layout post`（1080×1920）、`both`（1920×1080）和 `front`（只有正面屏，`--scale`）
只显示收工牌，由它的两块屏绘制，不需要窗口出现在屏幕上。这些布局里每一帧都按收工牌自己的
时钟走，所以固件驱动的动画（`.anim` 文件、滚动文字、`countdown` 元素）是精确的；
你应用自己的 JavaScript 画的部分则按实际时间取。QuickTime、Windows Media Player、X、
Instagram、Telegram 和 Discord 都能直接用这个 MP4。GIF 是正面屏画面，默认 `--scale 8`、
每秒 25 帧（`--fps` 最高 50）：最多 750 帧（25 帧/秒时 30 秒），放大倍数更高时帧数更少
（`--scale 26` 时 142 帧，约 5 秒）；命令会告诉你装得下多少。`--out <file>` 指定文件名
（`.mp4` 或 `.gif`），`--out <folder>/` 指定文件夹。视频按收工牌的速度录制
（模拟器拒绝在 `--fast` 下录制），且没有声音。

## 提交到应用目录

BUSY 应用目录以拉取请求的形式接收应用：请求只加一个文件 `applications/<app id>/manifest.yml`。
该文件指明你的公开 GitHub 仓库和某个提交；应用目录由此构建并检查应用。
有两条命令能预先告诉你那些检查会发现什么，并写出这个文件：

```text
<cli> build                                  # the checks read the built package
<cli> check                                  # every check of the catalog: passes, fails, or cannot be checked here
<cli> submit                                 # the same checks, then submission/ with the manifest and the steps
```

两者都像 `build` 一样接受项目文件夹（`<cli> check my-app`）。都不需要模拟器在运行，
也都不向任何地方发送任何东西。

在模拟器窗口里，**Publish**（在收工牌上方，或应用 … 菜单里的 Publish…）分步做同样的事：
应用目录文案、截图、README、你选的许可证、公开仓库的文件并对疑似密钥发出警告、应用目录的检查、
构建和 `submission/`；然后把项目发布到你的公开 GitHub 仓库，并向应用目录打开拉取请求。
命令行上同样的步骤是 `<cli> publish`（`<cli> help publish`），`<cli> catalog-texts set` 写文案。
见[分步发布](#分步发布)。

`check` 先列失败项：每项给出应用目录的原话、它在你的项目里发现了什么、要改什么。
然后是应用目录的警告（带着警告也会收应用），再是从你的文件夹无法检查的部分及原因，
最后是通过了多少项。没有失败时退出码为 0，否则为 1（`check_failed`）。
加 `--json` 时输出很短：`counts`、`notes`，以及只有需要处理的 `failing`、`warnings` 和
`unchecked`，各带 `id`、`title`、`message` 和 `fix`。`--json --full` 列出每一项检查，
各带 `id`、`status`（`pass`、`fail`、`unchecked`）、`found`、`change` 和 `why`。
这些 id 是应用目录的：它的机器人在你的拉取请求上点名的也是这些。

新项目还缺什么、怎么补齐：

- **应用目录文案。** `<cli> check`（和 `submit`）会在项目里建一个空的 `catalog.json`。往里写：
  `category`（`productivity`、`clocks`、`info-feeds`、`social`、`dev-monitoring`、`music`、`art`、
  `games`、`smart-home`、`utilities` 之一）、`short_description`（一行，10 到 120 字符）、
  `description`（50 到 4000 字符；收一二级标题、粗体、斜体、列表和 http(s) 链接，`\n` 是换行）和
  `changelog`（10 到 4000 字符）。模拟器绝不替你写这些；`<cli> catalog-texts set` 写入你给的文案，
  并按应用目录的方式检查。

  ```json
  {
    "category": "clocks",
    "short_description": "A large clock with the date for the desk.",
    "description": "# Desk Clock\n\nA **large** clock with the date.\n\n- Wheel: brightness\n- OK: 12 or 24 hours",
    "changelog": "The first public version."
  }
  ```

- **截图。** 跑起应用后执行 `<cli> screenshot`，或按窗口里收工牌上方的 Screenshot
  （默认勾选 Front 和 Back；macOS 是 Cmd+Shift+S，Windows 是 Ctrl+Shift+S）：
  `screenshots/front-1.png`（72×16）就是应用在应用目录里的封面；最多收十张，按编号顺序取，
  `<cli> screenshot --back` 加背面屏截图（160×80）。想自己挑或排序，
  就在 `catalog.json` 里把文件列成 `"screenshots"` 和 `"back_screenshots"`。
  放大副本（`front-1@8x.png`）不给应用目录，会被排除。
- **许可证。** 项目里或其仓库顶层放一个 `LICENSE` 文件，内容是某开源许可证未改动的原文
  （MIT、Apache-2.0、GPL 以及 `check` 点名的其他）。选哪个由你定：模拟器绝不替你选，
  agent 也该问你而不是代选。选定后，`<cli> publish license --license MIT` 会写入
  带你的名字和年份的标准文本。
- **图标。** `<cli> icon --text AB` 画一两个字母（`--color "#FF5533"` 定颜色），或
  `<cli> icon --from logo.png` 把任意尺寸的图缩小。它写出 `src/appmeta/icon_front_8x8.png`
  和 `icon_back_11x11.png`，并按应用目录的图标规则检查；`--force` 替换已有图标。
- **GitHub 上的源码。** 项目放进一个公开 GitHub 仓库，已提交并推送，`package-lock.json`、
  截图和许可证都要在那个提交里。`check` 不跑 git：它读仓库的文件夹，所以知道提交、
  远端和 git 跟踪哪些文件，但不知道你最后的改动是否已提交。当你的副本还没看到远端上的提交时，
  `source_commit` 会说明并请你推送。
- **名字和 id。** `src/appmeta/manifest.json` 里应用的 `name` 最多 32 个字符，
  限拉丁字母、数字和少些符号；`id` 全小写且至少含两个点（`io.github.<your-github-user>.<app>`）；
  整个 `manifest.json` 在包中最多 512 字节，`"debug": true` 会被拒。

没有检查失败时，`submit` 在项目里写出 `submission/` 文件夹：

- `applications/<app id>/manifest.yml`：应用目录的 manifest，含你的仓库、提交、文案和截图路径。
  截图本身留在你的仓库里，应用目录从那里读它们。
- `PR-DESCRIPTION.md`：拉取请求描述的文字，按应用目录模板的字段。没有替你勾选任何框。
  它会写明应用是在模拟器上、用哪个固件构建和运行的，且没有在实体收工牌上跑过；
  如果你确实在真机上跑过，就在那里说明。
- `SUBMIT.md`：先要确认的事（全部已提交并推送、仓库是公开的、以及每一项模拟器无法判定的检查）
  和步骤：fork 应用目录、加入那一个文件、开拉取请求、开之前勾上作者框。

`submission/` 在 git 里忽略自己，每次 `submit` 都会重建：又提交了一次之后要再跑 `submit`，
因为 manifest 里写的是那个提交。要等应用目录亲眼看才能定的有：它对你提交的自行构建
（在无网络容器里，`npm ci`，不跑安装脚本）、版本是否高于已发布的、以及拉取请求本身。

## 分步发布

发布分两个阶段。第 1 阶段在你的项目里备好公开仓库和应用目录拉取请求所需的一切；
什么都不往外发。第 2 阶段登录 GitHub、建你的公开仓库、把项目发布上去并向应用目录开拉取请求。

在模拟器窗口里，**Publish**（收工牌上方，或应用 **…** 菜单里的 **Publish…**）为所选应用
打开这些步骤。Prepare 阶段，什么都不离开这台电脑：

1. **Application Info**：应用图标和名字、分类、简短描述、描述和新特性。
2. **Screenshots**：直接从收工牌上拍，或 **Upload…** 你自己做的 PNG
   （正面 72×16、背面 160×80，或它们的整数倍放大图）。可以重排和删除；第一张正面图是封面。
3. **README**：填字段（标题、简介、用法）或直接写 Markdown，带预览。
   截图、设置说明、构建方法和许可证行会替你加好。模板留下的文字没清掉时，Next 保持不可用。
4. **License**：MIT、Apache 2.0 或 GPL 3.0，每个都有大白话说明，或放你自己的 LICENSE 文件；
   什么都不替你选。
5. **Repository files**：哪些内容会公开、`.gitignore` 还缺的行、以及任何疑似密钥的东西。
6. **Pre-flight check**：构建应用并查类型，然后跑应用目录的检查；剩下的问题会标出所属
   步骤并给 Go to，或给出文件和行。之后文件一有改动就让它重跑。
7. **Build and package**：构建并生成 `submission/`。

然后是发布：**Publish to GitHub** 和 **Send to catalog**（见下）。**Next** 保存本步内容；
在本步完成前它是灰的，原因写在页脚；而且一步只有在前面的步都做完后才打开。
已完成的步骤打了勾，还能再打开。窗口把已完成的步骤记在项目的 `.busy/publish.json`
（`.busy/` 不进 git），并打开在第一个未完成的步。

同样的步骤在命令行上，给你或 agent：

```text
<cli> publish status                                 # where each step stands
<cli> publish check                                  # builds, checks types, then the catalog's checks
<cli> catalog-texts set --category clocks --short-description "A large clock with the date for the desk."
<cli> publish screenshots --take front               # what the front display shows now, for the catalog
<cli> publish readme set --usage "Turn the wheel."    # the README's how to use; readme preview shows it
<cli> publish license --license MIT --author "Your Name"
<cli> publish files                                  # what the repository will hold, and what looks like a secret
<cli> publish files --write                          # the missing .gitignore lines, and README.md
<cli> build
<cli> publish package                                # the checks, then submission/
```

`<cli> publish prepare --license MIT --author "Your Name"` 一口气做完许可证、文件、构建和打包：
适合 agent，前提是你已选好许可证。每条命令在步骤名后接受项目文件夹
（`<cli> publish status my-app`）和 `--json`。

- **`catalog-texts`** 读（`get`）或写（`set`）`catalog.json` 里的四段文案：`--category`、
  `--short-description`、`--description` 和 `--changelog`。每段都按应用目录的规则检查；
  应用目录会拒收的文案照样写入，但返回结果会说明问题在哪。以 "-" 开头的文案要写成
  `--description=<text>`。`--name` 改 manifest 里应用的名字，并拒收应用目录不接受的名字。
- **`publish license`** 写 `LICENSE`：`MIT`、`Apache-2.0` 或 `GPL-3.0` 的标准文本，
  署名（`--author`，否则 git 的 `user.name`，再否则应用的作者）和年份（`--year`），
  或者 `other` 由你自己放。它绝不替你选，也会保留已有的许可证文件。
  应用目录的检查对 GPL 3.0 文本本身会告警（`license_unrecognised`）：届时由审核员人工看。
- **`publish files`** 列出在项目的 `.gitignore` 之下 `git add -A` 会发布什么、
  `.gitignore` 缺哪些行（`node_modules/`、`dist/`、`.busy/`、`submission/` 和各系统自己的文件）、
  以及什么疑似密钥或个人数据：已知服务的令牌、赋给名字像密钥的键的值、`.env` 和密钥文件、
  主目录的路径。它指出文件、种类和行号，绝不泄露值。`--write` 补上那些行、
  挡掉你用 `--keep-out <path>` 点名的内容，并用应用目录文案、截图和许可生成 `README.md`。
  你自己写的 README 会保留，除非加 `--readme replace`；`--keep-in <path>` 收回它加过的一行。
- **`publish readme`** 显示（`get`）、写（`set`）或预览（`preview`）README.md：
  `--mode fields` 配 `--title`、`--intro` 和 `--usage`（应用怎么用，只有你能写），
  或 `--mode markdown` 配 `--markdown <text>`。你自己写的 README 会按 Markdown 打开并原样保留。
- **`publish screenshots`** 按应用目录的顺序列出截图，每张附应用目录的评价。
  `--take front` 或 `--take back` 把屏幕此刻的内容存下来，并留一份放大副本给 README；
  `--upload <files>` 加入你自己做的 PNG（路径按 `PATH` 的分隔方式连接，或给一个 JSON 列表），
  并检查尺寸；`--order` 定顺序（`'{"front": ["screenshots/front-2.png", "screenshots/front-1.png"]}'`；
  第一张正面图是封面）；`--remove <path>` 把一张移进 `.busy/removed/`。
- **`publish package`** 需要先构建。它跑各项检查，然后像 `submit` 一样写出 `submission/`；
  项目还没上 GitHub 之前，manifest 的仓库和提交写着 "Filled in Stage 2"。
  只有 GitHub 上的仓库才能通过的检查单列在第 2 阶段名下，不挡打包。

### 第 2 阶段：GitHub 和应用目录

**Publish to GitHub** 通过 GitHub CLI（`gh`，GitHub 出品，内置于应用里）登录，
它和这台电脑上的 GitHub CLI 共用账号：

- 如果这台电脑上的 GitHub CLI 已登录，窗口会问 "Use <login>?"。**Use <login>** 直接用
  该账号发布：没有新的登录，在模拟器里退出也只是让模拟器忘掉它。
- **Sign in with another account**，或 GitHub CLI 还没有账号时的首次登录：窗口显示一个验证码，
  你打开 github.com/login/device、输入并授权 GitHub CLI。账号会加进这台电脑的 GitHub CLI
  并成为它当前用的那个——你的终端里也一样；原来的账号仍保持登录。你在模拟器里退出时，
  可以把 GitHub CLI 切回原账号，或勾选 **Also sign out GitHub CLI on this computer**。

GitHub CLI 会请求访问你的仓库（公开和私有）、你所在组织的成员资格和你的 gists：
它向来要这么多，比发布需要的多；模拟器只用它创建一个公开仓库和发向应用目录的请求。
模拟器和 GitHub CLI 都看不到你的密码，模拟器也从不持有令牌：GitHub CLI 把它存在系统的
密码存储里（macOS 的登录钥匙串，Windows 的 Credential Manager），所有对 GitHub 的调用都由它发出。

这次登录属于这台电脑上的 GitHub CLI：其他程序——包括 AI agent——也能用。
模拟器的确认只罩得住它自己的命令。当 GitHub CLI 是模拟器登进去的、且之前没有任何账号时，
你退出登录时 Also sign out GitHub CLI on this computer 默认已勾选。

然后它建一个你的公开仓库（用应用名命名；可以改名），并把 Repository files 列出的文件
一次性提交发布上去，不经过 git。它再从 GitHub 读回该提交，显示链接和提交号。
`.github/workflows/` 不发布。再次发布会更新同一个仓库；名字已被占用时会给你换一个可用的。
`submission/` 里的 manifest 此时写上了仓库和提交。

**Send to catalog** 打开向应用目录添加 `applications/<app id>/manifest.yml` 的拉取请求。
它按应用目录模板原样显示作者 checklist：属实的每一项由你打勾，AI 使用情况也由你选。
所有项都勾上之前什么都不发送——应用目录标为可选的项（如参加 BUSY JS 应用大赛）可以不勾。
请求的描述就是应用目录自己的模板，带上你勾的框和你选的那一行。它发自你对应用目录的 fork，
或你有权推送时发自其中一个分支。如果项目在你发布后动过，先重新发布：应用目录构建的
正是那个提交。同一版本再次发送会把改动并进未结请求；新版本会开新请求。

Send to catalog 把请求发到 BUSY 应用目录，https://github.com/busy-app/busy-apps-catalog；
步骤里写着它。命令行的 `--catalog <owner/name>` 可指定别的应用目录，供开发和测试用。

**Sign out** 让模拟器忘掉这次登录。GitHub CLI 原本就有的账号仍对它保持登录；
模拟器登进去的也保留，除非你勾选 Also sign out GitHub CLI on this computer。
GitHub 侧在你撤销前一直保留授权：到 github.com/settings/applications 的 Authorized OAuth Apps
下撤销 **GitHub CLI**。这会让该账号在所有用到 GitHub CLI 的地方退出，不只模拟器。

命令行上的对应操作，需模拟器应用在运行（它持有登录，发送前会问你）：

```text
<cli> publish signin --use-existing        # GitHub CLI's account on this computer, as it is
<cli> publish signin --new-account         # prints the code and waits until you have entered it on GitHub
<cli> publish push                         # the app asks you to confirm, then publishes
<cli> publish pr --ai none                 # the app asks you to confirm the checklist; optional items stay unticked
<cli> publish status                       # stage 1's steps, the repository and the request
<cli> publish signout
```

### 手动发送

如果你想自己用 git，Publish 里 Build and package 步的 "Rather by hand? Show the steps"
和 `submission/SUBMIT.md` 会按你的项目列出这些步骤和命令：

1. 在项目文件夹里，提交所有要发布的内容：`git add -A`，然后 `git commit`。
2. 在 github.com 上建一个新的公开仓库，不带 README、license 和 .gitignore：项目里都有了。
3. 把项目接上它并推送：`git remote add origin https://github.com/<your-github-user>/<repository>.git`，
   然后 `git push -u origin main`。
4. 再打包一次：窗口里的 Build and package，或 `<cli> publish package`。manifest 此时写上
   仓库和提交，`SUBMIT.md` 里是开拉取请求的步骤。
5. Fork https://github.com/busy-app/busy-apps-catalog，把 `submission/applications/<app id>/manifest.yml`
   加进去，路径为 `applications/<app id>/manifest.yml`，别的什么都不改。
6. 向它的主分支开拉取请求，正文用 `submission/PR-DESCRIPTION.md` 的文字，属实的框打勾。

再次提交后，更新拉取请求前先重新打包：manifest 写的是那个提交。
