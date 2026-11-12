# openclaw-web-bridge 项目索引

这份文档按当前源码整理，用来快速定位 `openclaw-web-bridge` 的职责、入口、调用链和关键文件。

一句话概括：

```text
本地 HTTP 服务 -> OpenAI 兼容接口 / OpenClaw Agent 接口 -> Provider 适配器 -> CDP Chrome -> 已登录的网页模型
```

## 1. 项目定位

`openclaw-web-bridge` 是一个本地桥接服务。它本身不提供模型能力，而是复用本机已登录的 Chrome 网页会话，通过 Chrome DevTools Protocol 和网页端接口调用模型站点，再把响应包装成本地 API。

当前主要支持：

| Provider | 默认站点 | 公开模型 |
| --- | --- | --- |
| Kimi | `https://www.kimi.com` | `kimi` |
| Qwen | `https://chat.qwen.ai` | `qwen` |
| DeepSeek | `https://chat.deepseek.com` | `deepseek`, `deepseek-r1` |
| Doubao | `https://www.doubao.com` | `doubao` |
| GLM | `https://chatglm.cn` | `glm`, `glm-think` |

对外暴露两类接口：

| 接口类型 | 用途 |
| --- | --- |
| OpenAI-compatible Chat API | 给普通聊天客户端或 OpenAI 兼容调用方使用 |
| OpenClaw Agent API | 给 coding agent 使用，可在服务端读写本地 workspace 文件 |

## 2. 目录结构

```text
openclaw-web-bridge/
  src/
    server.js                 HTTP 服务入口、路由和鉴权
    config.js                 配置加载、默认值、环境变量覆盖
    openai.js                 OpenAI Chat Completions 兼容层
    agent.js                  OpenClaw Agent 循环和文件工具
    browser/
      cdp.js                  CDP Chrome 连接、自动启动、页面复用
    providers/
      registry.js             Provider 注册表和模型名解析
      kimi.js                 Kimi Web 适配器
      qwen.js                 Qwen Web 适配器
      deepseek.js             DeepSeek Web 适配器
      deepseek-wasm.js        DeepSeek PoW 相关 WASM 常量
      doubao.js               Doubao Web 适配器
      glm.js                  GLM Web 适配器
  docs/
    PROJECT_INDEX.md          当前项目索引
    API_INDEX.md              API 调用索引和示例
  config.example.json         示例配置
  package.json                npm 脚本和依赖
  README.md                   项目说明
```

## 3. 启动和检查

安装依赖：

```powershell
npm.cmd install
```

准备配置：

```powershell
Copy-Item config.example.json config.json
```

启动服务：

```powershell
npm.cmd start
```

语法检查：

```powershell
npm.cmd run check
```

默认监听地址来自 `config.json` 或源码默认配置：

```text
http://127.0.0.1:3010
```

注意：如果没有 `config.json`，源码默认 `authToken` 是空字符串，即不鉴权；`config.example.json` 里示例 token 是 `change-me`。

## 4. 核心调用链

普通聊天：

```text
POST /v1/chat/completions
  -> src/server.js: 路由和鉴权
  -> src/openai.js: 校验请求、拼 prompt、包装 OpenAI 响应
  -> src/providers/registry.js: 根据 model 找 provider
  -> src/providers/*.js: 调用对应网页模型
  -> src/browser/cdp.js: 连接或启动 CDP Chrome
```

Agent 调用：

```text
POST /v1/agent
  -> src/server.js
  -> src/agent.js: 构造 agent system prompt
  -> provider.chat()
  -> extractToolCall()
  -> 服务端执行文件工具
  -> 最多循环 8 轮
```

OpenAI 形状的 Agent 兼容入口：

```text
POST /agent/chat
POST /v1/openclaw/chat/completions
```

## 5. HTTP 路由

| Method | Path | 鉴权 | 处理函数 | 说明 |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | 否 | `server.js` 内联 | 健康检查 |
| `GET` | `/v1/models` | 是 | `registry.listModels()` | OpenAI 风格模型列表 |
| `POST` | `/v1/chat/completions` | 是 | `handleChatCompletions()` | OpenAI Chat Completions |
| `POST` | `/v1/agent` | 是 | `handleOpenClawAgent()` | 原生 OpenClaw Agent 响应 |
| `POST` | `/agent/chat` | 是 | `handleOpenClawAgent(..., { openai: true })` | OpenAI 形状 Agent 响应 |
| `POST` | `/v1/openclaw/chat/completions` | 是 | `handleOpenClawAgent(..., { openai: true })` | OpenClaw 兼容入口 |

