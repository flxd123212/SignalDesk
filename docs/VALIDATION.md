# 验证记录

最新验证日期：2026-11-16。测试产物另带运行时间戳。

## 0.1.9 Agent 预算暂停与任务恢复

- 依据用户截图中的 8/8 步、1/4 项计划及 DSML 尾标记定位问题：预算停止被误标为完成，异常工具格式缺少明确提示。本轮只读研究 Bigfish 0.1.2 和 DeepSeek Harness 0.1.0-rc.6 安装副本，未读取用户凭证或修改其安装，研究范围见 [Bigfish 记录](BIGFISH_AGENT_REVIEW.md)。
- 最终 `npm test`：175 项通过，0 失败，2 项 POSIX 用例在 Windows 跳过。新增预算暂停、手动续接、只读/日志边界、失败与中断后的工具配对、历史摘录、旧存档恢复及 DSML 拒绝用例。并行验证期间曾遇到既有硬件测试的 Windows 临时目录 `ENOTEMPTY` 清理错误，未修改该测试或硬件实现；界面测试结束后完整复测通过。
- `npx playwright test`：67 项全部通过，约 4.6 分钟。新增真实本机模型夹具的两步预算耗尽、暂停入口、12 步手动继续、过期会话拒绝、证据续接、DSML 错误、只读工具可见性、历史摘录及窄屏检查。测试不调用用户真实 API，不执行用户工程或开发板指令。
- `npm run build` 通过 TypeScript 和 Vite。截图 `artifacts/agent-budget-paused-desktop.png`、`agent-budget-paused-mobile.png`、`agent-dsml-recovery-mobile.png` 展示的是测试夹具。界面提供等待秒数，不宣称接入了 token 流式输出。
- 最近八轮原生历史及有界摘录共受 128000 字符预算约束，不等于无限上下文或模型语义压缩；继续一次任务不放开实际写入、串口、工具链或烧录权限。
- `npm run package:win` 生成 0.1.9 安装器与便携 EXE，ProductVersion 为 0.1.9.0；前端入口及四个关键后端文件与解包目录的 SHA256 一致。`npm run test:package` 通过主会话预算暂停、重启恢复继续入口、原生续接保留、外部会话仍只读，以及原有源码、教程、串口枚举、QuickJS、GLB、动态波形、独立窗口和 CLI/MCP 检查。测试明确在外部连接验证后切回内置主会话，不将外部只读恢复策略改成可执行。
- `node tests/portable-smoke.mjs` 通过实际单文件 EXE 的自解压、隔离数据、动态波形、设置保存及退出。两份发行文件校验值已更新；本轮未覆盖用户安装、未改用户工程、未上传 GitHub。Linux/macOS 本轮没有原生验证结果。

## 0.1.8 内置教程与使用体验

- 新增 11 套离线教程、40 个步骤，覆盖设备连接、工程编译、波形节点、硬件联调、测试报警、Agent 与进阶工具。首次提示不阻塞工作区，可关闭；帮助菜单、F1、侧栏及功能搜索均可进入。教程只导航，不代替用户发送指令、烧录、调用模型或运行工具链。
- `npm test`：167 项通过，0 失败，2 项 POSIX 测试在 Windows 跳过。新增教程数据、导航动作边界、进度规范化与混合报文示例的真实字节校验。实际编译用例在允许访问系统 SDK 的沙箱外通过。
- `npx playwright test`：65 项全部通过，约 4.5 分钟。包含首次引导、跨刷新进度、F1 上下文帮助、真实设置跳转、精简模式、旧偏好导入和重置保留进度、键盘焦点、减少动画及 390px 窄屏；原有串口、波形、Agent、节点、硬件和编译测试全部通过。
- `npm run build` 和 `npm run package:win` 通过，生成 0.1.8 安装器及便携 EXE。`npm run test:package` 通过实际 EXE 的教程打开、第三步位置重启恢复，以及大文件源码、Agent 附件、CLI/MCP、原生串口枚举、动态波形和共享窗口回归。源码快捷搜索测试等待实际文件结果后再回车，避免文件列表异步加载的竞争。
- `node tests/portable-smoke.mjs` 通过自解压启动、隔离用户目录、动态波形、设置持久化及正常退出。发行文件 SHA256 已写入 `release/SHA256SUMS.txt` 和 `release/release-manifest.json`。
- 截图：`artifacts/tutorials-desktop.png`、`artifacts/tutorials-mobile.png`、`artifacts/packaged-tutorial.png`。测试使用隔离数据与本机模型/设备夹具，不使用真实 API Key，不修改用户工程或现有安装；产品默认仍离线。本轮未上传 GitHub，没有 Linux/macOS 原生运行结果。

