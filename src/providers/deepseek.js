import crypto from "node:crypto";
import { SHA3_WASM_B64 } from "./deepseek-wasm.js";

const DEEPSEEK_BASE_URL = "https://chat.deepseek.com";

export class DeepSeekProvider {
  constructor(config, browser) {
    this.id = config.id;
    this.type = "deepseek";
    this.baseUrl = config.baseUrl || DEEPSEEK_BASE_URL;
    this.chatModel = config.chatModel || "deepseek-chat";
    this.reasonerModel = config.reasonerModel || "deepseek-reasoner";
    this.browser = browser;
    this.client = null;
    this.sessionByKey = new Map();
    this.parentByKey = new Map();
  }

  listModels() {
    return [
      {
        id: this.id,
        upstreamModel: this.chatModel,
        aliases: [`${this.id}/${this.chatModel}`, "deepseek-web/deepseek-chat"],
      },
      {
        id: `${this.id}-r1`,
        upstreamModel: this.reasonerModel,
        aliases: [`${this.id}/${this.reasonerModel}`, "deepseek-web/deepseek-reasoner"],
      },
    ];
  }

  async chat({ model, prompt, messages }) {
    let text = "";
    for await (const delta of this.streamChat({ model, prompt, messages })) {
      text += delta;
    }
    return text;
  }

  async *streamChat({ model, prompt }) {
    const client = await this.getClient();
    const sessionKey = "default";
    let sessionId = this.sessionByKey.get(sessionKey);
    let parentMessageId = this.parentByKey.get(sessionKey);

    if (!sessionId) {
      const session = await client.createChatSession();
      sessionId = session.chat_session_id;
      this.sessionByKey.set(sessionKey, sessionId);
      parentMessageId = null;
    }

    const responseStream = await client.chatCompletions({
      sessionId,
      parentMessageId,
      message: prompt,
      model,
      searchEnabled: model.includes("search"),
    });

    if (!responseStream) {
      throw new Error("DeepSeek Web API returned empty response body");
    }

    for await (const event of parseDeepSeekSse(responseStream)) {
      if (event.parentMessageId) {
        this.parentByKey.set(sessionKey, event.parentMessageId);
      }
      if (event.text) {
        yield event.text;
      }
    }
  }

  async getClient() {
    if (this.client) {
      return this.client;
    }

    const credentials = await captureDeepSeekCredentials(this.browser, this.baseUrl);
    this.client = new DeepSeekWebClient(credentials, this.baseUrl);
    await this.client.init();
    return this.client;
  }
}

class DeepSeekWebClient {
  constructor(options, baseUrl = DEEPSEEK_BASE_URL) {
    this.baseUrl = baseUrl;
    this.cookie = options.cookie || "";
    this.bearer = options.bearer || "";
    this.userAgent =
      options.userAgent ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    this.wasmModule = null;
  }

  async init() {
    try {
      await fetch(`${this.baseUrl}/api/v0/client/settings?did=&scope=banner`, {
        headers: this.fetchHeaders(),
      });
    } catch {
      // Settings are opportunistic; chat endpoints report real auth failures.
    }
  }

  fetchHeaders() {
    return {
      Cookie: this.cookie,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
      Accept: "*/*",
      ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
      "x-client-platform": "web",
      "x-client-version": "1.7.0",
      "x-app-version": "20241129.1",
      "x-client-locale": "zh_CN",
      "x-client-timezone-offset": "28800",
    };
  }

  async createPowChallenge(targetPath) {
    const response = await fetch(`${this.baseUrl}/api/v0/chat/create_pow_challenge`, {
      method: "POST",
      headers: this.fetchHeaders(),
      body: JSON.stringify({ target_path: targetPath }),
    });

    if (!response.ok) {
      throw new Error(
        `DeepSeek PoW challenge failed ${response.status}: ${(await response.text()).slice(0, 800)}`,
      );
    }

    const data = await response.json();
    const challenge = data.data?.biz_data?.challenge || data.data?.challenge || data.challenge;
    if (!challenge) {
      throw new Error("DeepSeek PoW challenge missing in response");
    }
    return challenge;
  }

