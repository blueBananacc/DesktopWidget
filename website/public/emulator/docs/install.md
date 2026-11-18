# 安装收工牌模拟器

收工牌模拟器是适用于 macOS（Apple Silicon 和 Intel）以及 Windows x64 的桌面应用。Node、npm 和构建收工牌应用所需的工具都已内置其中。它只为当前用户安装，不需要管理员权限。

## 下载什么、从哪里下载

所有文件都来自模拟器在 GitHub 上的公开仓库 `busy-app/busybar-emulator` 的 releases。这些文件在每个版本中的名字都相同，因此最新版本的地址永远不变：

| 文件 | 地址 | 说明 | 大小 |
|---|---|---|---|
| macOS Apple Silicon，供人下载 | https://github.com/busy-app/busybar-emulator/releases/latest/download/busybar-emulator-mac-arm64.dmg | 包含应用本体和 Applications 链接的磁盘映像 | 约 210 MB |
| macOS Apple Silicon，供 agent 下载 | https://github.com/busy-app/busybar-emulator/releases/latest/download/busybar-emulator-mac-arm64.zip | 同一应用的 zip 压缩包 | 约 210 MB |
| macOS Intel，供人下载 | https://github.com/busy-app/busybar-emulator/releases/latest/download/busybar-emulator-mac-x64.dmg | 适用于 Intel 处理器 Mac 的同一版本 | 约 215 MB |
| macOS Intel，供 agent 下载 | https://github.com/busy-app/busybar-emulator/releases/latest/download/busybar-emulator-mac-x64.zip | 同一应用的 zip 压缩包 | 约 220 MB |
| Windows | https://github.com/busy-app/busybar-emulator/releases/latest/download/busybar-emulator-win-x64-setup.exe | 安装程序：仅为当前用户安装，不需要管理员权限 | 约 250 MB |
| 校验和 | https://github.com/busy-app/busybar-emulator/releases/latest/download/SHA256SUMS | 上述每个文件的 SHA-256 | 不到 1 KB |

搭载 Apple Silicon（M1 及更新）的 Mac 使用 `arm64` 文件，搭载 Intel 处理器的 Mac 使用 `x64` 文件：Apple 菜单 → About This Mac 会显示 "Chip: Apple M…" 或 "Processor: … Intel …"。两者包含相同的应用，各自带有对应处理器架构的 Electron 和 Node。两者都需要 macOS 13.5（Ventura）或更高版本。

GitHub 会把每个地址重定向到最新版本的文件。下面的安装流程会在解包或运行任何内容之前，先对照 `SHA256SUMS` 校验下载的文件。这能发现损坏或不完整的下载，或是属于其他版本的文件。但它不是签名：能替换发布文件的人也能替换 `SHA256SUMS`。为文件来源担保的是到 github.com 的 HTTPS 连接。

应用写入磁盘的内容：