## 0.1.7 大文件源码修复

- 复现原因：用户的 `water_rig.ino` 为 165772 字节、3108 行，被旧的 96 KiB 上限拦截。通过修复后的读取接口完整读取并核对原始 SHA256，未修改该工程文件；未编译、烧录或执行用户固件。
- `npm test`：164 项通过，0 失败，2 项 POSIX 测试在 Windows 跳过。新增大文件读取、8 MiB 边界、UTF-8 检查、按行截断标记、局部补丁、用户确认、CRLF、备份、过期 SHA 和 Agent 大文件附件链路测试。实际 C/C++ 编译用例在允许访问系统 SDK 的沙箱外通过。
- `npm run build` 通过。项目工作区与 Agent 工具界面专项共 6 项通过；新增大文件高亮、搜索、2500 行以后跳转、函数大纲、Agent 审查入口与 390px 窄屏检查。测试服务器在沙箱内退出清理挂起，确认所有用例完成后仅关闭本次测试服务器，测试进程退出码为 0。
- `npm run package:win` 生成 0.1.7 安装包和免安装版。`npm run test:package` 通过实际解包 EXE 的大文件打开与 Agent 附件、本地模型夹具、原生串口枚举、QuickJS、GLB、动态波形、独立窗口、CLI/MCP 和设置重启恢复。测试新增工作区切换后重新设置当前工作区的导航展开偏好，再核对重启恢复，未更改产品的分工作区布局逻辑。
- `node tests/portable-smoke.mjs` 通过单文件自解压、隔离用户目录、离线启动、动态波形、设置持久化及正常退出。安装包未在本轮覆盖用户的既有安装，也未上传 GitHub；没有 Linux/macOS 本轮原生运行结果。
- 截图：`artifacts/ide-large-source-desktop.png`、`artifacts/ide-large-source-mobile.png`、`artifacts/packaged-large-source.png`。截图中的源码、模拟设备及模型接口均为隔离测试夹具，不是用户硬件的运行证据。

## 0.1.6 本地安装更新

- `npm run package:win` 通过，生成 0.1.6 安装包和免安装 EXE；资源版本为 0.1.6.0。33 个关键源码与前端资源的 SHA256 和解包目录一致。
- `npm run test:package` 通过：实际打包 EXE 在隔离目录启动，验证 native 串口枚举、QuickJS、GLB、动态波形、共享仪器窗口、CLI、MCP、Agent 终端、设置重启及示例修改保留。
- `node tests/portable-smoke.mjs` 通过单文件自解压、隔离数据目录、动态波形、设置保存及正常退出。
- 0.1.6 安装器以当前用户方式更新到 `%LOCALAPPDATA%/Programs/SignalDesk`，退出码 0；安装后的 ProductVersion 为 0.1.6.0，桌面和开始菜单快捷方式均指向该程序。
- 安装前后核对 `%APPDATA%/SignalDesk` 内 240 个既有文件的 SHA256，全部一致。未通过启动实际用户工作区执行恢复测试；测试均使用隔离目录，不读取用户真实 API Key。
- 对实际安装的 EXE 运行 `npm run test:agent-restart` 和 `npm run test:platform-desktop` 均通过，验证系统加密配置、多会话、原生工具上下文、清除操作、离线重启、四工作区快捷键和独立窗口。
- 发行文件校验值已更新到 `release/SHA256SUMS.txt` 和 `release/release-manifest.json`。本次先更新本机，未上传 GitHub Release；Linux/macOS 仍待原生构建和实测。

