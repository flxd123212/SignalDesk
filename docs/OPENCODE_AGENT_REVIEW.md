# OpenCode Agent 研究记录

核对日期：2026-11-15。通过 GitHub 官方 API 获取源码，固定提交为 `1fa50dd28cc860768fd89180cf40b2fb912b2813`；该提交时间为 2026-11-14T18:51:33Z。本文描述所核对的提交，不假定后续版本保持相同结构。

## 本轮发现与落地

| 参考行为 | SignalDesk 原问题 | 0.1.3 实现 |
| --- | --- | --- |
| `session/runner/step.ts` 记录请求模型、服务商、结束原因及 token 用量 | 设置和正文自我介绍无法证明每次请求的来源 | 在适配层记录实际 URL、请求模型、响应模型、请求/响应 ID、结束原因、耗时与 token 计数；绑定到每条回复、日志和导出 |
| `session/runner/to-llm-message.ts` 保留工具调用及结果，并按模型/服务商决定原生续接数据能否复用 | 仅 DeepSeek 保留完整工具历史，其他接口追问时从可见文本重建，丢失调用结果 | 四种协议保留完整工具轮次；Responses 重放 function_call/output，Anthropic/Gemini/Chat 保留各自原生续接字段 |
| 同文件区分 producing model，避免重放其他模型的加密推理或签名 | 切换配置后可能从界面旧文本重新带入错误身份声明 | 改为独立模型上下文，模型/协议/地址/密钥/工程切换时重置，历史显示不改写 |
| `session/compaction.ts` 为上下文预留空间，保留近期内容，支持手动压缩和溢出处理 | 历史大小不透明，用户只能删除聊天来重置 | 本轮先实现完整轮次限额、用量与移出计数、独立重置；**没有**实现模型生成摘要、原生压缩或自动溢出恢复 |

此外，系统消息注入当前请求的配置事实，要求模型不靠“我是某某”的生成文本判断身份。接口响应 ID 同样由服务端提供，不能当作模型权重的验证结果。原始正文不会被前端偷偷改写成指定厂商的回答。

同日核对 [DeepSeek 官方 OpenCode 接入指南](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode)：其接入示例使用 Anthropic 兼容入口，模型仍是 DeepSeek。SignalDesk 同时修正了对 DeepSeek Responses 的旧限制，三种官方接口分别映射思考参数；API 协议不再被当作模型身份。

## 保留的执行边界

继续沿用建议与补丁/只读分析、确认后写入、设备绑定指令、固定工具链计划、SHA256 防止旧文件覆盖、取消与有限重试。此轮没有增加自动烧录、任意终端自动执行或第三方代码整体导入。

## 下一阶段候选

1. **流式正文与工具状态**：先规范 runId、sequence、取消事件和重连续读，再接入 SSE。不能把半个工具 JSON 当作可执行命令。
2. **模型感知的摘要压缩**：从服务商能力信息获得上下文和输出上限，预留输出空间，保留当前目标、文件版本与待执行提案。未知窗口不伪造容量，压缩额外调用应计入用量。
3. **失败轮次恢复**：目前自动重试只重发失败请求，手动重试会重新获取设备快照；进一步恢复应保存工具结果与动作状态，防止重新发送串口指令或重复写文件。
4. **结构化任务与子代理汇总**：把验证结果、未完成项和文件证据从自由文本提取为稳定数据，避免单靠子代理的一句话宣称成功。

这些是后续候选，不属于已完成能力。

## 验证

- `npm test`：134 项通过，0 跳过。新覆盖四种协议的来源解析、缺失字段、元数据脱敏、完整工具历史续接、模型切换、上下文限额及独立重置，以及 DeepSeek 三种入口与思考参数映射、子代理结果/失败状态的有界续接。
- `npm run build`：TypeScript 与前端构建通过。
- Agent 专项 Playwright：3 项通过，检查调用记录展开/复制/导出、窄屏、历史来源不被配置变更改写、上下文重置和过期会话拒绝。
- 全部 AI 请求使用本机 HTTP 或注入的 fetch 测试夹具，未使用真实 API Key；不能据此确认截图那次线上调用的实际返回模型。

## 源码引用

- [请求元数据、工具执行与失败恢复](https://github.com/anomalyco/opencode/blob/1fa50dd28cc860768fd89180cf40b2fb912b2813/packages/core/src/session/runner/step.ts)
- [消息转换与模型原生上下文隔离](https://github.com/anomalyco/opencode/blob/1fa50dd28cc860768fd89180cf40b2fb912b2813/packages/core/src/session/runner/to-llm-message.ts)
- [上下文压缩、预算与溢出策略](https://github.com/anomalyco/opencode/blob/1fa50dd28cc860768fd89180cf40b2fb912b2813/packages/core/src/session/compaction.ts)

以上用于比较架构与行为，SignalDesk 实现保持现有 Node/React 结构，没有复制 OpenCode 实现。
