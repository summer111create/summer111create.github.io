import { randomUUID } from "node:crypto";

const DOUBAO_BASE_URL = "https://www.doubao.com";

export class DoubaoProvider {
  constructor(config, browser) {
    this.id = config.id;
    this.type = "doubao";
    this.baseUrl = config.baseUrl || DOUBAO_BASE_URL;
    this.model = config.model || "doubao-seed-2.0";
    this.browser = browser;
    this.conversationId = null;
  }

  listModels() {
    return [
      {
        id: this.id,
        upstreamModel: this.model,
        aliases: [`${this.id}/${this.model}`, "doubao-web/doubao-seed-2.0"],
      },
    ];
  }

  async chat({ model, prompt }) {
    const page = await this.browser.pageForUrl(`${this.baseUrl}/chat/`);
    await waitForUsablePage(page, this.baseUrl);

    const result = await page.evaluate(
      async ({ baseUrl, model, prompt, conversationId }) => {
        const params = new URLSearchParams({
          aid: "497858",
          device_platform: "web",
          language: "zh",
          pkg_type: "release_version",
          real_aid: "497858",
          region: "CN",
          samantha_web: "1",
          sys_region: "CN",
          use_olympus_account: "1",
          version_code: "20800",
        });

        const text = `<|im_start|>user\n${prompt}\n<|im_end|>\n`;
        const body = {
          messages: [
            {
              content: JSON.stringify({ text }),
              content_type: 2001,
              attachments: [],
              references: [],
            },
          ],
          completion_option: {
            is_regen: false,
            with_suggest: true,
            need_create_conversation: !conversationId,
            launch_stage: 1,
            is_replace: false,
            is_delete: false,
            message_from: 0,
            event_id: "0",
          },
          conversation_id: conversationId || "0",
          local_conversation_id: `local_16${Date.now().toString().slice(-14)}`,
          local_message_id: crypto.randomUUID(),
        };

        const res = await fetch(`${baseUrl}/samantha/chat/completion?${params.toString()}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Referer: `${baseUrl}/chat/`,
            Origin: baseUrl,
            "Agw-js-conv": "str",
          },
          body: JSON.stringify(body),
          credentials: "include",
        });

        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            error: (await res.text()).slice(0, 1000),
          };
        }

        const reader = res.body?.getReader();
        if (!reader) {
          return { ok: false, status: 500, error: "Doubao response has no body" };
        }

        const decoder = new TextDecoder();
        let raw = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          raw += decoder.decode(value, { stream: true });
        }

        return { ok: true, raw };
      },
      {
        baseUrl: this.baseUrl,
        model,
        prompt,
        conversationId: this.conversationId,
      },
    );

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        throw new Error(
          "Doubao login expired. Open the CDP Chrome, log in at doubao.com, then retry.",
        );
      }
      throw new Error(`Doubao API error ${result.status || ""}: ${result.error || "unknown"}`);
    }

    const parsed = parseDoubaoSse(result.raw || "");
    if (!this.conversationId && parsed.conversationId) {
      this.conversationId = parsed.conversationId;
    }
    if (!parsed.text) {
      const doubaoError = extractDoubaoError(result.raw || "");
      if (doubaoError) {
        console.warn(`${doubaoError} Falling back to Doubao web UI.`);
        return chatWithDoubaoWebUi(page, prompt);
      }

      const preview = String(result.raw || "").slice(0, 800).replace(/\s+/g, " ").trim();
      throw new Error(
        `Doubao returned no parsed text. Response format may have changed. Raw preview: ${preview}`,
      );
    }
    return parsed.text;
  }
}

async function chatWithDoubaoWebUi(page, prompt) {
  await waitForUsablePage(page, DOUBAO_BASE_URL);

  const beforeAssistantCount = await page
    .locator('[data-testid*="message"], [class*="message"], [class*="answer"], [class*="bot"]')
    .count()
    .catch(() => 0);

  const editor = page
    .locator(
      [
        '[contenteditable="true"]',
        'textarea',
        'div[role="textbox"]',
        '.semi-input-textarea',
        '.chat-input textarea',
      ].join(", "),
    )
    .last();

  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.click();

  const tagName = await editor.evaluate((element) => element.tagName.toLowerCase());
  if (tagName === "textarea" || tagName === "input") {
    await editor.fill(prompt);
  } else {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.type(prompt, { delay: 1 });
  }

  const sendButton = page
    .locator(
      [
        'button:has-text("发送")',
        'button[aria-label*="发送"]',
        'button[class*="send"]',
        '[role="button"]:has-text("发送")',
        '[aria-label*="发送"]',
      ].join(", "),
    )
    .last();

  if ((await sendButton.count()) > 0) {
    await sendButton.click({ timeout: 15000 });
  } else {
    await page.keyboard.press("Enter");
  }

  await page.waitForFunction(
    ({ beforeAssistantCount: count }) => {
      const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
      const candidates = Array.from(
        document.querySelectorAll(
          '[data-testid*="message"], [class*="message"], [class*="answer"], [class*="bot"]',
        ),
      )
        .map((element) => clean(element.innerText || element.textContent))
        .filter(Boolean);
      return candidates.length > count;
    },
    { beforeAssistantCount },
    { timeout: 120000 },
  );

  await page.waitForTimeout(2000);

  const text = await page.evaluate(() => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const blockedText = new Set(["发送", "重新生成", "复制", "点赞", "点踩"]);
    const candidates = Array.from(
      document.querySelectorAll(
        '[data-testid*="message"], [class*="message"], [class*="answer"], [class*="bot"]',
      ),
    )
      .map((element) => clean(element.innerText || element.textContent))
      .filter((value) => value && !blockedText.has(value));

    return candidates[candidates.length - 1] || "";
  });

  if (!text) {
    throw new Error("Doubao web UI fallback did not find an assistant response.");
  }

  return text;
}

async function waitForUsablePage(page, baseUrl) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
  } catch {
    // Existing pages can already be loaded or mid-transition.
  }

  try {
    const target = new URL(baseUrl).hostname;
    await page.waitForFunction((hostname) => location.hostname.endsWith(hostname), target, {
      timeout: 10000,
    });
  } catch {
    await page.goto(`${baseUrl}/chat/`, { waitUntil: "domcontentloaded" });
  }
}

function parseDoubaoSse(raw) {
  const chunks = [];
  let conversationId = "";
  let currentEvent = {};

  const consumeData = (dataText, eventName = "") => {
    if (!dataText || dataText === "[DONE]") {
      return;
    }

    try {
      const data = JSON.parse(dataText);
      conversationId ||= extractConversationId(data);
      const deltas = extractDoubaoText(data, eventName);
      for (const delta of deltas) {
        if (delta) {
          chunks.push(delta);
        }
      }
    } catch {
      // Keep parsing later lines.
    }
  };

  const flushCurrentEvent = () => {
    if (currentEvent.event && currentEvent.data) {
      consumeData(currentEvent.data, currentEvent.event);
    }
    currentEvent = {};
  };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushCurrentEvent();
      continue;
    }

    const singleLine = trimmed.match(/^id:\s*\S+\s+event:\s*(\S+)\s+data:\s*(.+)$/);
    if (singleLine) {
      flushCurrentEvent();
      consumeData(singleLine[2].trim(), singleLine[1].trim());
      continue;
    }

    if (trimmed.startsWith("id:")) {
      currentEvent.id = trimmed.slice(3).trim();
      continue;
    }
    if (trimmed.startsWith("event:")) {
      currentEvent.event = trimmed.slice(6).trim();
      continue;
    }
    if (trimmed.startsWith("data:")) {
      currentEvent.data = trimmed.slice(5).trim();
      consumeData(currentEvent.data, currentEvent.event || "");
      currentEvent = {};
      continue;
    }

    consumeData(trimmed);
  }

  flushCurrentEvent();
  return { text: chunks.join(""), conversationId };
}

function extractConversationId(data) {
  if (typeof data.conversation_id === "string" && data.conversation_id !== "0") {
    return data.conversation_id;
  }
  if (typeof data.sessionId === "string" && data.sessionId !== "0") {
    return data.sessionId;
  }

  const eventData = parseEventData(data.event_data);
  const candidates = [
    eventData?.conversation_id,
    eventData?.conversation?.conversation_id,
    eventData?.message?.conversation_id,
  ];
  return candidates.find((value) => typeof value === "string" && value !== "0") || "";
}

function extractDoubaoText(data, eventName = "") {
  const chunks = [];

  if (eventName === "CHUNK_DELTA" && typeof data.text === "string") {
    chunks.push(data.text);
  }
  if (eventName === "STREAM_CHUNK" && Array.isArray(data.patch_op)) {
    for (const patch of data.patch_op) {
      const text = patch?.patch_value?.tts_content;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  if (eventName === "STREAM_MSG_NOTIFY" && Array.isArray(data.content?.content_block)) {
    for (const block of data.content.content_block) {
      const text = block?.content?.text_block?.text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  if (chunks.length > 0) {
    return chunks;
  }

  const eventData = parseEventData(data.event_data);

  if (data.event_type === 2001 && eventData?.message) {
    const contentType = eventData.message.content_type;
    if (contentType === undefined || [2001, 2008].includes(contentType)) {
      const text = parseMessageContent(eventData.message.content);
      if (text) {
        chunks.push(text);
      }
    }
  }

  const candidates = [
    eventData?.text,
    eventData?.content,
    eventData?.delta,
    data.choices?.[0]?.delta?.content,
    data.text,
    data.content,
    data.delta,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      chunks.push(candidate);
    }
  }

  return chunks;
}

function parseEventData(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseMessageContent(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return value;
  }
}

function extractDoubaoError(raw) {
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const dataText = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
    if (!dataText || dataText === "[DONE]") {
      continue;
    }

    try {
      const data = JSON.parse(dataText);
      const eventData = parseEventData(data.event_data);
      const code = eventData?.code ?? data.code;
      const message = eventData?.message || data.message || eventData?.error_detail?.message;
      const decision = parseEventData(eventData?.error_detail?.ext?.decision);
      const decisionType = decision?.type;
      const decisionSubtype = decision?.subtype;

      if (code || message) {
        if (message === "rate limited" || decisionType === "verify") {
          return [
            `Doubao request was blocked by rate limit or verification`,
            `code=${code || "unknown"}`,
            `message=${message || "unknown"}`,
            decisionType ? `decision=${decisionType}` : "",
            decisionSubtype ? `subtype=${decisionSubtype}` : "",
            "Open doubao.com in the CDP Chrome, finish any verification, or wait and retry.",
          ].filter(Boolean).join(". ");
        }

        return `Doubao API error: code=${code || "unknown"}, message=${message || "unknown"}`;
      }
    } catch {
      // Keep scanning later lines.
    }
  }

  return "";
}