## 0.1.6 功能合并：四工作区、硬件关联与跨平台

- 最终 `npm test`：160 项通过，0 失败，2 项 POSIX 进程组取消测试在 Windows 跳过。包含节点模板、生成的 Python/JavaScript 与预览数值对比、网表解析与工程隔离、映射冲突保护、新鲜采样反馈断言、语言构建计划和串口大小写处理。
- 最终 `npx playwright test`：59 项全部通过，耗时约 4.3 分钟。覆盖四工作区、共用工程树、属性/Agent 切换、独立仪器窗口、节点模板/表单连线/撤销/键盘移动、网表到引脚到源码和反馈测试草稿，以及原有设备、仪器、协议、Agent、主题和编译测试。
- 初轮发现窄窗口隐藏侧栏时连带隐藏工程绑定弹窗，已将弹窗移到应用根容器，保留主题变量并验证缩放后继续保存；节点画布尺寸改变后重新适应视图。按四工作区更新旧导航测试入口，保留原有行为断言。
- `npm run build` 通过 TypeScript 与 Vite 构建。仍有前端 chunk 大于 500 kB 的优化提示，不影响此次构建通过，未将其当作性能达标证明。
- `npm run test:desktop` 通过 Windows 原生窗口、全屏退出、目录选择、波形和独立工作区；`npm run test:agent-restart` 通过系统加密密钥、多会话和工具上下文的实际重启恢复，使用隔离数据目录与本机模型夹具。
- `npm run test:platform-desktop` 在开发运行时与功能合并阶段的 Windows 解包目录均通过，验证 native 串口模块加载/枚举、QuickJS、工作区快捷键、独立窗口和设置重启。该阶段测试程序位于 `release/platform-check/win-unpacked/SignalDesk.exe`；后续 0.1.6 安装结果见上节。
- 新增 Windows、Linux、macOS Apple Silicon 与 Intel 的原生 CI 矩阵，配置 AppImage/deb 和 DMG/ZIP。当前主机只能实测 Windows；Linux/macOS CI 尚未执行，也没有这些系统的实物串口、烧录器、系统钥匙串、安装器或签名/公证验证结果。
- 新截图：`four-workspaces-desktop.png`、`nodes-workbench-desktop.png`、`nodes-workbench-mobile.png`、`hardware-live-map.png`、`project-binding-mobile.png`、`platform-win32-x64-packaged.png`，位于忽略的 `artifacts/`。其中设备与网表来自测试夹具，正式启动仍保持离线。

范围与使用方式见 [工作区说明](WORKSPACES.md) 和 [跨平台适配](CROSS_PLATFORM.md)。硬件联调展示网表连接及绑定遥测，不是电气仿真；当前没有原生 EDA 编辑、ERC/DRC、任意图片自动识图或 SWD/JTAG 调试。

## 0.1.5 动画与主题验证

