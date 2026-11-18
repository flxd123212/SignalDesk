# Linux 与 macOS 适配

## 状态

0.1.6 已补充 Linux/macOS 的启动、窗口、快捷键、串口路径、工具发现、构建配置和回归测试。本次 Release 只提供 Windows 版本；新增平台的安装包需在对应系统完成 CI 构建和原生测试后发布。

不能将 Windows 上的单元测试或模拟串口测试视为 Linux/macOS 实物串口验证。当前机器只能直接验证 Windows。

| 平台 | 构建产物 | CI 环境 |
| --- | --- | --- |
| Windows x64 | NSIS 安装包、Portable EXE | windows-2022 |
| Linux x64 | AppImage、deb | ubuntu-24.04 |
| macOS Apple Silicon | DMG、ZIP | macos-15 |
| macOS Intel | DMG、ZIP | macos-15-intel |

Linux ARM64 可在对应主机尝试源码运行，但未加入当前构建矩阵。没有配置 Apple 开发者签名或公证凭据；macOS 产物不能宣传为已签名、公证的正式发行版。

## 从源码运行

使用 Node.js 22.12 或更新版本。在仓库根目录执行：

```sh
npm ci
node node_modules/electron/install.js
npm run build
npm start
```

打包必须在目标系统执行，默认采用构建机的 CPU 架构：

```sh
# Linux
npm run package:linux

# macOS
npm run package:mac

# 当前操作系统的解包目录
npm run package:dir
```

构建使用仓库中的图标，不再依赖 PowerShell。`npm run icon` 仅是 Windows 上重新生成图标源文件的可选维护命令。

## 桌面体验

- Windows/Linux 使用一体化标题栏和系统窗口按钮；macOS 使用左侧红黄绿按钮、系统应用菜单和窗口菜单。
- macOS 菜单和快捷键帮助显示 `Cmd`、`Option`；支持 `Cmd+P`、`Cmd+K`、`Cmd+,`、`Cmd+B`、`Cmd+J`、`Cmd+Shift+B`。
- 四工作区快捷键为 Windows/Linux 的 `Ctrl+Alt+1..4`，macOS 的 `Cmd+Option+1..4`。
- macOS 关闭最后一个窗口后保留应用；点击 Dock 图标重新打开主工作区。退出应用使用 `Cmd+Q`。
- `Esc` 可退出全屏，macOS 另有原生 `Control+Command+F`，`F11` 仍可使用。
- 窄窗口自动收起工程树，避免挡住中央内容；返回宽窗口时保留原有桌面侧栏偏好。

## 串口与蓝牙

| 系统 | 典型串口 |
| --- | --- |
| Windows | `COM3`、`COM7` |
| Linux | `/dev/ttyUSB0`、`/dev/ttyACM0`、`/dev/serial/by-id/...` |
| macOS | `/dev/cu.usbmodem...`、`/dev/cu.usbserial...` |
| Linux 蓝牙 SPP | 系统完成绑定后的 `/dev/rfcomm0` |

Unix 设备路径区分大小写，不再通过统一转成小写来匹配；COM 名称继续按大小写不敏感处理。设备发现仍基于系统串口枚举，插入设备不会主动发送探测报文。

Linux 出现权限错误时，先用 `ls -l /dev/ttyUSB0` 检查设备所属组及权限，并按发行版规则授权当前用户。常见组为 `dialout` 或 `uucp`，修改组成员后通常需要重新登录。不要用 root 启动整个应用，也不要统一开放全部设备的读写权限。USB 下载器还可能需要厂商的 udev 规则。

macOS 通常使用 `/dev/cu.*` 端口；若设备不出现，应检查 USB 线、系统驱动支持和其他程序占用。波特率、校验位、流控的可用范围取决于适配器和系统驱动，配置项不能保证所有硬件都支持。

串口连接页使用系统提供的 Classic SPP 虚拟串口。工程实验工具通过 Bleak 访问 BLE GATT，支持按设备地址或系统 UUID 选择外设。macOS 和 Linux 使用系统蓝牙权限。见[仪器与源码调试](BENCH.md)。

## 编译器与工具链

优先搜索 `SIGNALDESK_TOOLCHAIN_PATH` 和当前 `PATH`，再补充常见 GUI 启动环境下缺失的目录：

- `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`
- `~/.local/bin`、`~/.cargo/bin`、`~/go/bin`
- `~/.platformio/penv/bin`
- macOS 的 CMake / STM32CubeProgrammer 应用目录

可在启动前配置额外目录：

```sh
export SIGNALDESK_TOOLCHAIN_PATH="/opt/arm-toolchain/bin:/opt/embedded/bin"
npm start
```

GCC 还支持 `ARM_GCC_PATH`、`RISCV_GCC_PATH`，IAR 支持 `IAR_PATH`。POSIX 上检查可执行权限，Python 自动尝试 `python3`，IAR 自动尝试 `iarbuild`。ESP-IDF 需要在已激活 SDK/Python 环境的终端中启动软件。工程的 CPU、ABI、链接脚本和启动文件仍由工程提供。

Keil µVision 的编译和下载入口在非 Windows 系统禁用；仍可查看工程与 Target。IAR 只有安装了对应主机版本和有效授权后才可构建，不将 Windows 的 `IarBuild.exe` 视为 Linux/macOS 程序。

构建和下载任务在 POSIX 上使用独立进程组，停止任务会终止其子进程，不再只终止外层进程。

## 设置与安全存储

Electron 管理各平台用户数据目录。独立工作区、设备、项目、会话及偏好继续按原有边界保存，不会自动连接真实硬件或恢复执行旧任务。

- Windows 使用系统数据保护；macOS 使用系统钥匙串。
- Linux 需要可用的系统密钥存储后端。如果 Electron 返回 `basic_text` 或安全存储不可用，SignalDesk 不会把 API Key 降级保存为明文。
- 独立 Node 服务仍仅保存非密钥配置和可见会话。跨机器复制用户目录不能保证加密密钥可解密。

## CI 与验证

`.github/workflows/desktop-platforms.yml` 在各原生 runner 上执行依赖安装、后端测试、前端构建、工作区与快捷键测试、Electron 冒烟、打包及打包目录冒烟，再上传构建产物。它不自动创建 Release，不访问用户设备或真实 AI Key。打包目录冒烟不等于完整执行 DMG/deb 安装或 AppImage/FUSE 挂载测试。

Linux CI 给测试用 Electron 的 `chrome-sandbox` 辅助程序配置正确的 root 所有权与 4755 权限；不修改主机全局内核安全设置，也不传入 `--no-sandbox`。普通用户安装使用发行包及其安装脚本。

```sh
npm test
npm run build
npm run test:platform
npm run test:platform-desktop
```

浏览器测试在 Windows 默认使用 Edge，在其他系统使用 Playwright Chromium；也可通过 `SIGNALDESK_BROWSER_CHANNEL` 指定通道。Linux 无显示环境下可使用 `xvfb-run -a npm run test:platform-desktop`。没有通过禁用 Electron 沙箱来处理安装或权限问题。

发布前仍需目标系统实测：USB 热插拔、串口持续收发、蓝牙 SPP、编译/下载器、系统钥匙串重启、HiDPI 与独立窗口，以及 Linux Wayland/X11、AppImage 运行环境和 macOS 签名/公证。
