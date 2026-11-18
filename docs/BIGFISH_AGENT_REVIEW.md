# Bigfish / DeepSeek Harness 本地研究

核对日期：2026-11-16。本轮只读检查用户提供的 Bigfish 安装目录，不修改安装内容，不读取 `.dsh` 中的凭证、会话或个人配置，也不启动其中的插件。

## 实际架构

- 本地 `resources/app/package.json`：Bigfish 0.1.2，Electron 外壳，MIT，来源 [turtle2209/Bigfish](https://github.com/turtle2209/Bigfish)。
- `resources/app/main.js` 的 `findFreePort` 和后端启动逻辑：选择本地端口，通过子进程运行 `dsh --profile web`，并非把 AI 能力直接写在 Electron 窗口里。
- `resources/dsh/node_modules/@deepseek-ai/dsh/package.json`：DeepSeek Harness 0.1.0-rc.6，MIT，来源 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。这里的版本是本地安装副本，不代表远程最新版本。
- 核对了 `dsh-agent-loop/lib/index.js` 中工具结果提交、取消、等待及调度边界，以及 `dsh-repeat-tool-reminder/lib/index.js` 中参数规范化和重复提醒。Bigfish 的可用能力还取决于实际启用的 profile；安装目录存在某个包，不等于它已经启用或通过本机实测。

## 对 SignalDesk 有价值的设计

| 机制 | Harness 中的参考模块 | SignalDesk 0.1.9 的处理 |
| --- | --- | --- |
| 明确的运行/暂停/恢复状态 | `dsh-agent-loop` | 步数预算用尽或计划未完成时显示暂停，手动继续一个有界新轮次，不自动无限计费。 |
| 保留工具调用与结果的完整配对 | `dsh-agent-loop` | 出错或停止时保存完整检查点，不将未完成批次的孤立调用发给下一次请求。 |
| 旧上下文整理 | `dsh-compaction-basic`、`dsh-compaction-tool-result-pruner` | 最近最多八轮保持原生续接；被移出的轮次保存有界、带来源含义的请求/回复摘录，不额外调用模型。不是 Harness 的 token 计量或语义压缩实现。 |
| 重复调用纠偏 | `dsh-repeat-tool-reminder` | 深度排序参数进行比较。第三次相同静态工具不执行，返回提醒并进入有界总结；计划更新对计数透明，实时快照和构建状态轮询不按静态读取判断。 |
| 缺失信息时向用户提问 | `dsh-tool-ask-user`、`dsh-user-questions` | 值得后续接入。本轮优先修复用户实际遇到的停顿，尚未实现结构化提问界面。 |
| 插件化、Skills、MCP 客户端、独立任务 | 对应 Cordis 与 DSH 包 | 不将整个运行时直接拷入。保留现有 CLI/MCP 外部接口；后续适配还需逐项核对权限、取消、工程隔离和打包。 |

## 本次停顿的处理

截图显示 8/8 步、本轮被标为完成，但计划只有 1/4 项完成，同时正文出现 DSML 标记。这不足以证明服务商内部出错的具体原因，但足以区分两个问题：应用把预算停止显示成完成；模型接口把工具协议标记放入了可见正文。

- 新增“继续任务”，明确显示剩余计划和下一轮预算。只有点击才继续请求模型，保存原任务、模式和完整工具证据，并重新读取当前设备/源码上下文。
- 继续请求必须核对设备、会话和工程。原只读任务不因继续而升级成修改权限；不自动启用原始日志、串口发送、工具链执行或烧录。
- DSML 出现在非代码示例正文时拒绝该回复，不解析成可执行指令，不把它标记为成功工具调用。反复出现应检查模型/服务商的标准工具调用兼容性。
- 明确显示等待模型的秒数、暂停、错误与停止状态，不把界面动画当作真实执行进度。
- 兼容旧存档中未完成的计划：恢复为手动继续入口，缺少旧请求参数时默认只读，不自动执行。

采用的是运行机制的设计思路，SignalDesk 代码独立实现，未复制 Bigfish 或 DSH 实现文件、资产或完整依赖树。测试使用本机 HTTP 模型夹具，不读取用户密钥，不能代替实际模型质量、线上工具兼容性或实物设备验证。
