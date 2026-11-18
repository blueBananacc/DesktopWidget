# 从源码构建

本仓库存放着构建收工牌模拟器发行版所需的一切。发行版发布的文件（macOS 的磁盘镜像和 zip、Windows 的安装程序）都是在此仓库的发行 tag 上、用下面的命令构建的。你自己构建出来的是同一个应用，只是没有签名：发行版的 macOS 文件还用 Developer ID 签名并经 Apple 公证，这需要维护者的证书。

每种系统构建各自的文件：Mac 构建 macOS 的文件，Windows PC 构建安装程序。

## 你需要什么

| | macOS（Apple Silicon 或 Intel） | Windows 10 或 11（x64） |
|---|---|---|
| Node | 22 或更高版本，含 npm | 22 或更高版本，含 npm |
| git | Xcode Command Line Tools 自带（`xcode-select --install`），或任意其他 git | Git for Windows |
| 其他程序 | 无：`codesign`、`hdiutil`、`ditto` 和 `plutil` 都是 macOS 自带的 | 无：.NET Framework 4 的 C# 编译器（`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）是 Windows 自带的，它负责构建安装程序和命令行的启动器 |
| 可用磁盘 | 正式构建 6 GB，测试变体 2 GB | 相同 |
| 网络 | 需要，用于下面的下载 | 相同 |

构建会下载三样东西，每样都锁定一个版本，并在使用前对照其 SHA-256 校验：Electron 45.2.3（由 `npm ci` 从 GitHub 上 Electron 的 releases 下载）、打进应用里的 Node 24.22.2（来自 nodejs.org；`packages/app/bundled-node.json`），以及 GitHub CLI 2.103.3（来自 GitHub 上它的 releases；`packages/app/bundled-gh.json`）。它们保存在仓库之外的缓存中，因此下次构建无需再下载：macOS 上是 `~/Library/Caches/busy-emulator-build`，Windows 上是 `%LOCALAPPDATA%\busy-emulator-build`。

## 构建应用

在仓库顶层文件夹中：

```sh
cd packages/app
npm ci                                    # Electron and the build's tools
node node_modules/electron/install.js     # Electron's program for this system, if npm ci did not fetch it
npm run dist -- --arch arm64              # macOS, Apple Silicon (--arch x64: Intel; no --arch: both)
npm run dist                              # Windows
```

构建必须基于一个提交：`npm run dist` 会拒绝有改动的工作树，应用也会记录它构建自哪个提交。产物落在仓库之外：

