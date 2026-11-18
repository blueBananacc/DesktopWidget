# 聊天客户端（MCP）中的收工牌模拟器

不能运行命令的聊天客户端（Claude Desktop、Cursor 的聊天等）依然可以创建、运行并查看收工牌应用：模拟器的命令行内置了一个 MCP 服务器，`busy-emulator mcp`。把它添加进客户端一次，你的助手就能获得模拟器的全部命令作为工具，看到收工牌屏幕的图像，并读取应用的日志。

能运行命令的助手（Claude Code、Codex、Cursor 的 agent）不需要这些：它按「助手说明」直接使用命令行。不过给它添加这个服务器也可以。

## 你需要什么

已安装收工牌模拟器（[安装方法](install.md)）并至少打开过一次：每次启动时它都会把命令行写到一个固定路径，客户端运行的正是这个路径。

| | 命令行 |
|---|---|
| macOS | `~/.busy-emulator/bin/busy-emulator` |
| Windows | `%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe` |

有些客户端不会展开 `~` 或 `%LOCALAPPDATA%`：给它们完整路径。模拟器把它写在 `install.json` 的 `cli` 字段中，macOS 上位于 `~/Library/Application Support/BUSY Bar Emulator/`，Windows 上位于 `%LOCALAPPDATA%\BUSY Bar Emulator\`。客户端启动服务器时模拟器不必正在运行：助手会用 `start` 工具启动它。

## 添加方法

### Claude Desktop

Settings → Developer → Edit Config 会打开 `claude_desktop_config.json`。在 `mcpServers` 下添加该服务器，路径中换上你自己的用户名，然后重启 Claude Desktop。

macOS：

```json
{
  "mcpServers": {
    "busy-bar": {
      "command": "/Users/<you>/.busy-emulator/bin/busy-emulator",
      "args": ["mcp"]
    }
  }
}
```

Windows：

```json
{
  "mcpServers": {
    "busy-bar": {
      "command": "C:\\Users\\<you>\\AppData\\Local\\busy-emulator\\bin\\busy-emulator.exe",
      "args": ["mcp"]
    }
  }
}
```

### Claude Code

macOS：

```sh
claude mcp add --scope user busy-bar -- ~/.busy-emulator/bin/busy-emulator mcp
```

Windows，在 PowerShell 中：

```powershell
claude mcp add --scope user busy-bar -- "$env:LOCALAPPDATA\busy-emulator\bin\busy-emulator.exe" mcp
```

### Cursor

Settings → MCP → Add new global MCP server 会打开 `~/.cursor/mcp.json`（项目中的 `.cursor/mcp.json` 只作用于该项目）。添加与 Claude Desktop 相同的条目：

```json
{
  "mcpServers": {
    "busy-bar": {
      "command": "/Users/<you>/.busy-emulator/bin/busy-emulator",
      "args": ["mcp"]
    }
  }
}
```

### VS Code

工作区中用 `.vscode/mcp.json`；对所有工作区生效则用命令 MCP: Open User Configuration。VS Code 的键名是 `servers`，不是 `mcpServers`：

```json
{
  "servers": {
    "busy-bar": {
      "type": "stdio",
      "command": "/Users/<you>/.busy-emulator/bin/busy-emulator",
      "args": ["mcp"]
    }
  }
}
```

### 其他客户端

这是一个走 stdio 的服务器：命令是命令行的完整路径，唯一参数为 `mcp`，没有自己的环境变量。它通过 `initialize` 握手说 MCP 2025-11-25（当客户端请求时，也说 2025-06-18、2025-03-26 和 2024-11-05），不进行握手则说 2026-07-28。它的日志输出到 stderr；客户端关闭其 stdin 时它结束。

### 客户端无法启动它时

最常见的原因是路径写错，或路径中含有客户端没有展开的 `~` 或 `%LOCALAPPDATA%`。在终端里运行同样的命令：`busy-emulator mcp` 会等待客户端的消息，在收到之前不会在 stdout 打印任何东西；Ctrl+C 结束它。如果终端说文件不存在，打开一次模拟器，并从 `install.json`（见上）中取路径。

## 助手能做什么

然后可以这样问，比如："帮我做一个收工牌应用，为我的下一次会议倒计时，并给我看看它长什么样。"

| 工具 | 作用 |
|---|---|
| `status`、`start` | 模拟器是否在运行；启动它 |
| `create_app`、`list_examples` | 从官方模板或示例应用创建新项目 |
| `refresh` | 改动后构建、安装并启动应用（`build` 和 `run` 分步执行） |
| `screenshot` | 正面或背面屏幕放大后以图片形式给助手查看；PNG 文件也会保存 |
| `logs` | 应用打印的内容、报错、结束原因 |
| `press` | 收工牌的按键和滚轮 |
| `settings_get`、`settings_set` | 应用的设置，与其设置页面所做的相同 |
| `typecheck`、`stop` | 项目的类型检查；停止应用 |
| `time` | 设置收工牌的时钟，或让时间一次流逝过去，好让计时器立刻走完 |
| `record` | 录一小段应用视频，用于发帖 |
| `check`、`submit` | 应用目录的检查；应用目录 pull request 所需的文件 |
| `icon`、`catalog_texts` | 应用的图标；它在应用目录中的名称、分类和描述 |
| `publish` | 完整的 Publish 流程，一次调用一步：截图、含 How to use 的 README、许可证、仓库文件、打包；然后登录 GitHub、建公开仓库、向应用目录提 pull request——每一步都由你在模拟器窗口中确认 |
| `projects`、`uninstall` | 模拟器知道的项目文件夹；把应用从模拟的收工牌上移除 |

每个工具都有时限：读取类工具半分钟到一分钟，`build`、`refresh` 和 `typecheck` 为 15 分钟，`create_app` 为 20 分钟，等待你操作的 `publish` 步骤最长 17 分钟。超过时限、或聊天客户端取消请求时，工具会停下它启动的一切并回答 `tool_timeout`。只读工具（`status`、`list_examples`、`projects`、`logs`、`screenshot`、`settings_get`）在构建进行时也能作答。

`trust` 和 `allow-local` 没有对应工具：它们由你在终端里运行。发布流程中只能由你决定的事会走模拟器窗口：助手会问你许可证和 AI 使用情况，而登录 GitHub、选择账户、确认上传和 pull request、勾选应用目录的作者确认清单，都在模拟器自己的对话框里由你完成。助手无法替你做这些。

两个资源保存着给助手的简短指南：`busy-emulator://guide/start` 和 `busy-emulator://guide/project`，即项目 `AGENTS.md` 中属于模拟器的那部分。应用的代码由助手自己写；没有文件工具的聊天客户端需要一种写文件的途径，比如它自己的文件系统服务器。

