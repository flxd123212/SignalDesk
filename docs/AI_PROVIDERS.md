# AI 接口配置与验证

## 0.1.2：DeepSeek 无正文修复

DeepSeek 官方 Chat 模式未传 `thinking` 时会默认思考；低输出上限可能在正文开始前耗尽。当前自动模式显式关闭思考，预设为 8192 tokens / 120 秒。设置中可另选深度思考及强度，启用时预填 16384 tokens / 180 秒；不会将推理文本当成最终回答。

保留用户已有自定义输出上限，私有上下文正确随工具续轮和后续问答回传，并且不进入公开状态或日志。只返回推理、达到长度上限和工具参数截断都有明确诊断；截断工具不执行。详细使用和 OpenCode 参考见 [Agent 运行说明](AGENT_RUNTIME.md)。

## 早期 DeepSeek 截图问题

早期截图把 `https://api.deepseek.com` 与当时的 Responses 适配搭配。当前 DeepSeek 预设选用官方 Chat 示例的 `/chat/completions` 路径，不能仅因为模型名称新就判定模型不存在。此处描述本项目已验证的适配方式，不断言 DeepSeek 官方永远只支持一种接口。

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
- 更换地址 origin 会清除旧密钥；密钥仅驻留服务内存，公开状态不返回密钥，错误与日志脱敏。

服务商预设是地址和协议的快捷填写，不代表该账户、区域或所有模型已完成兼容性认证。
工具能力取决于选中的模型；火山方舟等服务可能要求推理接入点 ID。
本次采用本机 HTTP 夹具与接口单元测试，没有使用用户真实 API Key。

## 资料与边界

实际取得的 DeepSeek 官方文档：`https://api-docs.deepseek.com/`，本地留存
`artifacts/deepseek-api-reference.html`。OpenAI / Anthropic 官方网页在本机
分别受到访问限制或地域限制，Gemini 文档请求超时。新增适配器通过协议夹具验证，
仍需使用对应账户执行连接测试；不把夹具通过等同于线上实测。