| | macOS | Windows |
|---|---|---|
| 应用本体 | `~/Applications/BUSY Bar Emulator.app`（如果你把它放在 `/Applications` 则是那里） | `%LOCALAPPDATA%\Programs\BUSY Bar Emulator\`，外加一个开始菜单快捷方式和 Settings → Apps 中的一个条目 |
| 其数据与指针文件 `install.json` | `~/Library/Application Support/BUSY Bar Emulator/` | `%LOCALAPPDATA%\BUSY Bar Emulator\` |
| 命令行 `busy-emulator`，每次启动时重写 | `~/.busy-emulator/bin/busy-emulator` | `%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe` |
| macOS 为每个应用保存的偏好设置文件（系统对该应用自身的设置；模拟器自己不在其中存放任何内容） | `~/Library/Preferences/app.busy.emulator.plist` | 无 |

应用在 macOS 上约占 525 MB、在 Windows 上约占 580 MB；安装期间，下载文件（在 macOS 上连同其解包副本）在临时文件夹中还需最多 750 MB。

应用不会向任何地方发送关于你的任何信息，它模拟的收工牌也只在 127.0.0.1 上应答：[模拟器在网络上和磁盘上做什么](network-and-disk.md)。要把它们全部移除，见[卸载](#卸载)。

## 首次打开

在 macOS 上，应用使用 Developer ID 签名并经过 Apple 公证，因此打开时没有安全警告。在 Windows 上，安装程序没有签名：SmartScreen 会在你第一次运行时警告一次；之后应用便与其他应用一样正常打开。

下面的 Windows 步骤依照微软针对 Windows 10 和 11 的文档编写。你屏幕上的具体措辞可能略有不同。

### macOS

1. 下载适合你 Mac 的磁盘映像并打开：Apple Silicon 用 `busybar-emulator-mac-arm64.dmg`，Intel 用 `busybar-emulator-mac-x64.dmg`。下错了也无妨：Apple Silicon 版无法在 Intel Mac 上打开，而 Intel 版可以在 Apple Silicon 上通过 Rosetta 运行，只是更慢。
2. 把收工牌模拟器拖到 Applications。不要从磁盘映像或"下载"中直接打开：那样 macOS 会从一个临时的只读位置运行它，模拟器会要求你移动它："BUSY Bar Emulator cannot work from where it is now … Quit, drag BUSY Bar Emulator to the Applications folder and open it from there."
3. 从 Applications 打开收工牌模拟器。第一次时，macOS 会提示它是从互联网下载的应用并询问是否打开：选择 **Open**。从此打开时不再询问。

**0.1.0-beta.4 之前的版本未经公证。** macOS 起初会拒绝打开：提示无法验证该应用不含恶意软件。选择 **Done**（不是 Move to Trash），打开 **System Settings → Privacy & Security**，滚动到 Security，那里会显示收工牌模拟器 "was blocked to protect your Mac"，选择 **Open Anyway**；在随后弹出的对话框中再次以 **Open Anyway** 确认（macOS 可能会要求输入登录密码）。在 macOS 15 上，Control-点击 → Open 已不再放行此类应用；系统设置是唯一途径。内置更新可以把旧版本升级到已公证的版本。

### Windows

1. 下载 `busybar-emulator-win-x64-setup.exe` 并运行。
2. Windows SmartScreen 会显示 **"Windows protected your PC"**，并说明它阻止了一个无法识别的应用启动。选择 **More info**，确认应用是 `busybar-emulator-win-x64-setup.exe`，然后选择 **Run anyway**。
3. 安装程序会询问是否为你安装收工牌模拟器；不需要管理员权限。完成后，从开始菜单打开收工牌模拟器。

### 用命令而非浏览器下载时

macOS 和 Windows 只会警告被标记为来自互联网的文件，而给文件做标记的正是浏览器。在 macOS 上用 `curl`、或在 PowerShell 中用 `Invoke-WebRequest` 或 `curl.exe` 下载的文件不带有这种标记（已在 macOS 15 和 Windows 10 上验证）。macOS 的 Gatekeeper 和 Windows 的 SmartScreen 都不会检查它，应用打开时不会有警告。下面给 agent 的流程正是这样运作的。在 macOS 上，无论用什么方式取得，应用仍然是签名并公证过的；在 Windows 上，由于安装程序没有签名，此时唯一的校验手段就是到 GitHub 的 HTTPS 连接和 `SHA256SUMS` 中的校验和。如果你用浏览器下载 zip 并自行解包，标记会随之保留，上面的步骤依然适用。

## 给 agent：安装并启动模拟器

如果用户没有收工牌，模拟器可以代替它。先告诉用户你将要下载什么（见上表）、用命令下载会跳过系统的首次打开检查（见上文），并在动手前征得同意。然后运行与你所在系统对应的流程。每个流程都会：

1. 通过指针文件 `install.json` 及其所指的应用检查模拟器是否已安装。它不会在 `PATH` 上查找 `busy-emulator`——它通常不在那里。被移动或丢进废纸篓的应用会留下指针文件；此时流程会转而去寻找应用本体；
2. 如果应用未安装，把发布文件（在 macOS 上是对应这台 Mac 处理器的版本）和 `SHA256SUMS` 下载到一个新建的临时文件夹中；若校验和不匹配，则直接停止，不解包也不运行任何内容；
3. 安装：在 macOS 上把应用解包到 `~/Applications`；在 Windows 上以当前用户身份静默运行安装程序；
4. 用 `busy-emulator start` 启动模拟器（绝不用 `open`），该命令会一直等到其模拟的收工牌应答；
5. 从 `install.json` 中读取命令行的路径，并在最后一行以 `cli=<path>` 输出。

此后每条命令都用这个路径：`<cli> help` 会列出全部命令。每条命令的路径都相同，因此在你的 agent 里一条权限规则就能覆盖所有命令。在 macOS 上它不含空格；在 Windows 上它位于 `%LOCALAPPDATA%` 下，即用户的配置目录中。书写时用正斜杠——`C:/Users/you/AppData/Local/busy-emulator/bin/busy-emulator.exe status`——不加引号即可在 PowerShell、Git Bash 和 cmd 中同样运行。配置目录的文件夹名可能带空格：此时在 PowerShell 中以 `& '<cli>' status` 调用，在 Git Bash 和 cmd 中以 `"<cli，把 \ 换成 />" status` 调用。如果某条命令回答 `blocked_network`，说明你的沙箱不允许它访问 127.0.0.1：请请求用户在沙箱外允许该命令。

接下来的内容——创建项目并让你的应用跑在模拟的收工牌上——见[在模拟收工牌上的第一个应用](first-app.md)。

这些流程只使用系统自带的工具：在 macOS 上是 `zsh`、`curl`、`shasum`、`ditto`、`plutil` 和 `sysctl`；在 Windows 上是 PowerShell。不需要 Node，也不需要管理员权限。

`BUSY_EMULATOR_RELEASE_URL` 会替换最新版本的地址（即其文件所在的目录）。它用于测试和用户指定的镜像：仅在用户明确要求时才设置；如果你发现它已经被设置，运行流程前先询问用户。它必须是 `https` 地址（仅当指向 127.0.0.1 或 localhost 时才允许普通 `http`）。当文件并非来自官方发布时，流程会明确说明。

### macOS

保存为 `install-macos.sh` 并运行 `zsh install-macos.sh`（同一文件也位于模拟器仓库的 `public-docs/install/install-macos.sh`）。

```sh
#!/bin/zsh
# Installs BUSY Bar Emulator for the current user on macOS (Apple Silicon or Intel), starts it and prints the path of
# its command line. Nothing but what macOS has: curl, shasum, ditto, plutil. No Node, no administrator rights.
# What it downloads and from where: public-docs/install.md.
#
#   zsh install-macos.sh
#
# BUSY_EMULATOR_RELEASE_URL replaces the address of the latest release (the folder the release files lie in): only
# for tests and for a mirror the user names. It must be https (http only to 127.0.0.1 or localhost).
set -eu

