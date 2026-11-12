# openclaw-web-bridge API 索引

默认地址：

```text
http://127.0.0.1:3010
```

鉴权取决于 `config.authToken`：

| 配置 | 行为 |
| --- | --- |
| `authToken` 为空 | 不需要鉴权 |
| `authToken` 非空 | 需要 `Authorization: Bearer <token>` 或 `x-api-key: <token>` |

`config.example.json` 使用的示例 token 是 `change-me`。

## 1. GET /health

用途：健康检查，不需要鉴权。

```powershell
curl.exe http://127.0.0.1:3010/health
```

响应示例：

```json
{
  "ok": true,
  "service": "openclaw-web-bridge",
  "cdpUrl": "http://127.0.0.1:9222"
}
```

## 2. GET /v1/models

用途：返回 OpenAI 风格模型列表。

```powershell
curl.exe http://127.0.0.1:3010/v1/models `
  -H "Authorization: Bearer change-me"
```

可能返回的模型：

```text
kimi
qwen
deepseek
deepseek-r1
doubao
glm
glm-think
```

实际列表取决于 `config.providers`。

## 3. POST /v1/chat/completions

用途：OpenAI Chat Completions 兼容接口。

非流式：

```powershell
curl.exe http://127.0.0.1:3010/v1/chat/completions `
  -H "Authorization: Bearer change-me" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"kimi\",\"messages\":[{\"role\":\"user\",\"content\":\"你好，简单介绍一下你自己\"}]}"
```

请求体字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 公开模型 id 或 alias |
| `messages` | 是 | OpenAI 风格消息数组 |
| `stream` | 否 | `true` 时返回 SSE |

响应形状：

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 0,
  "model": "kimi",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "模型返回内容"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

流式：

```powershell
curl.exe http://127.0.0.1:3010/v1/chat/completions `
  -H "Authorization: Bearer change-me" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"deepseek\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"写一段短文\"}]}"
```

SSE 响应以 OpenAI chunk 形状输出，结束时发送：

```text
data: [DONE]
```

## 4. POST /v1/agent

用途：原生 OpenClaw Agent 接口。模型可以请求服务端工具读写文件。

```powershell
curl.exe http://127.0.0.1:3010/v1/agent `
  -H "Authorization: Bearer change-me" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"deepseek\",\"input\":\"读取 package.json，并总结 scripts 字段\"}"
```

请求体字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 公开模型 id 或 alias |
| `input` | 否 | 用户任务，和 `messages` / `prompt` 三选一 |
| `prompt` | 否 | 用户任务，和 `messages` / `input` 三选一 |
| `messages` | 否 | OpenAI 风格消息数组 |
| `workspaceRoot` | 否 | 仅当 `agent.allowRequestWorkspaceRoot=true` 时有效 |

响应形状：

```json
{
  "id": "ocagent_xxx",
  "object": "openclaw.agent.run",
  "created": 0,
  "model": "deepseek",
  "workspaceRoot": "F:\\project_code\\homework\\openclaw-web-bridge",
  "message": "最终回答",
  "tools": [
    {
      "id": "toolu_xxx",
      "name": "read_file",
      "input": {
        "path": "package.json"
      },
      "ok": true,
      "summary": "Read 123 character(s)."
    }
  ],
  "stop_reason": "end_turn"
}
```

可能的 `stop_reason`：

| 值 | 含义 |
| --- | --- |
| `end_turn` | 模型给出最终回答 |
| `max_turns` | 达到最多 8 轮工具循环 |

## 5. POST /agent/chat

用途：Agent 接口，但响应包装成 OpenAI Chat Completion 形状。

```powershell
curl.exe http://127.0.0.1:3010/agent/chat `
  -H "Authorization: Bearer change-me" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"deepseek\",\"messages\":[{\"role\":\"user\",\"content\":\"读取 package.json，并总结 scripts 字段\"}]}"
```

响应会额外带上：

```json
{
  "openclaw_agent": {
    "workspaceRoot": "...",
    "tools": []
  }
}
```

## 6. POST /v1/openclaw/chat/completions

用途：OpenClaw 使用的 OpenAI 兼容 Agent 入口，处理逻辑和 `/agent/chat` 相同。

非流式：

```powershell
curl.exe http://127.0.0.1:3010/v1/openclaw/chat/completions `
  -H "Authorization: Bearer change-me" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"deepseek\",\"messages\":[{\"role\":\"user\",\"content\":\"读取 README.md 并总结\"}]}"
```

流式：

```powershell
curl.exe http://127.0.0.1:3010/v1/openclaw/chat/completions `
  -H "Authorization: Bearer change-me" `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"deepseek\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"读取 README.md 并总结\"}]}"
```

注意：Agent 流式接口会先执行完整 agent run，再把最终 `message` 切片输出为 SSE；执行期间每 15 秒发送一次 keep-alive 注释。

## 7. Python 调用模板

```python
import requests

BASE_URL = "http://127.0.0.1:3010"
API_KEY = "change-me"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

payload = {
    "model": "deepseek",
    "messages": [
        {"role": "user", "content": "写一个 Python hello world"}
    ],
}

res = requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers=headers,
    json=payload,
    timeout=120,
)
res.raise_for_status()

print(res.json()["choices"][0]["message"]["content"])
```

流式模板：

```python
import requests

BASE_URL = "http://127.0.0.1:3010"
API_KEY = "change-me"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

payload = {
    "model": "deepseek",
    "stream": True,
    "messages": [
        {"role": "user", "content": "写一段 100 字短文"}
    ],
}

with requests.post(
    f"{BASE_URL}/v1/chat/completions",
    headers=headers,
    json=payload,
    stream=True,
    timeout=120,
) as res:
    res.raise_for_status()
    for line in res.iter_lines(decode_unicode=True):
        if line:
            print(line)
```

## 8. 常见错误

| 错误 | 可能原因 |
| --- | --- |
| `Missing or invalid bearer token` | token 缺失或和 `config.authToken` 不一致 |
| `Unknown model ...` | `model` 不在 `config.providers` 暴露的模型或 alias 中 |
| `Chrome CDP did not become ready` | Chrome 未启动、路径错误、端口不可用 |
| `login expired` / `login not found` | 对应网页模型没有在 CDP Chrome 中登录 |
| `Path is outside workspace` | Agent 访问 workspace 外路径，但 `allowAnyPath=false` |