- `npm run build` 通过。动画、主题与背景、设置、独立窗口、Agent 终端及工具的 Playwright 专项共 11 项通过，本轮未重跑全部界面用例。
- 启动页在主应用脚本加载前出现，进度跟随真实状态；模拟脚本延迟验证 12 秒超时后的恢复入口、Esc 退出、系统动态效果切换与独立窗口跳过。
- 验证柔和/灵动、关闭动画、偏好重载、主题 HEX 校验、深色按钮前景色、图片保存/恢复/移除、无效文件保护、填充/遮罩/模糊及 390px 布局。波形页面切换保留暂停状态，继续后画布数据更新。
- `node tests/desktop-smoke.mjs` 通过原生窗口、全屏/退出、波形、Agent、独立工作区和目录选择。`node tests/appearance-desktop.mjs` 实际重启桌面，验证 WebP 文件与主题恢复、非法图片/路径拒绝及按标识移除。
- `node tests/agent-desktop-storage.mjs` 再次通过三次桌面启动，验证加密密钥、多会话、原生工具历史及最后窗口关闭后的保存，未使用真实 API Key。
- 截图：`startup-desktop.png`、`startup-mobile.png`、`motion-settings.png`、`theme-background-settings.png`、`theme-background-workspace.png`、`theme-background-mobile.png`、`theme-desktop-restored.png`，位于忽略的 `artifacts/`。背景为测试生成图，模拟设备仅用于回归；产品默认仍离线。
- 0.1.5 安装与免安装 EXE 已生成，ProductVersion 为 0.1.5.0。19 个桌面入口、背景模块及前端资源文件与构建产物哈希一致；发行文件 SHA256 已写入 `release/release-manifest.json` 与 `release/SHA256SUMS.txt`。
- `npm run test:package` 通过干净目录启动、native 串口枚举、QuickJS/WASM、GLB、动态波形、共享工具窗口、CLI/MCP、设置重启及源码保留检查；对打包 EXE 运行 `tests/appearance-desktop.mjs`，背景文件、主题与动画偏好重启恢复同样通过。
- `node tests/portable-smoke.mjs` 通过 0.1.5 单文件 EXE 的自解压、隔离用户目录、动态波形、设置持久化与正常关闭检查。本轮验证使用隔离目录，没有覆盖本机已有安装。

## 0.1.4 Agent 工作区验证

- `npm test`：146 项通过，0 跳过，覆盖加密存档、多个设备/会话恢复、密钥清除、上下文续接、只读外部会话、写入失败/损坏文件保护，以及新增项目工具、局部补丁与权限边界。
- `npm run build` 通过。Agent 工具、终端、运行控制、接口设置、外观设置与独立窗口的 Playwright 专项共 6 项通过。验证工具结果与源码跳转、计划、搜索、390px 窄屏、动画关闭及系统减少动态效果；本轮未重跑全部界面测试。
- `node tests/agent-desktop-storage.mjs` 在隔离用户目录实际启动 Electron 三次，通过系统加密保存、恢复 API Key、多个会话与原生工具历史、清除密钥/会话、关闭最后窗口等待保存、离线重启检查。使用本机 HTTP 模型夹具，不调用用户真实 API。
- 新截图：`artifacts/agent-toolbox-desktop.png`、`agent-toolbox-mobile.png`、`agent-tools-results.png`、`agent-restored-desktop.png`、`agent-encrypted-settings.png`。截图中的模拟设备和测试 API 仅用于验证，产品仍默认离线启动。
- 0.1.4 安装包和免安装包已生成。`npm run test:package` 通过原生串口模块、QuickJS、GLB、动态波形、多窗口、CLI/MCP、设置重启与用户源码保留检查；指定打包 EXE 的 `tests/agent-desktop-storage.mjs` 再次通过三次重启恢复验证；`node tests/portable-smoke.mjs` 通过自解压运行、设置写入和关闭退出。
- EXE ProductVersion 为 0.1.4.0，13 个关键源码/前端资源文件与打包目录哈希一致，打包元数据版本一致。两份 EXE 校验值记录在 `release/SHA256SUMS.txt` 与 `release/release-manifest.json`。未覆盖现有安装，未上传新的 GitHub 发行版。

## 0.1.3 Agent 更新验证