## 它不能做什么

服务器不会授予命令行之外的任何权限：

- **仅限模拟器自己的项目。** 项目工具只接受模拟器用 `create_app`（或 `create`）创建的、以及你信任过的文件夹，其他一概不行。构建项目就是在你电脑上运行它的代码，所以以其他方式得到的文件夹（克隆的、复制的、用 `npm create` 建的）会被以 `untrusted_project` 拒绝。只有你能信任它：在终端运行 `busy-emulator trust <folder>` 并在模拟器的对话框中确认。没有任何工具能信任文件夹或代你请求。
- **不碰它自己挑选的文件。** 没有工具能读写它未在答复中列名的文件：截图（在项目的 `screenshots/` 或模拟器数据文件夹中）、`create_app` 创建的项目、`build`、`submit`、`icon`、`catalog_texts` 和 `publish` 写入项目的内容。工具接收的图片或截图（`icon`、`publish` 的截图）必须位于项目文件夹之内；`uninstall` 绝不移动你的文件。
- **不执行命令。** 没有工具会运行交给它的程序或 shell 命令。工具运行的程序是项目自己的工具，与命令行一致：`build` 运行项目自带的 `busy-cli` 及其依赖。
- **无法进入你的电脑。** 模拟收工牌上的应用不能访问你电脑自己的服务（其 `localhost` 和自身地址），也没有工具能放行端口：模型可能被它读到的内容操纵，而它装上的应用可能通过收工牌读取你的服务。当你的应用需要你的某个服务时，你在终端运行 `busy-emulator allow-local <port>`；有 shell 的助手也可以运行它，但模拟器会先在自己的对话框里问你。你放行的端口对助手运行的应用同样开放，直到模拟器退出：这是你的选择。
- **不还回机密。** 应用 `settings.json` 中标记为 `sensitive` 的设置（比如放在请求头里的令牌）在答复中显示为 `(hidden)`；助手仍能设置它。命令行会把它显示给你。

除非你把客户端设成不再询问，否则它会在每个工具运行前问你；允许 `refresh`、`screenshot` 和 `logs` 能省去最多的提问。
