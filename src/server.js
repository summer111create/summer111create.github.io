#!/usr/bin/env node
import { createServer } from "node:http";
import { CdpBrowser } from "./browser/cdp.js";
import { loadConfig } from "./config.js";
import { handleOpenClawAgent } from "./agent.js";
import { handleChatCompletions, writeError, writeJson } from "./openai.js";
import { ProviderRegistry } from "./providers/registry.js";

const config = loadConfig();
const browser = new CdpBrowser(config.browser);
const registry = new ProviderRegistry(config, browser);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        service: "openclaw-web-bridge",
        cdpUrl: config.browser.cdpUrl,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/models") {
      if (!authorize(req, res)) {
        return;
      }
      writeJson(res, 200, { object: "list", data: registry.listModels() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      if (!authorize(req, res)) {
        return;
      }
      await handleChatCompletions(req, res, registry);
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/agent") {
      if (!authorize(req, res)) {
        return;
      }
      await handleOpenClawAgent(req, res, registry, config);
      return;
    }

    if (
      req.method === "POST" &&
      (url.pathname === "/v1/openclaw/chat/completions" || url.pathname === "/agent/chat")
    ) {
      if (!authorize(req, res)) {
        return;
      }
      await handleOpenClawAgent(req, res, registry, config, { openai: true });
      return;
    }

    writeError(res, 404, `Route not found: ${req.method} ${url.pathname}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(res, 500, message);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`openclaw-web-bridge listening on http://${config.host}:${config.port}`);
  console.log(`CDP Chrome: ${config.browser.cdpUrl}`);
  console.log(`Models: ${registry.listModels().map((m) => m.id).join(", ")}`);
  if (config.browser.autoLaunch) {
    browser
      .ensureAvailable()
      .then(() => console.log("CDP Chrome is ready"))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`CDP Chrome auto launch failed: ${message}`);
      });
  }
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function authorize(req, res) {
  if (!config.authToken) {
    return true;
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const apiKey = req.headers["x-api-key"] || "";
  if (token === config.authToken || apiKey === config.authToken) {
    return true;
  }

  writeError(res, 401, "Missing or invalid bearer token");
  return false;
}

async function shutdown() {
  console.log("Shutting down openclaw-web-bridge...");
  server.close();
  await browser.close().catch(() => {});
  process.exit(0);
}