- `npm test`：134 项通过，0 跳过；新增模型来源、四协议完整工具上下文、模型切换和上下文限额/重置测试，后续追加 DeepSeek 三种官方入口、思考参数、模型目录和子代理结果续接测试。
- `npm run build` 通过；Agent 终端、运行恢复和接口设置专项 Playwright 共 3 项通过，覆盖桌面、IDE 分栏及 390px 窄屏。未在本轮重跑全部界面用例。
- 新截图 `artifacts/agent-call-record-desktop.png` 使用本机 HTTP 夹具，显示请求别名与返回 ID 不同的场景。测试不消耗用户密钥，不能验证截图那次线上调用的底层模型。
- `npm run package:win` 生成 0.1.3 安装包和免安装版。`npm run test:package` 在独立数据目录通过，额外验证打包后的模型来源记录、上下文重置、原生串口枚举、CLI/MCP、独立窗口与重启；`node tests/portable-smoke.mjs` 通过自解压、离线启动、波形、设置持久化与退出检查。
- 打包 EXE ProductVersion 为 0.1.3.0；未覆盖用户原安装。两个发行文件的 SHA256 已写入 `release/SHA256SUMS.txt` 和 `release/release-manifest.json`。本轮生成的是本地发布产物，未上传新版本到 GitHub。

## 0.1.1 更新验证

- 0.1.1 安装器退出码 0，实际安装 EXE 报告版本 0.1.1.0；桌面和开始菜单快捷方式目标正确，安装目录前端入口 SHA256 与最终构建一致。实际安装 EXE 的隔离打包回归通过，0.1.1 单文件免安装版实测通过。
- `npm run build` 通过，`npm test` 109 项全部通过、0 跳过。新增串口轮询、插拔、扫描失败恢复、USB 身份变更、绑定上下文检查、默认离线启动的测试。
- 本轮完整界面回归 45 项中 44 项通过，包含新增的两项设备发现测试。源码导航项首次因 `Failed to fetch` 中断；单独复测通过高亮、折叠、跳转和快捷键断言，在最后移动端截图时浏览器进程退出，因此本轮不能声明全部界面回归通过。
- 当时测得 Windows `Memory/% Committed Bytes In Use` 为 99.30%。首次打包检查出现进程退出和页面崩溃；结束并行压缩后，单独运行 `npm run test:package` 通过。未关闭用户应用，也未更改系统内存配置。
- 实际桌面测试通过：40px 一体化标题栏、原生窗口按钮预留区域、780px 窄窗口无遮挡、最大化还原、F11/Esc、文件菜单新建工作区、设备发现入口、默认不连接模拟设备。
- 设备插拔使用 SerialPortMock 覆盖完整传输 API；截图中的 COM93 / ESP32-S3 是测试夹具。检测期间 Windows 与 native serialport 均未列出真实 COM 口，尚未完成实物热插拔验证。
- 新截图：`artifacts/integrated-titlebar.png`、`discovered-device.png`、`discovered-device-mobile.png`。网页截图不包含由 Windows 绘制的原生标题栏按钮。

## 0.1.0 验证基线

