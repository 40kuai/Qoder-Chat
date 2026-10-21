# Qoder Chat

> 基于 Qoder CN 官方 Agent SDK 的本地多模型代理与聊天界面，提供 OpenAI / Anthropic 兼容 API。

## 免责声明

**本项目仅供个人学习、技术研究与本地联调使用，与 Qoder、DeepSeek 官方没有任何关联。**

- 请遵守 Qoder / DeepSeek 的服务条款、账号规则以及所在地区的法律法规。
- 禁止用于商业转售、账号共享、绕过付费或限额、未授权访问及其他违规用途。
- 本项目不提供破解、伪造签名或规避平台检测的能力；它仅复用本机已安装的 Qoder CN 客户端自带的官方 SDK 链路。
- 使用本项目可能导致账号被限制或封禁，相关风险由使用者自行承担；作者不承担任何直接或间接责任。
- 如果你不确定自己的使用场景是否合规，请不要使用本项目。
- 严禁将 `.env`、PAT、API Key 提交到仓库或发送给他人。

> This project is for personal learning and research only. It is not affiliated with Qoder or DeepSeek. Use of this project may violate the relevant terms of service. Use at your own risk.

## 功能

- OpenAI 兼容接口：`POST /v1/chat/completions`，支持流式与非流式
- Anthropic Messages 兼容接口：`POST /v1/messages`，支持文本、流式与 thinking 块
- 多模型切换：DeepSeek-Flash、DeepSeek-V4-Pro、Qwen、GLM、Kimi、MiniMax 等
- 上下文窗口选择：`200K / 400K / 1M`（以模型支持为准）
- Web 聊天界面：模型选择、流式输出、思考过程、Markdown、代码复制、停止生成
- 本机/内网打开 Web UI 时自动填充 API Key
- 一键复制其他 Agent 的接入配置（Claude / OpenAI / curl / JSON）
- 通过官方 SDK 完成鉴权与签名，不伪造请求签名

## 环境要求

- macOS
- 已安装 Qoder CN 桌面客户端（默认路径 `/Applications/Qoder CN.app`）
- 合法可用的 Qoder CN 账号与 Personal Access Token（PAT）
- `git`、`bash`、`curl`、`openssl`
- 无需单独安装 Node.js：服务通过 Qoder CN 自带的 Electron Node 运行

> 本项目依赖 Qoder CN 客户端内部 SDK 与模型目录。客户端升级后路径或模型 ID 可能变化，需要相应调整。

## 快速开始

```bash
git clone https://github.com/40kuai/Qoder-Chat.git
cd Qoder-Chat
cp .env.example .env
```

编辑 `.env`，填入你的 Qoder CN PAT：

```dotenv
QODER_PAT=pt-your-personal-access-token
```

启动：

```bash
chmod +x start.sh access.sh
./start.sh
```

打开 Web UI：

- 本机：`http://127.0.0.1:8788/`
- 局域网：`http://<你的局域网IP>:8788/`

查看其他 Agent 的接入地址与 Key：

```bash
./access.sh
```

如果 `.env` 中 `PROXY_API_KEY` 为空，`start.sh` 会在首次启动时自动生成一个并写回 `.env`。

## 配置项

`.env` 示例见 [.env.example](.env.example)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `QODER_PAT` | 无 | 必填。Qoder CN Personal Access Token |
| `HOST` | `127.0.0.1` | 监听地址；局域网访问需设为 `0.0.0.0` |
| `PORT` | `8788` | HTTP 端口 |
| `PROXY_API_KEY` | 空 | 对外 API 的访问 Key；为空时自动生成 |
| `UI_AUTO_AUTH` | `private` | Web UI 自动认证策略：`private` / `local` / `off` |
| `QODER_APP_PATH` | `/Applications/Qoder CN.app` | Qoder CN 安装路径 |
| `REQUEST_TIMEOUT_MS` | `300000` | 单次请求超时 |
| `MAX_CONCURRENT` | `4` | 最大并发请求数 |

### UI_AUTO_AUTH 安全说明

- `private`（默认）：本机回环地址和 RFC1918 内网地址打开 UI 时，服务端会把 `PROXY_API_KEY` 注入页面，前端自动认证。方便，但**同一局域网内任何能打开该 UI 的设备都能拿到 Key**。
- `local`：只有本机 `127.0.0.1` / `::1` 自动认证，其他机器需要手动填写 Key。
- `off`：全部手动填写 Key。
- 带 `X-Forwarded-For` / `X-Real-IP` 的请求不会自动注入，避免反向代理场景把 Key 泄露给公网访问者。

