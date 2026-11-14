# 外部 Agent 接口

## 连接方式

界面“外部 Agent”绑定当前设备与工程，选择权限后创建令牌。可生成 Codex TOML、通用 MCP JSON、HTTP 与 CLI 示例；令牌不落盘，鉴权使用摘要，重启后失效。没有按小时过期的限制，使用“连接/断开”控制。不同桌面窗口有不同本地 URL。启用接口与客户端已经接入会分别显示，不伪造客户端连接状态。

MCP 采用标准 stdio 协议：

```text
node <SignalDesk绝对路径>/server/external/mcp.mjs
```

通过客户端环境变量提供 `SIGNALDESK_URL` 和 `SIGNALDESK_TOKEN`。桥接只连接本机 loopback HTTP。使用官方 `@modelcontextprotocol/sdk`，已用 SDK Client 完成端到端测试。Codex 官方文档页在当前网络返回 403，因此未声称已实际配置用户的 Codex；界面给出标准 `mcp_servers` TOML 配置，客户端具体版本以其 MCP 设置为准。

DeepSeek Harness 若支持 MCP，可使用同一配置；若没有 MCP 支持，其工具插件可调用 HTTP。这里不假定存在某个统一的 DeepSeek Harness 插件格式。

## HTTP

```http
GET /api/external/tools
Authorization: Bearer <token>
```

返回该令牌当前允许的工具和 JSON Schema。权限关闭后工具调用仍由后端拒绝，不依赖客户端菜单是否刷新。

```http
POST /api/external/call
Authorization: Bearer <token>
Content-Type: application/json

{"tool":"get_device_snapshot","arguments":{}}
```

成功返回 `{"result":...}`；未授权返回 403，令牌无效/已断开返回 401。接口不接收任意 shell 命令或任意文件绝对路径。

## CLI

使用界面生成的 PowerShell 配置设置 `SIGNALDESK_URL` 和 `SIGNALDESK_TOKEN`，随后：

```powershell
node server/external/cli.mjs tools
node server/external/cli.mjs status
node server/external/cli.mjs files
node server/external/cli.mjs read SignalGenerator.ino
node server/external/cli.mjs send 'AT[HEX:00 FF]' --format mixed --ending none
node server/external/cli.mjs build 'IarBuild Project.ewp -build Debug'
```

CLI 与 MCP/HTTP 使用相同授权，不绕过写入、发送、构建权限。`write`/`propose`
需要 `--from` 本地 UTF-8 文件、`--hash` 上次读取获得的 SHA256；详见 `--help`。
CLI 只访问本机 HTTP，不跟随重定向；没有任意 shell 执行入口。

## 工具与权限

| 权限 | 工具 |
| --- | --- |
| `read` | `get_device_snapshot`, `list_firmware_files`, `read_firmware_file`, `get_proposal`, `get_toolchain_status` |
| `propose` | `submit_advice`, `propose_file_change`, `propose_serial_command`, `propose_toolchain_command` |
| `write` | `write_project_file`, `apply_file_change` |
| `serial` | `send_serial` |
| `toolchain` | `run_toolchain` |

默认仅 `read` 和 `propose`。`write_project_file` 使用与文件提案相同的参数：`path`, `expectedHash`, `content`, `reason`。先读取文件取得精确 SHA256，再提交完整新内容；哈希已变化则拒绝覆盖。直接写入也产生持久修改记录、备份与审计事件。

`send_serial` 参数为 `text`, `format`, `ending`, `checksum`, `reason`，只向创建令牌时的设备连接发送一次。连接变化需重新授权。该接口不会自动猜测设备指令，也没有隐式定时发送或烧录。

`run_toolchain` 参数为 `commandLine`, `reason`。使用参数数组和 `shell:false` 执行支持的工具，不提供 PowerShell/cmd 通用执行。支持的示例：

```text
platformio run -e debug
arduino-cli compile --fqbn esp32:esp32:esp32 .
cmake --build build
UV4 -b MDK-ARM/Project.uvprojx -t "Target 1"
IarBuild Project.ewp -build Debug
git status --short
```

上传、Flash、安装命令不走此接口。Keil `-f` 下载由软件专用烧录确认流程处理。工程自带构建脚本仍会以当前用户身份运行，因此工具链授权只适用于可信工程，不构成系统沙箱。

## 留痕

外部连接有独立 Agent 会话。建议直接进入该会话；提案可在软件内审查并执行；获得直接权限的修改也显示修改前后代码、行号与备份。关闭令牌不会删除已有记录。令牌、API Key 不进入审计导出；工程源码、路径和设备数据可能是敏感内容，导出时需自行管理。

项目绑定变化会使旧令牌失效；权限关闭约束后续调用，不能逆转已经发出的数据或已完成的文件变更。