- `npm run build`：TypeScript 与 Vite 构建通过。
- `npm test`：105 项全部通过，0 跳过。包含示例工程不覆盖、设置设备/会话/工程上下文防错，以及项目识别与绑定、诊断解析、源码/配置防旧结果、GCC 固定计划、实际 MSVC/CTest 与 RISC-V GCC 构建，以及原有串口、Agent、协议、FFT、CAN、CLI、蓝牙 Mock 等用例。
- `npm run test:ui`：43 项全部通过。包含统一设置、偏好导入/导出/恢复、常用导航自定义、按需展开的 Agent 控件、独立工具窗口，以及既有的项目导入、IDE、语法高亮、示波器、协议、编译测试、GCC 与模型回归。最后补测发送栏强制隐藏优先级，设置专项 2 项通过。
- Three.js 画面在桌面与 390px 窄屏通过 WebGL 像素非空、姿态改变和鼠标轨道交互检查；ESP32-S3 样例检查 44 个命名排针、U3/D6 元数据与导出 GLB 尺寸元数据。
- 7 种细化参考板逐一检查桌面/窄屏非空、顶视/底视；真实 RoyalBlue54L PCB 检查 50 个器件、U1 的 55 个焊盘对象、网络、通道显示、旋转/轨道交互与导出再导入。CAD 网格 8687→131，三角形 149696 不变，边界与位号回归一致。
- KiCad 10.0.6 导出退出码 0；工作副本启用的模型资源无缺失。字体替换与 7 个退化轮廓提示已记录，不能视作机械几何零缺陷。原 PCB 与安装目录原件 SHA256 相同。
- `node tests/desktop-smoke.mjs`：实际 Electron 启动、波形变化、本地 Agent、独立第二窗口、窗口和波形全屏的 F11/Esc 退出、原生工程目录选择、选择目录后的自动扫描和离线项目导入全部通过。
- `tests\codegen-smoke.cmd`：21 种节点图生成的 C99 代码经过 MSVC `/W4 /WX` 编译并执行，输出与预览采样吻合。这不是目标 MCU 时序验证。
- `node tests/decode-benchmark.mjs`：FireWater、JSON、JustFloat、自定义 CRC 帧各 200000 帧，序号连续、解析错误 0。纯软件引擎测得约 12.74..79.71 MB/s；不含物理串口、蓝牙、磁盘录制或浏览器负载，不能当作端到端保证。完整结果见 `artifacts/decode-benchmark.json`。
- Electron 45.3.2，Windows 打包使用 electron-builder 26.18.0。构建工具作为开发依赖，不随运行依赖打入程序。

## 桌面打包与设置

- `npm run test:package`：真实打包 EXE 从临时工作目录启动，验证 native serialport 枚举、QuickJS worker/WASM 计算、GLB 文件、动态波形、MCP stdio、CLI 子进程、可写示例及重启不覆盖用户编辑。
- 工具窗口与父窗口使用同一服务；窗口之间同步偏好。重启后从用户目录恢复颜色和导航，修复首次读取 IPC 提前返回空值的问题。
- 初轮界面回归发现旧测试仍通过被收进菜单的按钮操作，已改为走可见菜单或展开入口，保留原功能断言。补充加载完成前的文件发送保护，以及发送栏“始终收起”优先于手动展开状态的检查。
- 新截图：`artifacts/settings-agent-clean.png`、`settings-editor.png`、`settings-mobile.png`、`packaged-desktop.png`。
- 安装包使用按用户安装与桌面/开始菜单快捷方式；免安装 EXE 自带运行时。发行说明见 [Windows 发行](WINDOWS_RELEASE.md)。
- 安装器退出码 0，已确认桌面与开始菜单快捷方式指向安装 EXE，安装前端入口哈希匹配。安装后的 EXE 通过打包回归；`node tests/portable-smoke.mjs` 实测单文件自解压、动态波形、设置持久化及正常关闭通过。

截图在 `artifacts/`。本轮更新 `workspace-desktop/mobile.png`、`agent-desktop.png`，新增 `studio-focused.png`、`studio-search.png`；先前的 `board-*-desktop/mobile.png`、`ai-provider-settings-desktop/mobile.png`、`pcb-real-model-desktop/top/bottom/mobile.png` 也已回归。真实 PCB 可导入样例为 `royalblue54l-viewer.glb`，详细说明见 `PCB_EXPORT_SAMPLE.md`。

## IDE 工作区与自动配置