official=https://github.com/busy-app/busybar-emulator/releases/latest/download
base=${BUSY_EMULATOR_RELEASE_URL:-$official}
base=${base%/}
# The build for this Mac's processor. The hardware, not uname -m: a shell under Rosetta says x86_64 on Apple Silicon.
# An Intel Mac has no such key, and takes the Intel build.
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then
  zip=busybar-emulator-mac-arm64.zip
else
  zip=busybar-emulator-mac-x64.zip
fi
name='BUSY Bar Emulator.app'
pointer="$HOME/Library/Application Support/BUSY Bar Emulator/install.json"

say() { printf 'install: %s\n' "$*"; }
fail() { printf 'install: %s\n' "$*" >&2; exit 1; }
in_pointer() { /usr/bin/plutil -extract "$1" raw -o - "$pointer" 2>/dev/null || true; }

case $base in
  https://?*|http://127.0.0.1:*|http://127.0.0.1/*|http://localhost:*|http://localhost/*) ;;
  *) fail "BUSY_EMULATOR_RELEASE_URL must be an https address: $base" ;;
esac
[ "$base" = "$official" ] || say "not the official release: the files come from $base"

# 1. Is the emulator installed? The pointer file says, if the app it names is still there; the command may well not
# be on PATH. An app moved or put in the Trash leaves the pointer file and the command line behind.
cli=
if [ -f "$pointer" ]; then
  cli=$(in_pointer cli)
  named=$(in_pointer app)
  if [ -n "$cli" ] && [ -f "$cli" ] && [ -x "$cli" ] && [ -n "$named" ] && [ -d "$named" ]; then
    say "installed: $pointer names $cli"
  else
    say "$pointer names no app or command line that exists; looking for the app"
    cli=
  fi
fi

if [ -n "$cli" ]; then
  start=$cli