  async solvePow(challenge) {
    const { algorithm, challenge: target, salt, difficulty, expire_at: expireAt } = challenge;

    if (algorithm === "sha256") {
      let nonce = 0;
      const targetDifficulty = difficulty > 1000 ? Math.floor(Math.log2(difficulty)) : difficulty;
      while (nonce <= 1000000) {
        const hash = crypto.createHash("sha256").update(`${salt}${target}${nonce}`).digest("hex");
        let zeroBits = 0;
        for (const char of hash) {
          const value = Number.parseInt(char, 16);
          if (value === 0) {
            zeroBits += 4;
          } else {
            zeroBits += Math.clz32(value) - 28;
            break;
          }
        }
        if (zeroBits >= targetDifficulty) {
          return nonce;
        }
        nonce++;
      }
      throw new Error("DeepSeek sha256 PoW timeout");
    }

    if (algorithm === "DeepSeekHashV1") {
      const instance = await this.getWasmInstance();
      const exports = instance.exports;
      const memory = exports.memory;
      const alloc = exports.__wbindgen_export_0;
      const addToStack = exports.__wbindgen_add_to_stack_pointer;
      const wasmSolve = exports.wasm_solve;

      const encodeString = (value) => {
        const buffer = Buffer.from(value, "utf8");
        const pointer = alloc(buffer.length, 1);
        new Uint8Array(memory.buffer).set(buffer, pointer);
        return [pointer, buffer.length];
      };

      const [ptrC, lenC] = encodeString(target);
      const [ptrP, lenP] = encodeString(`${salt}_${expireAt}_`);
      const retptr = addToStack(-16);
      wasmSolve(retptr, ptrC, lenC, ptrP, lenP, difficulty);

      const view = new DataView(memory.buffer);
      const status = view.getInt32(retptr, true);
      const answer = view.getFloat64(retptr + 8, true);
      addToStack(16);

      if (status === 0) {
        throw new Error("DeepSeekHashV1 failed to find a PoW solution");
      }
      return answer;
    }

    throw new Error(`Unsupported DeepSeek PoW algorithm: ${algorithm}`);
  }

  async getWasmInstance() {
    if (this.wasmModule) {
      return this.wasmModule;
    }
    const wasmBuffer = Buffer.from(SHA3_WASM_B64, "base64");
    const { instance } = await WebAssembly.instantiate(wasmBuffer, { wbg: {} });
    this.wasmModule = instance;
    return instance;
  }

  async createChatSession() {
    const response = await fetch(`${this.baseUrl}/api/v0/chat_session/create`, {
      method: "POST",
      headers: this.fetchHeaders(),
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(
        `DeepSeek chat session failed ${response.status}: ${(await response.text()).slice(0, 800)}`,
      );
    }

    const data = await response.json();
    const session = data.data?.biz_data || {};
    const sessionId = session.id || session.chat_session_id || "";
    if (!sessionId) {
      throw new Error("DeepSeek did not return a chat session id");
    }
    return { ...session, chat_session_id: sessionId };
  }

  async chatCompletions(params) {
    const targetPath = "/api/v0/chat/completion";
    const challenge = await this.createPowChallenge(targetPath);
    const answer = await this.solvePow(challenge);
    const powResponse = Buffer.from(
      JSON.stringify({
        ...challenge,
        answer,
        target_path: targetPath,
      }),
    ).toString("base64");

    const response = await fetch(`${this.baseUrl}${targetPath}`, {
      method: "POST",
      headers: {
        ...this.fetchHeaders(),
        "x-ds-pow-response": powResponse,
      },
      body: JSON.stringify({
        chat_session_id: params.sessionId,
        parent_message_id: params.parentMessageId ?? null,
        prompt: params.message,
        ref_file_ids: params.fileIds || [],
        thinking_enabled: !(
          params.model === "deepseek-chat" && !params.model?.includes("reasoning")
        ),
        search_enabled: params.searchEnabled ?? false,
        preempt: params.preempt ?? false,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      throw new Error(
        `DeepSeek chat completion failed ${response.status}: ${(await response.text()).slice(0, 800)}`,
      );
    }

    return response.body;
  }
}

async function captureDeepSeekCredentials(browser, baseUrl) {
  const page = await browser.pageForUrl(`${baseUrl}/`);
  await waitForDeepSeekPage(page, baseUrl);
  const cookies = await browser.cookies(baseUrl);
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ");
  const userAgent = await page.evaluate(() => navigator.userAgent);
  let bearer = await findBearerInBrowserStorage(page);

  if (!bearer) {
    bearer = await requestCurrentUserToken(page, baseUrl, cookie);
  }

  if (!bearer) {
    bearer = await waitForBearerFromDeepSeekPage(page, baseUrl);
  }

  if (!cookie || (!cookie.includes("ds_session_id=") && !cookie.includes("d_id=") && !bearer)) {
    throw new Error(
      "DeepSeek login not found. Open the CDP Chrome, log in at chat.deepseek.com, then retry.",
    );
  }
  if (!bearer) {
    throw new Error(
      "DeepSeek bearer token not found. Refresh chat.deepseek.com in the CDP Chrome after logging in, then retry.",
    );
  }

  return { cookie, bearer, userAgent };
}

async function requestCurrentUserToken(page, baseUrl, cookie) {
  try {
    const response = await page.request.get(`${baseUrl}/api/v0/users/current`, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    if (response.ok()) {
      const data = await response.json();
      const token = data?.data?.biz_data?.token;
      if (typeof token === "string" && token.length > 20) {
        return token;
      }
    }
  } catch {
    // Try an in-page request below.
  }

  try {
    const data = await page.evaluate(async () => {
      const response = await fetch("/api/v0/users/current", { credentials: "include" });
      if (!response.ok) {
        return null;
      }
      return response.json();
    });
    const token = data?.data?.biz_data?.token;
    return typeof token === "string" && token.length > 20 ? token : "";
  } catch {
    return "";
  }
}

async function waitForBearerFromDeepSeekPage(page, baseUrl) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (token) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      page.off("request", onRequest);
      page.off("response", onResponse);
      resolve(token || "");
    };

    const onRequest = (request) => {
      const url = request.url();
      if (!url.includes("/api/v0/")) {
        return;
      }
      const auth = request.headers().authorization || "";
      if (auth.startsWith("Bearer ")) {
        finish(auth.slice("Bearer ".length));
      }
    };

    const onResponse = async (response) => {
      const url = response.url();
      if (!url.includes("/api/v0/users/current") || !response.ok()) {
        return;
      }
      try {
        const data = await response.json();
        const token = data?.data?.biz_data?.token;
        if (typeof token === "string" && token.length > 20) {
          finish(token);
        }
      } catch {
        // Keep waiting for request headers.
      }
    };

    const timer = setTimeout(() => finish(""), 12000);
    page.on("request", onRequest);
    page.on("response", onResponse);

    queueMicrotask(async () => {
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
      } catch {
        try {
          await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 10000 });
        } catch {
          // The timeout resolves with an actionable error.
        }
      }

      try {
        await page.evaluate(async () => {
          await fetch("/api/v0/users/current", { credentials: "include" });
        });
      } catch {
        // The timeout resolves with an actionable error.
      }
    });
  });
}