- 参考 IDE 的布局结构：顶部文件/视图/工具菜单、默认窄图标栏、可收起的项目/连接侧栏、中央工作页及文件标签、可选 Agent 分栏、可选底部日志与工具链；面板可拖动或用键盘调整尺寸并记忆。
- 根据界面拥挤反馈再次收敛默认显示：源码页隐藏重复的页面标题和串口参数条，发送栏与源码搜索按需展开；Agent 分栏默认隐藏会话/持续分析与低频动作；项目设备列表折叠，底部工具链改用完整横向命令输入。
- 在 1500×950 测试视口，源码与 Agent 同时打开、底部输出关闭时，源码浏览面板高度大于 650 px。完整与精简模式在 1500、1024、390 宽度验证页面无横向溢出；应用截图经实际检查。
- 工程识别支持 PlatformIO 环境及常见继承/变量、Arduino YAML/INO、ESP-IDF、CMake、STM32CubeMX、Keil、IAR。通用桥接器不伪造 MCU，多个目标或同分串口不自动替用户选择。
- 导入用 SerialPortMock 验证了真实传输 API 路径，未向实际开发板写入。源码、主文件、配置采样率、协议、构建环境、端口身份及 Agent 模型同步；API Key 不出现在页面、状态或设备配置文件中。离线项目使用未分配端口，不启动模拟器。
- 本地项目体检无需 AI 接口。通信排查、源码审查、测试方案、解释项目及优化补丁预设只填入请求，不自动运行。直接执行权限未自动开启；只读子代理不能运行工具链。
- 初轮测试暴露导入参数携带只读字段、重复 React key 导致连接条残留，以及标签栏窄屏边距溢出，均已修复。文件快速打开会等待设备上下文就绪，防止初始状态切换重置搜索。
- C/C++ 源码在实际页面检测到 10 种语法颜色，关键字/类型/函数/字符串/数字/注释可辨。代码折叠恢复、大纲定位、`文件名:行号` 快速打开和 Ctrl+B/J 切换面板通过；浏览器输出未出现页面异常。

新增截图：`ide-project-setup.png`、`ide-project-mobile.png`、`ide-source-agent.png`、`ide-source-output.png`、`ide-simple-desktop.png`、`ide-simple-mobile.png`，位于 `artifacts/`。源码示例与 COM88 来自隔离测试夹具，不代表真实 ESP32-S3 实测。

后续源码界面截图：`ide-source-highlighted.png`、`ide-quick-file-mobile.png`。GCC 与 CMake 测试截图使用真实本机编译进程，仍不代表开发板运行测试。

## 编译与交叉工具链

- 源码工具栏与底部结果面板实际执行构建；GCC/Clang、MSVC、Keil、IAR 常见诊断格式解析为文件/行/列。工程外路径保留文本，不跳转读取。
- 本机 CMake 3.31.6 / MSVC / CTest 实编译：成功构建、1/1 用例通过、故意返回非零导致测试失败、未定义标识符导致真实编译失败及行号跳转均有测试覆盖。
- 新源码未重新编译时拒绝执行旧 CTest 程序。只读会话、旧设备/工程/会话、配置变更、源码变更和并发构建冲突受检查。
- 实际 `riscv32-unknown-elf-gcc 7.3.0` 在 `-Wall -Wextra -Werror -Wconversion` 下编译并链接样例，产物 ELF machine=243、32 位、类型为可执行文件，生成 MAP；无编译诊断。样例没有 MCU 启动代码，未下载、未执行到硬件。
- ARM GCC 目前验证固定命令计划和工具链识别，尚无本机 ARM 编译器实编译证据。
- 结果证据：`artifacts/validation-compiler-results.json`、`artifacts/gcc-cross-compile-result.json`；界面截图包括 `ide-validation-passed/error/mobile.png`、`ide-gcc-settings.png`、`ide-gcc-cross-compile.png`。

## 其他界面与操作优化

- 19 个入口按监测、调试与测试、工程与智能分组。提供可切换文字的图标导航、可收起侧栏、Ctrl+K 功能/设备搜索与浏览器前进后退。
- 统一中性深色背景、文字对比度、输入框与工具按钮尺寸；通道数据改为紧凑的连续数据栏，Agent 的输入、源码与执行区域重新统一层次。
- 连接设置、导航文字和实时终端可以收起，并保存布局开关；验证 1500、1024 和 390 像素宽度无页面横向溢出。
- 各设备独立保留发送草稿和最近 30 条成功手动发送记录；历史只填入、不自动发送。内存记录不会写进磁盘或浏览器存储。
- 暂停/捕获时的读数和 CSV 使用同一冻结数据源。文件及定时发送检查发起设备，避免标签切换后误发；中文输入法确认不会当作发送 Enter。
- 初轮测试暴露搜索关闭后未恢复焦点，已修复并复测。另修正新测试的异步画布等待、状态选择器，以及 Windows 临时日志目录清理重试；没有放宽产品行为断言。