| | 位置 | 内容 |
|---|---|---|
| macOS | `~/Library/Caches/busy-emulator-build/dist/release/` | `busybar-emulator-mac-arm64.dmg` 和 `.zip`（Intel 为 `x64` 版本） |
| Windows | `%LOCALAPPDATA%\busy-emulator-build\dist\release\` | `busybar-emulator-win-x64-setup.exe` |

`--out <folder>` 可以把它们放到别处，但绝不能放进仓库。下载进入缓存后，一次构建不到一分钟：Mac 上一种架构，Windows 上一个安装程序。

**你的构建没有签名。** 在 macOS 上它只带临时（ad hoc）签名，而发行版用 Developer ID 签名并经公证；在 Windows 上两者都未签名。你在自己电脑上构建的文件不带"从互联网下载"标记，所以在本机上 macOS 和 Windows 打开它都不会警告。经由浏览器、聊天工具或邮件拷到另一台电脑后它就带上这个标记，首次启动时需要对未签名构建的操作：macOS 上 **系统设置 → 隐私与安全性 → 仍要打开**（与 [0.1.0-beta.4 之前的发行版](install.md#macos) 相同），Windows 上 **More info → Run anyway**。

## 检查构建

冒烟测试通过构建产物自带的命令行启动它，在它的收工牌上安装一个应用并运行，然后把正面屏幕与预期画面比对。它运行的是测试变体——其文件夹取自测试而非你本人的构建，因此绝不会碰你的数据文件夹或正在运行的模拟器：

```sh
cd packages/app
npm run dist -- --kind test               # the test variant, for this computer
cd ../..
npm run smoke                             # starts it on port 8770 (--port <n> for another)
```

## 运行测试

在仓库顶层文件夹中（先在 `packages/app` 里执行过 `npm ci`）：

```sh
node test/gate.mjs
```

它会运行本仓库的全部测试，在空闲端口上启动自带临时文件夹的模拟器，最后给出一个总结。退出码 0 表示"全绿"。总结会列出在本机不运行的测试以及它们在哪里运行：Windows 的测试在 Windows 上，发行版自身文件的测试在发布时。在近年的 Mac 上约需 10 分钟，Windows 上约 15 分钟；期间最好不要让别的程序占用电脑，因为有些测试套件会测量模拟器的速度。

## 固件的 WebAssembly

模拟器运行的是收工牌固件自己的代码：`packages/engine/build/<firmware>/runtime.wasm`（JavaScript 运行时）和 `screen.wasm`（屏幕、GUI、系统程序）都由开源固件 busy-app/busybar-firmware 编译而来。它们已提交进仓库，所以构建应用时不会编译它们。若要重新构建并验证字节完全一致：

- 每个模块的固件提交在 `packages/engine/firmware.json`（`1.3.1`：`8edd2da42ed2`，`dev`：`4d1c24ac38e4`）以及 `packages/engine/build/<firmware>/build-info.json` 中；
- 编译器是 `firmware.json` 所指定版本的 Emscripten SDK，7.0.0；
- 模拟器对固件代码的全部改动都在 `packages/engine/patches.mjs` 中，构建时应用到副本上；用来替代固件 OS 层、存储和网络的是 `packages/engine/native/`；
- 构建脚本是 `packages/engine/build.mjs`（`--help` 会说明它编译什么、替换什么）。

在 macOS 上，在仓库文件夹旁边：

```sh
git clone https://github.com/emscripten-core/emsdk.git
emsdk/emsdk install 7.0.0
emsdk/emsdk activate 7.0.0
source emsdk/emsdk_env.sh                 # puts emcc on PATH and sets EMSDK

git clone https://github.com/busy-app/busybar-firmware.git
cd busybar-firmware
git checkout 8edd2da42ed2facbab73796c456746e7dcbed2e7
git submodule update --init --recursive lib/jerryscript lib/lvgl lib/mongoose lib/cjson lib/stb/stb_repo lib/heatshrink \
  fbt_layers/core_libs fbt_layers/fbtng
cd ../busybar-emulator

node packages/engine/build.mjs --firmware-repo ../busybar-firmware
git status --short packages/engine/build  # prints nothing: the same bytes as committed
```

收工牌的 API 文档（`build/<firmware>/docs`，经 `/docs/` 提供访问）由固件自带的两个脚本生成，与其构建流程一致：它们需要装有 PyYAML 和 colorlog 的 Python 3（`python3 -m pip install pyyaml colorlog`）。

两个固件版本锁定的是这八个库相同的提交，所以一次检出就能构建两者。当每个模块都与已提交的字节逐字节相同时，构建以 `nothing in build/ changed` 结束：只有字节不同的文件才会被重写。输出不依赖构建所在的文件夹或日期（路径会被映射，日期时间宏被拒绝使用）；但它依赖编译器，换用其他 Emscripten 版本时构建会警告模块将有差异。已提交的模块是在 macOS 上构建的。在近年的 Mac 上构建不到一分钟；固件及其库占 1.1 GB 磁盘，SDK 占 2 GB。

## 3D 视图的播放器

收工牌的 3D 视图用 Tride web player 0.16.0 绘制，这是模拟器中唯一不开源的部分。它适用 Tride Labs Ltd 的 Tride Players Licence 1.2，而非模拟器的许可证。其文件原样提交在 `packages/stage/frame/player/` 中，旁边是播放器的 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`；`packages/stage/versions.json` 记录了每个文件的 SHA-256，测试会核对它们。构建不为它下载任何东西。本仓库不是获取该播放器的地方：https://github.com/trideapp/tride-web 才是。

收工牌的模型（`packages/stage/frame/scene/bar.trd`）© Flipper FZCO，保留所有权利，仅随模拟器自己的 3D 视图发布。

没有其他东西依赖 3D 视图。缺少播放器文件时（比如从 fork 中被删掉），3D 视图不会出现，窗口保持默认的平面视图；其余一切照常工作。