else
  # 2. The app may be in place without the pointer file (it writes it at its first start).
  app=
  for place in "/Applications/$name" "$HOME/Applications/$name"; do
    if [ -d "$place" ]; then
      app=$place
      break
    fi
  done
  if [ -n "$app" ]; then
    say "found $app"
  else
    tmp=$(/usr/bin/mktemp -d -t busy-emulator-install)
    trap '/bin/rm -rf "$tmp"' EXIT
    say "downloading $base/$zip and $base/SHA256SUMS"
    /usr/bin/curl -fsSL --proto-redir '=https' --retry 2 -o "$tmp/$zip" "$base/$zip" || fail "could not download $base/$zip"
    /usr/bin/curl -fsSL --proto-redir '=https' --retry 2 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || fail "could not download $base/SHA256SUMS"
    # 3. The archive must match its line in SHA256SUMS before anything is unpacked.
    expected=$(/usr/bin/awk -v n="$zip" '$2 == n { print $1 }' "$tmp/SHA256SUMS")
    printf '%s\n' "$expected" | /usr/bin/grep -Eqx '[0-9a-f]{64}' || fail "SHA256SUMS has no single sum for $zip; nothing installed"
    actual=$(/usr/bin/shasum -a 256 "$tmp/$zip" | /usr/bin/awk '{ print $1 }')
    [ "$actual" = "$expected" ] || fail "$zip does not match SHA256SUMS (expected $expected, got $actual); nothing unpacked, nothing installed"
    say "$zip matches SHA256SUMS"
    # 4. Unpack beside the download, then move the app into ~/Applications: no half app is ever left there.
    /usr/bin/ditto -x -k "$tmp/$zip" "$tmp/unpacked"
    [ -d "$tmp/unpacked/$name" ] || fail "$zip holds no $name; nothing installed"
    /bin/mkdir -p "$HOME/Applications"
    [ ! -e "$HOME/Applications/$name" ] || fail "$HOME/Applications/$name appeared meanwhile; nothing replaced"
    /bin/mv "$tmp/unpacked/$name" "$HOME/Applications/$name"
    app="$HOME/Applications/$name"
    say "installed $app"
  fi
  start="$app/Contents/Resources/bin/busy-emulator"
fi

# 5. Start it. At every start the app writes the pointer file and the command line at its fixed place.
say "starting the emulator"
"$start" start
cli=$(in_pointer cli)
[ -n "$cli" ] && [ -f "$cli" ] && [ -x "$cli" ] || fail "the emulator started but $pointer names no command line"
say "the command line is $cli"
printf 'cli=%s\n' "$cli"
```

### Windows

保存为 `install-windows.ps1` 并运行 `powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1`（`-ExecutionPolicy Bypass` 只让这一次 PowerShell 运行所保存的文件，不改动任何设置；同一文件也位于模拟器仓库的 `public-docs/install/install-windows.ps1`）。静默安装不显示窗口、也不提任何问题；其日志 `%TEMP%\busybar-emulator-setup.log` 在安装成功后删除，失败时保留并指明其位置。给 agent 的一行安装命令所下载的副本 `%TEMP%\busy-emulator-install.ps1` 在运行时会自我删除；以其他名字或其他目录保存的副本会保留下来。

```powershell
# Installs BUSY Bar Emulator for the current user on Windows (x64), starts it and prints the path of its command
# line. Nothing but Windows PowerShell 5.1 (or PowerShell 7). No Node, no administrator rights.
# What it downloads and from where: public-docs/install.md.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1
#
# BUSY_EMULATOR_RELEASE_URL replaces the address of the latest release (the folder the release files lie in): only
# for tests and for a mirror the user names. It must be https (http only to 127.0.0.1 or localhost).
#
# It leaves nothing in %TEMP%: the copy the one-line install downloads, %TEMP%\busy-emulator-install.ps1, is removed as
# soon as it runs (PowerShell has read it whole by then), and the setup's log once the install succeeded. A failed
# setup keeps its log and names it.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$temp = [IO.Path]::GetTempPath()
if ($PSCommandPath -and [IO.Path]::GetFileName($PSCommandPath) -eq 'busy-emulator-install.ps1') {
  $from = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($PSCommandPath)).TrimEnd('\')
  $temps = @($temp, $env:TEMP) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
  if ($temps -contains $from) { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue }
}

$official = 'https://github.com/busy-app/busybar-emulator/releases/latest/download'
$base = $official
if ($env:BUSY_EMULATOR_RELEASE_URL) { $base = $env:BUSY_EMULATOR_RELEASE_URL }
$base = $base.TrimEnd('/')
$file = 'busybar-emulator-win-x64-setup.exe'
$pointer = Join-Path $env:LOCALAPPDATA 'BUSY Bar Emulator\install.json'
$appFolder = Join-Path $env:LOCALAPPDATA 'Programs\BUSY Bar Emulator'

