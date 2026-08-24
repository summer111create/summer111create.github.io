import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

export class CdpBrowser {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.context = null;
    this.chromeProcess = null;
    this.lastLaunchAt = 0;
  }

  async connect() {
    if (this.context) {
      return this.context;
    }

    const wsUrl = await this.getOrLaunchChromeWebSocketUrl();
    const browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs || 30000);

    this.browser = browser;
    this.context = context;
    return context;
  }

  async getOrLaunchChromeWebSocketUrl() {
    try {
      return await getChromeWebSocketUrl(this.config.cdpUrl);
    } catch (error) {
      if (!this.config.autoLaunch) {
        throw error;
      }
    }

    this.launchChrome();
    return waitForChromeWebSocketUrl(
      this.config.cdpUrl,
      this.config.launchTimeoutMs || 15000,
    );
  }

  async ensureAvailable() {
    await this.getOrLaunchChromeWebSocketUrl();
  }

  launchChrome() {
    if (this.chromeProcess && !this.chromeProcess.killed) {
      return;
    }
    const now = Date.now();
    const cooldownMs = this.config.launchCooldownMs || 60000;
    if (now - this.lastLaunchAt < cooldownMs) {
      return;
    }
    this.lastLaunchAt = now;

    const executable = resolveChromeExecutable(this.config.executablePath);
    const args = buildChromeArgs(this.config);

    console.log(`Launching Chrome for CDP: ${executable} ${args.join(" ")}`);
    this.chromeProcess = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    this.chromeProcess.on("error", (error) => {
      console.error(`Failed to launch Chrome for CDP: ${error.message}`);
      this.chromeProcess = null;
    });
    this.chromeProcess.on("exit", () => {
      this.chromeProcess = null;
    });
    this.chromeProcess.unref();
  }

  async pageForUrl(url) {
    const context = await this.connect();
    const target = new URL(url);
    const existing = context
      .pages()
      .find((page) => safeUrl(page.url())?.hostname.endsWith(target.hostname));

    if (existing) {
      return existing;
    }

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return page;
  }

  async cookies(url) {
    const context = await this.connect();
    return context.cookies([url]);
  }

  async close() {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }
}

export async function getChromeWebSocketUrl(cdpUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const versionUrl = new URL("/json/version", cdpUrl).toString();
    const response = await fetch(versionUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Chrome CDP ${versionUrl} returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.webSocketDebuggerUrl) {
      throw new Error(`Chrome CDP ${versionUrl} did not return webSocketDebuggerUrl`);
    }

    return data.webSocketDebuggerUrl;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForChromeWebSocketUrl(cdpUrl, timeoutMs) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      return await getChromeWebSocketUrl(cdpUrl);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Chrome CDP did not become ready within ${timeoutMs}ms: ${message}`);
}

function buildChromeArgs(config) {
  const cdp = new URL(config.cdpUrl);
  const userDataDir = config.userDataDir || ".chrome-profile";
  const args = [
    `--remote-debugging-port=${cdp.port || "9222"}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (cdp.hostname && cdp.hostname !== "localhost" && cdp.hostname !== "127.0.0.1") {
    args.push(`--remote-debugging-address=${cdp.hostname}`);
  }

  if (Array.isArray(config.extraArgs)) {
    args.push(...config.extraArgs.filter((arg) => typeof arg === "string" && arg.trim()));
  }

  return args;
}

function resolveChromeExecutable(configured) {
  if (configured) {
    return configured;
  }

  if (process.platform === "win32") {
    return "chrome.exe";
  }

  if (process.platform === "darwin") {
    return "google-chrome";
  }

  return "google-chrome";
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