## 本机工具检测

- `D:\Keil5 C51\UV4\UV4.exe`：文件版本 5.14.0.0。
- `D:\Keil5 C51\ARM\ARMCC\bin\armcc.exe`：5.05.0.106。
- `D:\Keil5 C51\C51\BIN\C51.EXE`：9.54。
- `D:\IAR\common\bin\IarBuild.exe`：帮助命令实际执行，报告 6.1.7.0。
- `D:\IAR\common\bin\CSpyBat.exe`：帮助命令实际执行，报告 6.1.7.0，支持 `--download_only`，但没有配置具体目标板的处理器/驱动 DLL。
- `D:\IAR\8051\bin\icc8051.exe`：8.10.3。未检测到此目录下的 IAR ARM 编译器。

## 未验证项

- 未连接真实 ESP32/STM32/8051 开发板进行实际下载、采样精度或持续压力测试。
- 未验证真实蓝牙 SPP 链路、12 Mbaud 硬件稳定性、真实物理误码率、USB-CAN 或 CAN FD。BLE GATT 未实现。
- 7 种程序生成参考板的器件外形和高度仍为近似；另一个真实 PCB 样例采用工程 CAD 模型，但也未进行装配验证。没有根据任意 PCB 图片自动生成精确电路仿真模型。
- 未使用真实模型 API Key；模型调用测试使用本机协议夹具，MCP 使用 SDK 客户端，不是实际 Codex/Harness 配置。
- Keil 下载预览使用测试工程与明确标记的占位输出，未点击确认写入；下载进程测试使用 mock，不会把测试固件写入硬件。
- 未编译用户的真实 Keil/IAR 工程，未验证许可证、器件包、下载器与驱动组合。
- 原始 TCP SCPI 已完成本机模拟仪器收发，未逐类验证真实仪器。

这些通过项证明软件流程可运行，不代表全部目标芯片与仪器已完成兼容性认证。

## 0.1.2 Agent 与终端界面（2026-11-15）

- TypeScript / Vite 生产构建通过。后台 123 项通过、0 跳过，包含真实 C 编译和 CTest。
- 新增 DeepSeek 思考开关与默认预算、截断工具拒绝执行、HTTP 重试与取消、重复调用保护、只读工具、私有上下文续接、步数收尾、源码搜索和构建结果的测试。
- Agent 界面专项通过：斜杠任务与键盘选择、C/C++ 代码高亮、剪贴板复制、输出跟随、Markdown 导出，以及桌面、窄屏和 IDE 分栏布局。分栏按钮边界经过自动检查。
- 最终完整界面运行 47 项中 46 项通过；混合报文预览在初始化阶段出现一次元素等待超时，单独复测已通过。没有把这次完整运行记录为 47/47；前一轮的会话栏旧断言已按新的常驻设计更新并复测通过。
- 打包 EXE 使用隔离用户目录通过 native 串口枚举、动态波形、QuickJS、GLB、MCP、CLI、窗口/设置重启及终端 Agent 的斜杠任务和本地分析验证。安装资源中的 8 个关键文件与最终源码/前端入口逐字节一致，版本为 0.1.2。
- 截图包括 `agent-console-desktop.png`、`agent-console-compact.png`、`agent-console-mobile.png`、`agent-console-dock.png`、`packaged-agent-console.png`。模型输出来自本机 HTTP 协议夹具，没有使用用户的真实 API Key。