function Say($text) { Write-Output "install: $text" }
function Fail($text) { [Console]::Error.WriteLine("install: $text"); exit 1 }
function InPointer($field) {
  try { return [string](Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).$field } catch { return '' }
}

if ($base -notmatch '^(https://[^/]+|http://(127\.0\.0\.1|localhost)(:\d+)?)(/|$)') { Fail "BUSY_EMULATOR_RELEASE_URL must be an https address: $base" }
if ($base -ne $official) { Say "not the official release: the files come from $base" }

# 1. Is the emulator installed? The pointer file says, if the app it names is still there; the command may well not
# be on PATH. An app removed or moved leaves the pointer file and the command line behind.
$cli = ''
if (Test-Path -LiteralPath $pointer -PathType Leaf) {
  $cli = InPointer 'cli'
  $named = InPointer 'app'
  if ($cli -and (Test-Path -LiteralPath $cli -PathType Leaf) -and $named -and (Test-Path -LiteralPath $named -PathType Leaf)) {
    Say "installed: $pointer names $cli"
  } else {
    Say "$pointer names no app or command line that exists; looking for the app"
    $cli = ''
  }
}

if ($cli) {
  $start = $cli
} else {
  # 2. The app may be in place without the pointer file (it writes it at its first start).
  if (Test-Path -LiteralPath (Join-Path $appFolder 'BUSY Bar Emulator.exe') -PathType Leaf) {
    Say "found $appFolder"
  } else {
    if (-not [Environment]::Is64BitOperatingSystem) { Fail 'this Windows is not 64-bit; the emulator is built for Windows x64 only' }
    # Windows PowerShell 5.1 may not offer TLS 1.2 by default, and GitHub takes nothing older.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # Behind a company's proxy: Windows PowerShell 5.1 uses the system's proxy but not the user's credentials for it
    # (a 407 otherwise), and reads no HTTPS_PROXY; PowerShell 7 reads it itself.
    try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }
    $web = @{}
    if ($env:HTTPS_PROXY -and $PSVersionTable.PSVersion.Major -lt 6) { $web.Proxy = $env:HTTPS_PROXY; $web.ProxyUseDefaultCredentials = $true }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('busy-emulator-install-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $setup = Join-Path $tmp $file
      $sums = Join-Path $tmp 'SHA256SUMS'
      Say "downloading $base/$file and $base/SHA256SUMS"
      try { Invoke-WebRequest @web -UseBasicParsing -Uri "$base/$file" -OutFile $setup } catch { Fail "could not download $base/${file}: $($_.Exception.Message)" }
      try { Invoke-WebRequest @web -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums } catch { Fail "could not download $base/SHA256SUMS: $($_.Exception.Message)" }
      # 3. The setup must match its line in SHA256SUMS before it is run.
      $expected = @(Get-Content -LiteralPath $sums | ForEach-Object { if ($_ -match '^([0-9a-f]{64})  (.+)$' -and $Matches[2] -eq $file) { $Matches[1] } })
      if ($expected.Count -ne 1) { Fail "SHA256SUMS has no single sum for $file; nothing installed" }
      $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLowerInvariant()
      if ($actual -ne $expected[0]) { Fail "$file does not match SHA256SUMS (expected $($expected[0]), got $actual); the setup was not run, nothing installed" }
      Say "$file matches SHA256SUMS"
      # 4. The setup, silent, for this user only. The folder goes last on its command line.
      $run = Start-Process -FilePath $setup -ArgumentList @('/S', "/D=$appFolder") -Wait -PassThru
      $setupLog = Join-Path $temp 'busybar-emulator-setup.log'
      if ($run.ExitCode -ne 0) { Fail "the setup ended with exit code $($run.ExitCode); its log is $setupLog" }
      Remove-Item -LiteralPath $setupLog -Force -ErrorAction SilentlyContinue
      Say "installed $appFolder"
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $start = Join-Path $appFolder 'resources\bin\busy-emulator.exe'
}

# 5. Start it. At every start the app writes the pointer file and the command line at its fixed place.
Say 'starting the emulator'
& $start start
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$cli = InPointer 'cli'
if (-not $cli -or -not (Test-Path -LiteralPath $cli -PathType Leaf)) { Fail "the emulator started but $pointer names no command line" }
Say "the command line is $cli"
Write-Output "cli=$cli"
```

两个脚本在模拟器运行后都以退出码 0 和一行 `cli=<path>` 结束。其他任何结果都以非零退出码和一行说明发生了什么的文字结束。重复运行流程是安全的：已安装的模拟器只会被启动，应用被删掉的则会重新安装。

## 升级到新版本

当有新版本发布时，模拟器窗口顶部会显示 **Update to <version>**（模拟器在启动时检查，运行期间每天检查一次）。点击它：模拟器会从 GitHub 下载新版本，并校验它确实是发布方签名的那一个。然后点击 **Restart to update** 和 **Restart**：模拟器退出、把新版本安置到位并重新打开。agent 也可以用 `busy-emulator update` 完成同样的事，由你在模拟器的对话框中作答。升级会保留一切：模拟收工牌上的应用及其设置、你的项目和已信任的文件夹、你对第一个问题的回答、窗口自身的设置、你的 GitHub CLI 登录状态，以及同一路径下的命令行（`~/.busy-emulator/bin/busy-emulator`、`%LOCALAPPDATA%\busy-emulator\bin\busy-emulator.exe`），因此 agent 的操作说明依然有效。

在模拟器无法替换自身的地方，该行会改为 **Download** 链接，其提示文字说明原因：在 macOS 上是当它从磁盘映像、"下载"或它无权写入的文件夹中运行时；在 Windows 上是当它不是由其安装程序安装时。此时按下面的方式手动升级。在 Windows 上，若有其他程序正从它的文件夹中运行（比如某个 agent 的 `busy-emulator mcp`），安装程序无法替换应用：此时 Restart 会指出是哪个程序且不会退出；结束 agent 会话（或关闭那个程序）后再次点击 Restart。同理，agent 也无法通过模拟器的 MCP 工具在 Windows 上升级它：结束会话后在窗口中点击 Update。

如果 Mac 在更新替换应用的那一两秒内断电或崩溃，应用可能会从它的文件夹中消失：上一个版本就在旁边的隐藏文件夹 `.busy-emulator-update-<version>/previous/` 中（在 Finder 中按 Cmd+Shift+. 可以看到）；把其中的 `BUSY Bar Emulator.app` 拖回原来的文件夹并打开即可。

### macOS

1. 退出收工牌模拟器：菜单栏中的 **BUSY Bar Emulator → Quit**，或 `~/.busy-emulator/bin/busy-emulator quit`。
2. 下载适合你 Mac 的新磁盘映像并打开。
3. 把收工牌模拟器拖到 Applications，选择 **Replace**。不要选 **Keep Both**：应用的两个副本共用一个数据文件夹，而命令行会运行最后被打开的那个。
4. 从 Applications 打开它。新下载的文件会再次被检查，因此 macOS 会再次拒绝：按[首次打开](#macos)中的方法在 **System Settings → Privacy & Security** 中放行。

### Windows

1. 退出收工牌模拟器：关闭其窗口，或 **BUSY Bar → Exit**，或 `busy-emulator quit`。如果它仍在运行，安装程序会说明且不做任何更改。
2. 下载新的 `busybar-emulator-win-x64-setup.exe` 并运行；SmartScreen 会再询问一次（**More info → Run anyway**）。它会覆盖旧版本，装在同一文件夹中。
3. 从开始菜单打开收工牌模拟器。

给 agent 的安装流程（见上文）不会执行升级：它只会启动已安装的副本。要升级，请按上面的步骤操作。

如果新版本改变了数据文件夹的内部结构，它会在首次启动时迁移该文件夹；此后旧版本无法再打开它。如果迁移不成，它会把文件夹中原有的内容原封不动地保存在数据文件夹内的 `set-aside/` 中，并在日志中说明。

## 卸载

无论删除什么，你的项目都留在原处。数据文件夹保存着模拟收工牌的存储（你安装到上面的应用及其设置）、你信任过的项目文件夹列表、npm 的缓存和日志。删除它是唯一会丢失东西的步骤。

如果你用模拟器发布过应用，你电脑上的 GitHub CLI 会保留它登录的账号：其设置（`~/.config/gh`、`%APPDATA%\GitHub CLI`）以及保存在登录钥匙串或凭据管理器中的 token。如果也想把这些去掉，先在模拟器的 Publish to GitHub 中退出登录，并勾选 Also sign out GitHub CLI on this computer（该选项在模拟器登录过 GitHub CLI 时才会提供）。

### Windows

打开 **Settings → Apps**，找到收工牌模拟器并选择 **Uninstall**，或者运行 `%LOCALAPPDATA%\Programs\BUSY Bar Emulator\` 中的 `uninstall.exe`。不需要管理员权限。卸载程序会先问是否移除应用，再问是否连同其数据一起移除。默认答案是否：即保留数据供以后再安装。

如果模拟器正在运行，它会先让模拟器退出，然后删除应用的文件夹、开始菜单快捷方式、Settings → Apps 中的条目、命令行文件夹 `%LOCALAPPDATA%\busy-emulator\`、指针文件 `install.json` 和安装日志 `%TEMP%\busybar-emulator-setup.log`。如果你答了是，它还会删除数据文件夹 `%LOCALAPPDATA%\BUSY Bar Emulator\`。如果有 `busy-emulator` 命令（如 `build` 或 `dev`）仍在运行，它什么都不删并说明情况：等命令结束或将其停止，然后重新运行卸载程序。它自己不结束任何进程，只是请求模拟器退出。

对 agent，卸载程序以静默方式运行：没有窗口、没有询问，结果就是退出码。删除数据前请先征得用户同意。

```powershell
$uninstaller = Join-Path $env:LOCALAPPDATA 'Programs\BUSY Bar Emulator\uninstall.exe'
$log = Join-Path ([IO.Path]::GetTempPath()) 'busybar-emulator-uninstall.log'
# The log's path may have a space in it (the user's folder name): the argument is quoted as a whole.
$run = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/KeepData', ('"/LOG=' + $log + '"')) -Wait -PassThru
Write-Output "uninstall: exit code $($run.ExitCode)"
Get-Content -LiteralPath $log
```

| | |
|---|---|
| `/S` | 静默：不询问、不显示窗口 |
| `/KeepData` | 保留数据文件夹（静默模式下两者都不给时的默认行为） |
| `/RemoveData` | 连同数据文件夹一起删除 |
| `/LOG=<file>` | 日志追加到该文件；不带它时日志是 `%TEMP%\busybar-emulator-setup.log`，卸载成功后会被删除 |
| 退出码 `0` | 已卸载 |
| 退出码 `1` | 失败；日志里说明了留下什么 |
| 退出码 `2` | 参数错误，或该文件夹不是安装程序所创建的安装 |
| 退出码 `3` | 模拟器或其某条命令正在运行且没有结束；未删除任何内容 |
| 退出码 `4` | 用户选择了否 |

在已有安装之上重新安装，或在保留了数据的卸载之后重新安装，过程都与第一次相同。

### macOS

退出模拟器（其菜单中的 Quit，或 `busy-emulator quit`），然后删除：

- 应用本体 `BUSY Bar Emulator.app`：从 `~/Applications` 或 `/Applications` 中删除；
- 命令行文件夹 `~/.busy-emulator/`；
- macOS 为该应用窗口保存的内容 `~/Library/Preferences/app.busy.emulator.plist`；
- 数据文件夹 `~/Library/Application Support/BUSY Bar Emulator/`（如果你也想把数据删掉）。

对 agent，对应以下命令；执行最后一行前请先征得用户同意：

```sh
"$HOME/.busy-emulator/bin/busy-emulator" quit
rm -rf "$HOME/Applications/BUSY Bar Emulator.app" "$HOME/.busy-emulator"
rm -f "$HOME/Library/Preferences/app.busy.emulator.plist"
rm -rf "$HOME/Library/Application Support/BUSY Bar Emulator"
```

如果应用在 `/Applications` 中，就在那里删除。macOS 上没有卸载程序：除 GitHub CLI 的登录信息（见上文）之外，这四个位置就是应用写入磁盘的全部内容。

macOS 会保护已运行过的公证应用不被其他程序修改。如果 `rm` 对 `BUSY Bar Emulator.app` 回答 "Operation not permitted"（且 macOS 提示你的终端被阻止修改应用），可改为在 Finder 中把应用拖到废纸篓，或在 **System Settings → Privacy & Security → App Management** 中允许你的终端。其他三个位置不受此保护。