鉴权规则：

```text
如果 config.authToken 为空：不鉴权
否则接受以下任一方式：
  Authorization: Bearer <token>
  x-api-key: <token>
```

## 6. 配置来源

配置入口：`src/config.js`

加载顺序：

1. 使用 `DEFAULT_CONFIG`。
2. 如果存在 `config.json`，合并文件配置。
3. 使用环境变量覆盖部分字段。

可覆盖的环境变量：

| 环境变量 | 作用 |
| --- | --- |
| `OPENCLAW_WEB_BRIDGE_CONFIG` | 指定配置文件路径 |
| `OPENCLAW_WEB_BRIDGE_HOST` | 覆盖监听 host |
| `OPENCLAW_WEB_BRIDGE_PORT` | 覆盖监听 port |
| `OPENCLAW_WEB_BRIDGE_TOKEN` | 覆盖 API token |
| `OPENCLAW_WEB_BRIDGE_CDP_URL` | 覆盖 Chrome CDP 地址 |

关键默认值：

```json
{
  "host": "127.0.0.1",
  "port": 3010,
  "authToken": "",
  "browser": {
    "cdpUrl": "http://127.0.0.1:9222",
    "navigationTimeoutMs": 30000,
    "autoLaunch": true,
    "userDataDir": ".chrome-profile",
    "launchTimeoutMs": 15000,
    "launchCooldownMs": 60000
  },
  "agent": {
    "workspaceRoot": ".",
    "allowRequestWorkspaceRoot": false,
    "allowAnyPath": false
  }
}
```

## 7. CDP Chrome 连接

文件：`src/browser/cdp.js`

核心职责：

| 方法 | 作用 |
| --- | --- |
| `connect()` | 连接 CDP Chrome，并缓存 Playwright browser/context |
| `ensureAvailable()` | 确认 CDP Chrome 可用，必要时自动启动 |
| `pageForUrl(url)` | 复用已有同域页面，或新开页面并导航 |
| `cookies(url)` | 读取指定站点 cookie |
| `close()` | 关闭 Playwright CDP 连接 |

启动逻辑：

```text
请求 /json/version
  -> 成功：取 webSocketDebuggerUrl
  -> 失败且 autoLaunch=true：spawn Chrome
  -> 等待 CDP 在 launchTimeoutMs 内可用
  -> chromium.connectOverCDP(wsUrl)
```

Chrome 参数会包含：

```text
--remote-debugging-port=<cdp port>
--user-data-dir=<browser.userDataDir>
--no-first-run
--no-default-browser-check
```

## 8. Provider 注册和模型解析

文件：`src/providers/registry.js`

启动时按 `config.providers` 创建 provider 实例，并收集每个 provider 的 `listModels()`。请求中的 `model` 会先按公开模型 id 精确匹配，再按 aliases 匹配。

Provider 类型映射：

| type | class |
| --- | --- |
| `kimi` | `KimiProvider` |
| `qwen` | `QwenProvider` |
| `deepseek` | `DeepSeekProvider` |
| `doubao` | `DoubaoProvider` |
| `glm` | `GlmProvider` |

公开模型和上游模型：

| 公开模型 | 上游模型 | 常见 alias |
| --- | --- | --- |
| `kimi` | `moonshot-v1-32k` | `kimi/moonshot-v1-32k`, `kimi-web/moonshot-v1-32k` |
| `qwen` | `qwen3.5-plus` | `qwen/qwen3.5-plus`, `qwen-web/qwen3.5-plus` |
| `deepseek` | `deepseek-chat` | `deepseek/deepseek-chat`, `deepseek-web/deepseek-chat` |
| `deepseek-r1` | `deepseek-reasoner` | `deepseek/deepseek-reasoner`, `deepseek-web/deepseek-reasoner` |
| `doubao` | `doubao-seed-2.0` | `doubao/doubao-seed-2.0`, `doubao-web/doubao-seed-2.0` |
| `glm` | `glm-4-plus` | `glm/glm-4-plus`, `glm-web/glm-4-plus` |
| `glm-think` | `glm-4-think` | `glm/glm-4-think`, `glm-web/glm-4-think` |

## 9. Provider 能力速览

