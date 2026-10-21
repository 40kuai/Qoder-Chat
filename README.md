# Qoder Chat

[![GitHub stars](https://img.shields.io/github/stars/40kuai/Qoder-Chat?style=flat-square)](https://github.com/40kuai/Qoder-Chat/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/40kuai/Qoder-Chat?style=flat-square)](https://github.com/40kuai/Qoder-Chat/issues)
[![Last commit](https://img.shields.io/github/last-commit/40kuai/Qoder-Chat?style=flat-square)](https://github.com/40kuai/Qoder-Chat/commits/main)
[![Follow @40kuai](https://img.shields.io/github/followers/40kuai?style=flat-square&label=Follow)](https://github.com/40kuai)

> 基于 Qoder CN 官方 Agent SDK 的本地多模型代理与聊天界面，提供 OpenAI / Anthropic 兼容 API。

**作者：[@40kuai](https://github.com/40kuai)** · [项目主页](https://github.com/40kuai/Qoder-Chat) · [问题反馈](https://github.com/40kuai/Qoder-Chat/issues)

`Qoder CN` · `DeepSeek-Flash` · `OpenAI 兼容` · `Anthropic Messages` · `OAuth 多账号` · `自动负载均衡` · `健康检查` · `本地聊天`

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
- 多账号池：独立 OAuth 配置目录；创建账号直接返回授权链接；健康账号自动负载均衡；异常账号自动停用
- 本机/内网打开 Web UI 时自动填充 API Key
- 一键复制其他 Agent 的接入配置（Claude / OpenAI / curl / JSON）
- 通过官方 SDK 完成鉴权与签名，不伪造请求签名

## 适合谁

- 想把 Qoder CN 模型接入 OpenAI / Claude 兼容客户端的开发者
- 有多个自有 Qoder CN 账号，需要 OAuth 管理、健康检查和自动负载均衡的用户
- 想要本地聊天界面，但不希望把 API Key 暴露到公网的用户

## 环境要求

- macOS
- 已安装 Qoder CN 桌面客户端（默认路径 `/Applications/Qoder CN.app`）
- 合法可用的 Qoder CN 账号
- 使用 OAuth 多账号时，需要官方 Qoder CN CLI（`accounts.sh` 会在未安装时回退到 npx）
- 也可以只使用一个 Personal Access Token（PAT）作为兼容账号
- `git`、`bash`、`curl`、`openssl`
- 无需单独安装 Node.js：服务通过 Qoder CN 自带的 Electron Node 运行

> 本项目依赖 Qoder CN 客户端内部 SDK 与模型目录。客户端升级后路径或模型 ID 可能变化，需要相应调整。

## 快速开始

```bash
git clone https://github.com/40kuai/Qoder-Chat.git
cd Qoder-Chat
cp .env.example .env
chmod +x start.sh access.sh accounts.sh
```

选择一种认证方式：

**方式 A：单账号 PAT（兼容模式）**

编辑 `.env`，填入 Qoder CN PAT：

```dotenv
QODER_PAT=pt-your-personal-access-token
```

**方式 B：多账号 OAuth（推荐）**

```bash
./accounts.sh add "工作账号"
./accounts.sh login <账号ID或名称>
./accounts.sh test <账号ID或名称>
./accounts.sh default <账号ID或名称>
```

OAuth 账号不需要在 `.env` 中填写 `QODER_PAT`。登录会在浏览器中完成官方授权。

启动：

```bash
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
| `QODER_PAT` | 空 | 可选。Qoder CN Personal Access Token，作为“兼容账号（PAT）” |
| `HOST` | `127.0.0.1` | 监听地址；局域网访问需设为 `0.0.0.0` |
| `PORT` | `8788` | HTTP 端口 |
| `PROXY_API_KEY` | 空 | 对外 API 的访问 Key；为空时自动生成 |
| `UI_AUTO_AUTH` | `private` | Web UI 自动认证策略：`private` / `local` / `off` |
| `QODER_APP_PATH` | `/Applications/Qoder CN.app` | Qoder CN 安装路径 |
| `QODER_POOL_HOME` | `~/.qoder-cn-pool` | 账号元数据与 OAuth 配置目录 |
| `QODER_CLI_BIN` | 自动检测 | 官方 Qoder CN CLI 路径（可选） |
| `ACCOUNT_HEALTH_INTERVAL_MS` | `600000` | 账号健康检查间隔，默认 10 分钟 |
| `REQUEST_TIMEOUT_MS` | `300000` | 单次请求超时 |
| `MAX_CONCURRENT` | `4` | 最大并发请求数 |

### UI_AUTO_AUTH 安全说明

- `private`（默认）：本机回环地址和 RFC1918 内网地址打开 UI 时，服务端会把 `PROXY_API_KEY` 注入页面，前端自动认证。方便，但**同一局域网内任何能打开该 UI 的设备都能拿到 Key**。
- `local`：只有本机 `127.0.0.1` / `::1` 自动认证，其他机器需要手动填写 Key。
- `off`：全部手动填写 Key。
- 带 `X-Forwarded-For` / `X-Real-IP` 的请求不会自动注入，避免反向代理场景把 Key 泄露给公网访问者。

如果要在不可信局域网或公网使用，请设置 `UI_AUTO_AUTH=local` 或 `off`，并配合 HTTPS 反向代理、防火墙和强随机 Key。

## 多账号池（OAuth + 自动负载均衡）

本项目支持管理多个**你本人或团队自有**的 Qoder CN 账号。每个账号使用独立的 CLI 配置目录，通过官方浏览器 OAuth 登录。支持健康账号自动负载均衡和手动选号；账号异常会自动停用。**不做按额度/限流轮换、共享、出租或转售**。

### 安装官方 CLI

OAuth 登录依赖 Qoder CN 官方 CLI。安装方式任选：

```bash
# 推荐：原生安装脚本
curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh | bash

# 或 npm
npm install -g @qodercn-ai/qoderclicn
```

未安装时，`accounts.sh` 会回退到 `npx @qodercn-ai/qoderclicn`（首次下载较慢）。

### 添加与登录

**方式 A：Web UI（推荐，直接生成授权 URL）**

在「管理账号」中点击「创建并授权」。名称可以留空：登录成功后会自动使用官方授权返回的账号身份（例如邮箱）命名；也可以填写备注名。服务端会启动官方 CLI 的 OAuth 流程并返回一个授权 URL，在任意浏览器打开完成登录即可。登录进程在服务端等待授权，账号状态会自动从「等待授权」变为「可用」。

> 一个浏览器会话通常对应一个 Qoder 账号。添加不同账号时，请先退出当前账号或使用隐私窗口打开授权链接。

**方式 B：终端**

```bash
./accounts.sh add            # 名称可留空，登录后自动命名
./accounts.sh add "工作账号"  # 或填写备注名
# 输出账号 ID
./accounts.sh login <账号ID或名称>
```

`login` 会启动官方 CLI 的浏览器 OAuth 流程。请确认浏览器里登录的是你想添加的账号。

登录后检查：

```bash
./accounts.sh test <账号ID或名称>
./accounts.sh list
```

### 常用命令

```bash
./accounts.sh list
./accounts.sh test                 # 检查全部账号
./accounts.sh default <ID或名称>    # 设置默认账号
./accounts.sh remove <ID或名称>     # 删除元数据，配置目录保留
```

### 自动负载均衡与手动选号

- **自动负载均衡（默认开启）**：请求不传 `account` 时，在状态为「可用」的账号间轮询。
- **异常账号自动停用**：状态为「需登录」「等待授权」「异常」的账号不会参与轮询；显式指定这些账号会返回 HTTP 409。
- **健康检查**：启动时检查一次，之后每 10 分钟检查一次（`ACCOUNT_HEALTH_INTERVAL_MS` 可调整）。
- **手动选号**：在 Web UI 关闭自动负载均衡后选择具体账号，或在请求中显式传账号 ID。
- **强制自动**：请求传 `account: "auto"`，即使服务端关闭了自动模式也会在健康账号间轮询。
- **不做额度轮换**：429、额度不足等错误不会触发账号切换或标记异常。

API 示例：

```json
{
  "model": "deepseek-flash",
  "account": "auto",
  "messages": [{"role": "user", "content": "你好"}]
}
```

显式指定账号：

```json
{
  "model": "deepseek-flash",
  "account": "<账号ID>",
  "messages": [{"role": "user", "content": "你好"}]
}
```

也可以使用请求头：

```http
X-Qoder-Account: <账号ID>
```

不传账号时按服务端「自动负载均衡」设置执行；该设置可在 Web UI「管理账号」中开关。响应头 `X-Qoder-Account` 会返回本次实际使用的账号。

### 存储与安全

- 账号元数据：`~/.qoder-cn-pool/accounts.json`（权限 600），包含账号名/授权身份（可能是邮箱），仅保存在本地
- OAuth 配置目录：`~/.qoder-cn-pool/accounts/<id>/cli`（权限 700），包含该账号的登录令牌
- 不要把 `~/.qoder-cn-pool`、`.env` 或任何账号配置目录提交到仓库或分享给他人
- OAuth 授权 URL 短期有效，只在认证后的 UI/API 中展示，不要转发给不可信的人
- 仅用于自有账号；禁止对外共享、出租、出售账号或用于绕过平台额度/限流
- 管理账号或登录时请确认浏览器当前登录的是目标账号
- 健康检查会定期运行官方 CLI；OAuth 令牌失效时账号会被标记为「需登录」，需要手动重新登录
- 旧版 `QODER_PAT` 会作为一个「兼容账号（PAT）」保留，可手动切换或删除

## API 使用

不传 `account` 时按服务端负载均衡设置执行（默认开启，健康账号轮询）；传 `"auto"` 强制自动；显式账号或 `X-Qoder-Account` 请求头会覆盖自动模式。

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
3. 使用合法的 PAT，或每个账号独立的官方 CLI OAuth 配置目录，建立官方鉴权与签名链路；
4. 把 SDK 的文本/thinking 事件转换为 OpenAI SSE 或 Anthropic SSE；
5. 通过 `extraArgs` 透传 `--context-window` 调整上下文窗口；
6. 通过官方 CLI 的 `--config-dir` 隔离不同账号的登录态，并按请求手动选择账号。

本项目不包含、也不分发 Qoder CN 客户端或 SDK 本体。

## 已知限制

- 不支持 function calling / tool use；依赖 `tool_use` 的客户端（如 Claude Code 的工具循环）只能进行普通对话
- 不支持图片输入
- `usage` 中的 token 数通常为 0，因为 Qoder 网关不向 SDK 回传用量
- 每个请求会启动一次 agent worker，通常有 2–5 秒延迟
- 模型目录是客户端版本的快照，Qoder CN 升级后可能变化
- 未对所有付费模型逐一验证，使用付费模型会消耗账号额度
- 多账号需要手动打开授权链接完成 OAuth；可自动负载均衡健康账号，但不按额度/限流切换
- 自动负载均衡只使用状态为「可用」的账号；异常账号需要重新登录或修复后才会重新参与
- OAuth 账号健康检查依赖官方 CLI；使用 npx 回退时首次调用会较慢
- 账号池仅限你本人或团队自有并授权的账号

## 常见问题

**`No account configured`**

使用 OAuth 多账号时，先执行 `./accounts.sh add "名称"` 和 `./accounts.sh login <id>`；或在 `.env` 中填写 `QODER_PAT` 作为兼容账号。

**OAuth 账号显示「需登录」**

在运行服务的机器上执行 `./accounts.sh login <账号ID>`，并确认浏览器中登录的是该账号。登录完成后执行 `./accounts.sh test <账号ID>`。

**账号测试很慢**

如果 `accounts.sh` 回退到了 npx，首次会下载官方 CLI。建议安装原生 CLI：`curl -fsSL https://static.qoder.com.cn/qoder-cli-cn/install.sh | bash`，或设置 `QODER_CLI_BIN` 指向已有 CLI。

**`Qoder CN SDK runtime not found`**

确认已安装 Qoder CN，或通过 `QODER_APP_PATH` 指定正确的 `.app` 路径。

**Web UI 仍提示需要 API Key**

检查 `UI_AUTO_AUTH` 是否为 `off`；如果通过反向代理访问，带 `X-Forwarded-For` 的请求不会自动认证。可运行 `./access.sh` 获取 Key 后手动填写。

**其他机器无法访问**

确认 `HOST=0.0.0.0`、端口未被防火墙拦截、两台机器在同一网段，并使用正确的局域网 IP。

**客户端收到空 502 / 代理错误**

如果客户端使用系统代理，请把 `127.0.0.1` / 局域网 IP 加入 `NO_PROXY`，或关闭该客户端的环境代理。

## 关于作者

- GitHub：[@40kuai](https://github.com/40kuai)
- 项目主页：https://github.com/40kuai/Qoder-Chat
- 问题反馈：https://github.com/40kuai/Qoder-Chat/issues
- 如果这个项目对你有帮助，欢迎 Star、提交 Issue 或 PR。

## 使用与转载

本仓库仅用于学习交流，未授予商业使用许可。转载请注明出处，并保留本免责声明。若 Qoder 或 DeepSeek 官方认为本项目存在不合适之处，请联系仓库作者删除。

## 目录结构

```text
.
├── server.mjs       # HTTP 服务：OpenAI / Anthropic 兼容层与 SDK 桥接
├── ui.html          # Web 聊天界面（含账号池管理）
├── accounts.mjs     # 账号池存储、OAuth 配置目录、CLI 健康检查
├── accounts-cli.mjs # 账号池 CLI（list/add/login/test/default/remove）
├── accounts.sh      # 账号池 CLI 入口
├── start.sh         # 启动脚本（加载账号、生成代理 Key）
├── access.sh        # 输出接入地址、Key 和配置片段
├── .env.example     # 环境变量示例
└── package.json
```