async function waitForDeepSeekPage(page, baseUrl) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  } catch {
    // Existing pages can already be loaded.
  }

  try {
    const target = new URL(baseUrl).hostname;
    await page.waitForFunction((hostname) => location.hostname.endsWith(hostname), target, {
      timeout: 10000,
    });
  } catch {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
  }
}

async function findBearerInBrowserStorage(page) {
  try {
    return await page.evaluate(() => {
      const tokenKeys = new Set(["token", "access_token", "auth_token", "bearer"]);
      const seen = new Set();

      const inspect = (value) => {
        if (!value || seen.has(value)) {
          return "";
        }
        seen.add(value);

        if (typeof value === "string") {
          const trimmed = value.trim();
          if (/^[A-Za-z0-9._~+/=-]{24,}$/.test(trimmed) && !trimmed.includes(" ")) {
            return trimmed;
          }
          try {
            return inspect(JSON.parse(trimmed));
          } catch {
            return "";
          }
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            const found = inspect(item);
            if (found) {
              return found;
            }
          }
          return "";
        }

        if (typeof value === "object") {
          for (const [key, nested] of Object.entries(value)) {
            const normalized = key.toLowerCase();
            if (
              tokenKeys.has(normalized) ||
              normalized.includes("token") ||
              normalized.includes("auth")
            ) {
              const found = inspect(nested);
              if (found) {
                return found;
              }
            }
          }
        }
        return "";
      };

      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index) || "";
          const value = storage.getItem(key) || "";
          const normalized = key.toLowerCase();
          if (
            normalized.includes("token") ||
            normalized.includes("auth") ||
            normalized.includes("user")
          ) {
            const found = inspect(value);
            if (found) {
              return found;
            }
          }
        }
      }
      return "";
    });
  } catch {
    return "";
  }
}

async function* parseDeepSeekSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        yield parseDeepSeekLine(buffer.trim());
      }
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const parsed = parseDeepSeekLine(rawLine.trim());
      if (parsed.text || parsed.parentMessageId) {
        yield parsed;
      }
    }
  }
}

function parseDeepSeekLine(line) {
  if (!line.startsWith("data: ")) {
    return {};
  }

  const dataText = line.slice(6).trim();
  if (!dataText || dataText === "[DONE]") {
    return {};
  }

  try {
    const data = JSON.parse(dataText);
    return {
      parentMessageId: data.response_message_id || "",
      text: extractDeepSeekText(data),
    };
  } catch {
    return {};
  }
}

function extractDeepSeekText(data) {
  if (typeof data.v === "string") {
    if (!data.p || data.p.includes("content") || data.p.includes("choices")) {
      return filterDeepSeekText(data.v);
    }
    return "";
  }

  if (data.type === "text" && typeof data.content === "string") {
    return filterDeepSeekText(data.content);
  }

  if (Array.isArray(data.v)) {
    return data.v
      .map((item) =>
        typeof item.content === "string" && item.type !== "THINKING"
          ? filterDeepSeekText(item.content)
          : "",
      )
      .join("");
  }

  const fragments = data.v?.response?.fragments;
  if (Array.isArray(fragments)) {
    return fragments
      .map((item) =>
        typeof item.content === "string" && item.type !== "THINKING"
          ? filterDeepSeekText(item.content)
          : "",
      )
      .join("");
  }

  return filterDeepSeekText(data.choices?.[0]?.delta?.content || "");
}

function filterDeepSeekText(value) {
  const junk = new Set([
    "<｜end▁of▁thinking｜>",
    "<|end▁of▁thinking|>",
    "<｜end_of_thinking｜>",
    "<|end_of_thinking|>",
    "<|endoftext|>",
  ]);
  return junk.has(value) ? "" : value;
}
