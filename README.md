# OpenClaw Web Bridge

本地 Web 模型桥接服务：复用已经登录的调试 Chrome，通过 CDP 调用 Web 模型站点，并对 OpenClaw 暴露 OpenAI-compatible API 和服务端 agent 接口。

当前已落地核心骨架和三个浏览器站点适配器：

- `kimi`
- `qwen`
- `deepseek`
- `deepseek-r1`
- `doubao`
- `glm`
- `glm-think`





## 启动

```bash
cd openclaw-web-bridge

npm install
npm start
```

服务会按 `config.json` 里的 `browser` 配置自动启动调试 Chrome 

```json
{
  "browser": {
    "cdpUrl": "http://127.0.0.1:9222",
    "autoLaunch": true,
    "executablePath": "",
    "userDataDir": ".chrome-profile",
    "launchTimeoutMs": 15000,
    "extraArgs": []
  }
}
```

`userDataDir` 就是 Chrome 登录态保存目录；需要设置

