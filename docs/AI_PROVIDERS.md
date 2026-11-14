# AI 接口配置与验证

## 0.1.3：协议联动与调用来源

2026-11-15 核对 DeepSeek 官方文档后，移除旧版错误拒绝 DeepSeek Responses 的校验。选择 DeepSeek 时支持三种协议，切换会联动 Base URL，模型 ID 与同主机密钥保留：

| API 格式 | Base URL | 实际请求路径 | 快速 / 自动模式 | 深度思考 |
| --- | --- | --- | --- | --- |
| Chat Completions | `https://api.deepseek.com` | `/chat/completions` | `thinking.type=disabled` | `thinking.type=enabled`，`reasoning_effort=low/high/max` |
| OpenAI Responses | `https://api.deepseek.com` | `/responses` | `reasoning.effort=none` | `reasoning.effort=low/high/xhigh`，界面“最高”映射到 xhigh |
| Anthropic Messages | `https://api.deepseek.com/anthropic` | `/anthropic/v1/messages` | `thinking.type=disabled` | `thinking.type=adaptive`，`output_config.effort=low/high/max` |

`deepseek-flash` 和 `deepseek-v4-pro` 为预设模型，仍可手动输入。预设不等于当前账号已授权；“读取模型列表”才读取接口目录。三个协议统一从官方 `/models` 目录读取模型。

DeepSeek Responses 为无状态兼容层，完整 input 历史由本地维护，不依赖 `previous_response_id` 或服务端存储。不会向该兼容层发送 OpenAI 专用的 encrypted reasoning include 参数。工具与思考内容按响应结构续接，截断工具不执行。

每次成功回复记录请求模型、接口返回模型、URL、协议、ID、耗时、结束原因和 token 用量；缺失模型字段不会用生成文本或配置值冒充。兼容某种 API 格式并不证明运行的是该 API 厂商的模型。

参考：[首次调用](https://api-docs.deepseek.com/zh-cn/)、[Responses](https://api-docs.deepseek.com/api/create-response)、[Anthropic Messages](https://api-docs.deepseek.com/api/create-message)、[模型目录](https://api-docs.deepseek.com/api/list-models)。以上路径和请求结构通过夹具测试，未使用个人密钥调用线上模型。

## 0.1.2：DeepSeek 无正文修复

DeepSeek 官方 Chat 模式未传 `thinking` 时会默认思考；低输出上限可能在正文开始前耗尽。当前自动模式显式关闭思考，预设为 8192 tokens / 120 秒。设置中可另选深度思考及强度，启用时预填 16384 tokens / 180 秒；不会将推理文本当成最终回答。

保留用户已有自定义输出上限，私有上下文正确随工具续轮和后续问答回传，并且不进入公开状态或日志。只返回推理、达到长度上限和工具参数截断都有明确诊断；截断工具不执行。详细使用和 OpenCode 参考见 [Agent 运行说明](AGENT_RUNTIME.md)。

## 早期 DeepSeek 截图问题

早期截图把 `https://api.deepseek.com` 与当时的 Responses 适配搭配。旧版的软件校验会错误拒绝这种组合，0.1.3 已移除此限制并补齐协议专属参数。不能仅因为模型名称新就判定模型不存在；当前默认仍使用 Chat，也可按上表切换另外两种协议。

选择 DeepSeek 预设会填写 Chat Completions、官方 Base URL 和
`deepseek-flash`。填写密钥后可读取账号可见模型，再保存并测试接口。
模型名仍允许手动修改；账号权限与配额需要真实请求确认。

## 已实现

- 四种协议：Chat Completions、OpenAI Responses、Anthropic Messages、Gemini generateContent。
- 十二个预设：DeepSeek、OpenAI、Anthropic、Gemini、百炼 Qwen、硅基流动、Moonshot、智谱、火山方舟、OpenRouter、Ollama、LM Studio；另有自定义地址。
- 模型列表读取：`POST /api/ai/models`，使用当前内存中的配置与密钥。服务未提供标准列表时仍可手动填写模型 ID。
- `POST /api/ai/test` 返回模型、协议、实际端点、耗时和正文；空正文不能被报告为连接成功。
- 输出上限 256..65536 tokens，超时 10..300 秒。服务商可能有更窄的限制，服务端拒绝会显示实际原因。
- 工具续轮保留 Responses call ID、Anthropic 内容块、Gemini thought signature、Chat 的 reasoning_content；不把推理内容当作最终回答。
- 请求与响应正文读取共用超时和取消信号；响应最多 4 MiB，禁止重定向携带密钥。
- 不匹配的已知协议在发出请求前阻止，可一键修正格式。模型、鉴权、额度、结构不匹配与空回复给出具体错误。
- 更换地址 origin 会清除旧密钥；桌面版通过系统安全存储加密保存并在重启后恢复。独立 Node 服务无系统加密适配时密钥仅驻留内存，界面提示保存能力。公开状态不返回密钥，错误与日志脱敏。

服务商预设是地址和协议的快捷填写，不代表该账户、区域或所有模型已完成兼容性认证。
工具能力取决于选中的模型；火山方舟等服务可能要求推理接入点 ID。
本次采用本机 HTTP 夹具与接口单元测试，没有使用用户真实 API Key。

## 资料与边界

实际取得的 DeepSeek 官方文档：`https://api-docs.deepseek.com/`，本地留存
`artifacts/deepseek-api-reference.html`。OpenAI / Anthropic 官方网页在本机
分别受到访问限制或地域限制，Gemini 文档请求超时。新增适配器通过协议夹具验证，
仍需使用对应账户执行连接测试；不把夹具通过等同于线上实测。
