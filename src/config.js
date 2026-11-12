import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 3010,
  authToken: "",
  browser: {
    cdpUrl: "http://127.0.0.1:9222",
    navigationTimeoutMs: 30000,
    autoLaunch: true,
    executablePath: "",
    userDataDir: ".chrome-profile",
    launchTimeoutMs: 15000,
    launchCooldownMs: 60000,
    extraArgs: [],
  },
  agent: {
    workspaceRoot: ".",
    allowRequestWorkspaceRoot: false,
    allowAnyPath: false,
  },
  providers: [
    {
      id: "kimi",
      type: "kimi",
      baseUrl: "https://www.kimi.com",
    },
    {
      id: "qwen",
      type: "qwen",
      baseUrl: "https://chat.qwen.ai",
    },
    {
      id: "deepseek",
      type: "deepseek",
      baseUrl: "https://chat.deepseek.com",
    },
    {
      id: "doubao",
      type: "doubao",
      baseUrl: "https://www.doubao.com",
    },
    {
      id: "glm",
      type: "glm",
      baseUrl: "https://chatglm.cn",
    },
  ],
};

export function loadConfig() {
  const configPath = resolve(process.env.OPENCLAW_WEB_BRIDGE_CONFIG || "config.json");
  const fileConfig = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};

  const config = mergeConfig(DEFAULT_CONFIG, fileConfig);

  if (process.env.OPENCLAW_WEB_BRIDGE_HOST) {
    config.host = process.env.OPENCLAW_WEB_BRIDGE_HOST;
  }
  if (process.env.OPENCLAW_WEB_BRIDGE_PORT) {
    config.port = Number(process.env.OPENCLAW_WEB_BRIDGE_PORT);
  }
  if (process.env.OPENCLAW_WEB_BRIDGE_TOKEN) {
    config.authToken = process.env.OPENCLAW_WEB_BRIDGE_TOKEN;
  }
  if (process.env.OPENCLAW_WEB_BRIDGE_CDP_URL) {
    config.browser.cdpUrl = process.env.OPENCLAW_WEB_BRIDGE_CDP_URL;
  }

  if (!Number.isFinite(config.port) || config.port <= 0) {
    throw new Error(`Invalid port: ${config.port}`);
  }
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error("At least one provider must be configured");
  }

  return config;
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    browser: {
      ...base.browser,
      ...(override.browser || {}),
    },
    agent: {
      ...base.agent,
      ...(override.agent || {}),
    },
    providers: override.providers || base.providers,
  };
}
