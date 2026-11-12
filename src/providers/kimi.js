export class KimiProvider {
  constructor(config, browser) {
    this.id = config.id;
    this.type = "kimi";
    this.baseUrl = config.baseUrl || "https://www.kimi.com";
    this.model = config.model || "moonshot-v1-32k";
    this.browser = browser;
  }

  listModels() {
    return [
      {
        id: this.id,
        upstreamModel: this.model,
        aliases: [`${this.id}/${this.model}`, "kimi-web/moonshot-v1-32k"],
      },
    ];
  }

  async chat({ model, prompt }) {
    let text = "";
    for await (const delta of this.streamChat({ model, prompt })) {
      text += delta;
    }
    return text;
  }

  async *streamChat({ model, prompt }) {
    const page = await this.browser.pageForUrl(`${this.baseUrl}/`);
    await waitForUsablePage(page);
    const cookies = await this.browser.cookies(this.baseUrl);
    const kimiAuth = cookies.find((cookie) => cookie.name === "kimi-auth")?.value;
    const accessToken = await evaluateWithRetry(page, () => localStorage.getItem("access_token"));
    const authToken = accessToken || kimiAuth;

    if (!authToken) {
      throw new Error(
        "Kimi login not found. Open the CDP Chrome, log in at kimi.com, then retry.",
      );
    }

    const scenario = getScenario(model);
    for await (const delta of streamKimiChat({
      baseUrl: this.baseUrl,
      message: prompt,
      authToken,
      scenario,
    })) {
      yield delta;
    }
  }
}

async function waitForUsablePage(page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  } catch {
    // Existing pages can already be loaded or mid-transition; retry wrapper handles the rest.
  }
  try {
    await page.waitForFunction(() => location.hostname.includes("kimi.com"), { timeout: 10000 });
  } catch {
    await page.goto("https://www.kimi.com/", { waitUntil: "domcontentloaded" });
  }
}

async function evaluateWithRetry(page, fn, arg) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await waitForUsablePage(page);
      return await page.evaluate(fn, arg);
    } catch (error) {
      lastError = error;
      if (!isNavigationContextError(error) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 + attempt * 700));
    }
  }
  throw lastError;
}

function isNavigationContextError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("Cannot find context with specified id") ||
    message.includes("Target closed") ||
    message.includes("navigation")
  );
}

function getScenario(model) {
  return model.includes("search")
    ? "SCENARIO_SEARCH"
    : model.includes("research")
      ? "SCENARIO_RESEARCH"
      : model.includes("k1")
        ? "SCENARIO_K1"
        : "SCENARIO_K2";
}

function buildKimiRequestBody({ message, scenario }) {
  const req = {
    scenario,
    message: {
      role: "user",
      blocks: [{ message_id: "", text: { content: message } }],
      scenario,
    },
    options: { thinking: false },
  };

  const enc = new TextEncoder().encode(JSON.stringify(req));
  const buf = new Uint8Array(5 + enc.byteLength);
  const view = new DataView(buf.buffer);
  view.setUint8(0, 0);
  view.setUint32(1, enc.byteLength, false);
  buf.set(enc, 5);
  return buf;
}

async function* streamKimiChat({ baseUrl, message, authToken, scenario }) {
  const body = buildKimiRequestBody({ message, scenario });

  const res = await fetch(`${baseUrl}/apiv2/kimi.gateway.chat.v1.ChatService/Chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/connect+json",
      "Connect-Protocol-Version": "1",
      Accept: "*/*",
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      "X-Language": "zh-CN",
      "X-Msh-Platform": "web",
      Authorization: `Bearer ${authToken}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Kimi API error ${res.status}: ${(await res.text()).slice(0, 800)}`);
  }

  if (!res.body) {
    throw new Error("Kimi API response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = new Uint8Array(0);
  let lastSetText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pending = concatBytes(pending, value);
    while (pending.length >= 5) {
      const frameLength = new DataView(pending.buffer, pending.byteOffset + 1, 4).getUint32(
        0,
        false,
      );
      if (pending.length < 5 + frameLength) {
        break;
      }

      const frame = pending.slice(5, 5 + frameLength);
      pending = pending.slice(5 + frameLength);
      const text = decoder.decode(frame);
      let obj;
      try {
        obj = JSON.parse(text);
      } catch {
        continue;
      }

      if (obj.error) {
        throw new Error(obj.error.message || obj.error.code || JSON.stringify(obj.error));
      }

      const extracted = extractKimiText(obj, lastSetText);
      if (typeof extracted.lastSetText === "string") {
        lastSetText = extracted.lastSetText;
      }
      if (extracted.delta) {
        yield extracted.delta;
      }
    }
  }
}

function extractKimiText(obj, lastSetText) {
  const op = obj.op || "";
  const content = obj.block?.text?.content || obj.text?.content || "";

  if (content && op === "append") {
    return { delta: content };
  }
  if (content && op === "set") {
    if (content.startsWith(lastSetText)) {
      return { delta: content.slice(lastSetText.length), lastSetText: content };
    }
    return { delta: content, lastSetText: content };
  }
  if (!op && obj.message?.role === "assistant" && obj.message?.blocks) {
    const full = obj.message.blocks.map((block) => block.text?.content || "").join("");
    if (full.startsWith(lastSetText)) {
      return { delta: full.slice(lastSetText.length), lastSetText: full };
    }
    return { delta: full, lastSetText: full };
  }
  return { delta: "" };
}

function concatBytes(left, right) {
  if (!left.length) {
    return right;
  }
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}