| Provider | 文件 | 流式能力 | 登录/状态来源 | 备注 |
| --- | --- | --- | --- | --- |
| Kimi | `src/providers/kimi.js` | 实现 `streamChat()` | cookie / localStorage token | 直接解析 Kimi gateway 流 |
| Qwen | `src/providers/qwen.js` | 仅 `chat()` | 已登录网页上下文 | 先收完整 SSE 文本，再返回完整内容 |
| DeepSeek | `src/providers/deepseek.js` | 实现 `streamChat()` | cookie、userAgent、bearer token | 包含 PoW challenge 求解 |
| Doubao | `src/providers/doubao.js` | 仅 `chat()` | 已登录网页上下文 | 网页 API 优先，失败时有 UI fallback |
| GLM | `src/providers/glm.js` | 仅 `chat()` | access token / cookie | 区分普通和 thinking assistant |

`/v1/chat/completions` 在 `stream: true` 时：

| 情况 | 行为 |
| --- | --- |
| provider 实现 `streamChat()` | 直接把 provider 增量转为 OpenAI SSE |
| provider 只有 `chat()` | 先等待完整文本，再按 64 字符切片模拟 SSE |

## 10. Agent 工具

文件：`src/agent.js`

Agent 最多执行 `8` 轮工具循环。模型需要返回 JSON 工具调用，服务端执行后再把结果塞回 messages，让模型继续。

工具列表：

| 工具 | 输入 | 作用 |
| --- | --- | --- |
| `workspace_info` | `{}` | 返回 workspace 根目录和路径策略 |
| `list_files` | `{ "path": ".", "maxFiles": 300 }` | 递归列文件 |
| `read_file` | `{ "path": "file", "maxBytes": 120000 }` | 读取 UTF-8 文本文件 |
| `write_file` | `{ "path": "file", "content": "..." }` | 创建或覆盖 UTF-8 文件 |
| `replace_in_file` | `{ "path": "file", "oldText": "...", "newText": "..." }` | 精确替换一次文本 |
| `search_files` | `{ "query": "...", "path": ".", "maxMatches": 50, "regex": false }` | 搜索文本文件 |

默认排除目录：

```text
.git
.chrome-profile
node_modules
dist
build
out
.next
coverage
```

路径策略：

| 配置 | 行为 |
| --- | --- |
| `agent.workspaceRoot` | 相对路径解析基准，默认当前项目目录 |
| `agent.allowRequestWorkspaceRoot` | 是否允许请求体覆盖 workspaceRoot |
| `agent.allowAnyPath` | 是否允许工具访问 workspace 外路径 |

## 11. 新增 Provider 的最短路径

1. 在 `src/providers/` 新建 provider 文件。
2. 实现构造函数、`listModels()` 和 `chat()`；如需真流式，再实现 `streamChat()`。
3. 在 `src/providers/registry.js` 里 import 并加入 `PROVIDER_TYPES`。
4. 在 `config.example.json` 和本地 `config.json` 的 `providers` 中添加配置。
5. 运行：

```powershell
npm.cmd run check
```

推荐 provider 基本形状：

```js
export class ExampleProvider {
  constructor(config, browser) {
    this.id = config.id || "example";
    this.type = config.type || "example";
    this.baseUrl = config.baseUrl || "https://example.com";
    this.model = config.model || "example-model";
    this.browser = browser;
  }

  listModels() {
    return [
      {
        id: this.id,
        upstreamModel: this.model,
        aliases: [`${this.id}/${this.model}`],
      },
    ];
  }

  async chat({ model, prompt, messages }) {
    return "text";
  }
}
```

## 12. 排查入口

| 问题 | 优先查看 |
| --- | --- |
| 服务起不来 | `src/server.js`, `src/config.js`, 端口 `3010` 是否占用 |
| `/health` 不通 | 服务是否启动、host/port 是否正确 |
| 返回 401 | `config.authToken`、`Authorization` 或 `x-api-key` |
| 找不到模型 | `src/providers/registry.js`, `config.providers` |
| Chrome 连不上 | `browser.cdpUrl`, `browser.autoLaunch`, `browser.executablePath`, `browser.userDataDir` |
| 提示登录过期 | 打开 CDP Chrome，重新登录对应站点 |
| Agent 不能访问目标路径 | `agent.workspaceRoot`, `agent.allowAnyPath`, 文件权限 |
| Qwen/Doubao/GLM 不真流式 | 当前 provider 只有 `chat()`，由 OpenAI 层模拟 SSE |