如果要在不可信局域网或公网使用，请设置 `UI_AUTO_AUTH=local` 或 `off`，并配合 HTTPS 反向代理、防火墙和强随机 Key。

## API 使用

### OpenAI 兼容

Base URL：`http://<host>:8788/v1`

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H "Authorization: Bearer <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-flash",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

Python：

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8788/v1",
    api_key="<PROXY_API_KEY>",
)
resp = client.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

### Anthropic / Claude 兼容

Base URL：`http://<host>:8788`，接口路径 `/v1/messages`。

```bash
curl http://127.0.0.1:8788/v1/messages \
  -H "x-api-key: <PROXY_API_KEY>" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 512,
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

Python：

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://127.0.0.1:8788",
    api_key="<PROXY_API_KEY>",
)
msg = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=512,
    messages=[{"role": "user", "content": "你好"}],
)
print(msg.content[0].text)
```

客户端传入的 `claude-*` 模型名会自动回落到默认模型 `deepseek-flash`。

### 模型列表

```bash
curl http://127.0.0.1:8788/v1/models \
  -H "Authorization: Bearer <PROXY_API_KEY>"
```

返回每个模型的 `context_windows`、`default_context_window`、计费倍率等信息。

### 上下文窗口

请求体支持扩展字段 `context_window`：

```json
{
  "model": "deepseek-flash",
  "context_window": 400000,
  "messages": [{"role": "user", "content": "你好"}]
}
```

可选值由模型决定，通常为 `200000 / 400000 / 1000000`。响应头 `X-Qoder-Context-Window` 会返回实际使用的值。

> 注意：这里调整的是会话上下文窗口/自动压缩阈值；单次请求的输入 token 仍受模型本身上限约束。

## 工作原理

Qoder CN 的 DeepSeek-Flash 模型 ID 为 `dfmodel`，实际推理走 Qoder 网关。网关的 OpenAI 兼容端点要求 Qoder 客户端签名，不能直接用普通 API Key 调用。

本项目：

1. 通过 `ELECTRON_RUN_AS_NODE=1` 使用 Qoder CN 自带的 Node 运行时；
2. 加载客户端内置的官方 Agent SDK；
3. 使用合法的 PAT 建立官方鉴权与签名链路；
4. 把 SDK 的文本/thinking 事件转换为 OpenAI SSE 或 Anthropic SSE；
5. 通过 `extraArgs` 透传 `--context-window` 调整上下文窗口。

本项目不包含、也不分发 Qoder CN 客户端或 SDK 本体。

## 已知限制

- 不支持 function calling / tool use；依赖 `tool_use` 的客户端（如 Claude Code 的工具循环）只能进行普通对话
- 不支持图片输入
- `usage` 中的 token 数通常为 0，因为 Qoder 网关不向 SDK 回传用量
- 每个请求会启动一次 agent worker，通常有 2–5 秒延迟
- 模型目录是客户端版本的快照，Qoder CN 升级后可能变化
- 未对所有付费模型逐一验证，使用付费模型会消耗账号额度

## 常见问题

**`QODER_PAT is required`**

在 `.env` 中填写 `QODER_PAT`，或导出 `QODERCN_PERSONAL_ACCESS_TOKEN` 后启动。

**`Qoder CN SDK runtime not found`**

确认已安装 Qoder CN，或通过 `QODER_APP_PATH` 指定正确的 `.app` 路径。

**Web UI 仍提示需要 API Key**

检查 `UI_AUTO_AUTH` 是否为 `off`；如果通过反向代理访问，带 `X-Forwarded-For` 的请求不会自动认证。可运行 `./access.sh` 获取 Key 后手动填写。

**其他机器无法访问**

确认 `HOST=0.0.0.0`、端口未被防火墙拦截、两台机器在同一网段，并使用正确的局域网 IP。

**客户端收到空 502 / 代理错误**

如果客户端使用系统代理，请把 `127.0.0.1` / 局域网 IP 加入 `NO_PROXY`，或关闭该客户端的环境代理。

## 使用与转载

本仓库仅用于学习交流，未授予商业使用许可。转载请注明出处，并保留本免责声明。若 Qoder 或 DeepSeek 官方认为本项目存在不合适之处，请联系仓库作者删除。

## 目录结构

```text
.
├── server.mjs       # HTTP 服务：OpenAI / Anthropic 兼容层与 SDK 桥接
├── ui.html          # Web 聊天界面
├── start.sh         # 启动脚本（自动读取 PAT、生成代理 Key）
├── access.sh        # 输出接入地址、Key 和配置片段
├── .env.example     # 环境变量示例
└── package.json
```
