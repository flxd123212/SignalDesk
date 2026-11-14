# Windows 发行与验证

适用版本：SignalDesk 0.1.2 / Windows x64，2026-11-15。

## 分发文件

- `release/SignalDesk-Setup-0.1.2-x64.exe`：中文安装向导，当前用户安装，可选择安装目录，创建桌面与开始菜单快捷方式，包含卸载程序。
- `release/SignalDesk-Portable-0.1.2-x64.exe`：单文件自解压运行，不要求安装 Node.js；用户数据使用与安装版相同的 SignalDesk 用户目录。它不是将用户数据保存在 EXE 旁的 U 盘模式。
- `release/win-unpacked/`：未压缩的完整程序目录，供开发验证；只拿走其中 EXE 将不能运行。

## 运行资源

0.1.1 默认离线启动并迁移旧的 demo 启动配置为未匹配串口。桌面采用一体化标题栏和 Windows 原生窗口按钮。串口发现每秒轮询，插入提示可在“设备与连接”设置中关闭，发现操作不会自动发送识别指令。

使用白名单包含 `dist/`、`server/`、`shared/`、桌面入口、图标与生产依赖。Node native serialport 模块、QuickJS WASM/worker、外部 MCP/CLI 脚本均保留实际文件路径，当前包使用 `asar: false`。打包不触发本机串口连接或硬件烧录。

示例模板置于资源目录；启动时复制到 `%APPDATA%/SignalDesk/examples`（通常位置，以 Electron userData 为准），不覆盖已有文件。设备、录制、审计日志与源码修改记录继续使用用户目录。源码工程使用用户选择的外部目录，安装与升级不会迁移或覆盖用户的工程。

MCP/CLI 配置由界面生成：命令使用当前 EXE，环境包含 `ELECTRON_RUN_AS_NODE=1`，脚本指向安装资源；无需系统 Node.js。只有已启用的连接和权限才可调用。Portable 解压目录每次可能变化，重启后应重新复制外部连接配置；连接令牌本来就仅在服务运行期间有效。

## 自动检查

`npm run test:package` 在源码目录之外启动打包后的 EXE，并使用独立临时用户目录验证：

- 安装资源启动、示例可读写且重启后保留用户编辑。
- native 串口列表、QuickJS worker/WASM 求值、GLB 静态模型、动态波形。
- 设置持久化和多窗口同步；独立工具窗口共享采集，关闭窗口不关闭仍在使用的服务。
- 打包环境的 CLI 子进程与 MCP stdio 客户端读取实际服务。

可设置 `SIGNALDESK_TEST_EXE` 指向安装后的 `SignalDesk.exe` 复用此验证。

免安装启动器不转发 Node inspector 管道，直接对它运行 `test:package` 会超时；使用 `node tests/portable-smoke.mjs` 经本机临时 Chromium 调试端口验证自解压、波形、设置写入与关闭退出。该测试不修改实际用户数据，也不访问正在运行的用户工作区。

安装器已在本机以当前用户方式安装到 `%LOCALAPPDATA%/Programs/SignalDesk`，退出码 0；桌面及开始菜单快捷方式均指向安装的 `SignalDesk.exe`。安装目录的前端入口 SHA256 与构建产物一致，安装后的 EXE 已通过 `test:package`。两个发行 EXE 的 SHA256 和大小记录在 `release/release-manifest.json` 与 `release/SHA256SUMS.txt`。

未提供代码签名、自动更新服务或 ARM64 发行包。安装成功和软件回归通过不代表已实测全部 MCU、下载器或高波特率物理链路。
