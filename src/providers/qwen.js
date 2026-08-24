import { randomUUID } from "node:crypto";

export class QwenProvider {
  constructor(config, browser) {
    this.id = config.id;
    this.type = "qwen";
    this.baseUrl = config.baseUrl || "https://chat.qwen.ai";
    this.model = config.model || "qwen3.5-plus";
    this.browser = browser;
  }

  listModels() {
    return [
      {
        id: this.id,
        upstreamModel: this.model,
        aliases: [`${this.id}/${this.model}`, "qwen-web/qwen3.5-plus"],
      },
    ];
  }

  async chat({ model, prompt }) {
    const page = await this.browser.pageForUrl(`${this.baseUrl}/`);
    const fid = randomUUID();

    const result = await page.evaluate(
      async ({ baseUrl, model, message, fid }) => {
        const createRes = await fetch(`${baseUrl}/api/v2/chats/new`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          credentials: "include",
        });

        if (!createRes.ok) {
          return {
            ok: false,
            status: createRes.status,
            error: (await createRes.text()).slice(0, 800),
          };
        }

        const createData = await createRes.json();
        const chatId = createData.data?.id ?? createData.chat_id ?? createData.id;
        if (!chatId) {
          return { ok: false, status: 500, error: "Qwen did not return chat id" };
        }

        const body = {
          stream: true,
          version: "2.1",
          incremental_output: true,
          chat_id: chatId,
          chat_mode: "normal",
          model,
          parent_id: null,
          messages: [
            {
              fid,
              parentId: null,
              childrenIds: [],
              role: "user",
              content: message,
              user_action: "chat",
              files: [],
              timestamp: Math.floor(Date.now() / 1000),
              models: [model],
              chat_type: "t2t",
              feature_config: { thinking_enabled: false },
            },
          ],
        };

        const res = await fetch(`${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          credentials: "include",
        });

        if (!res.ok) {
          return { ok: false, status: res.status, error: (await res.text()).slice(0, 800) };
        }

        const reader = res.body?.getReader();
        if (!reader) {
          return { ok: false, status: 500, error: "Qwen response has no body" };
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
        message: prompt,
        fid,
      },
    );

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        throw new Error("Qwen login expired. Open the CDP Chrome, log in at chat.qwen.ai, then retry.");
      }
      throw new Error(`Qwen API error ${result.status || ""}: ${result.error || "unknown"}`);
    }

    return parseQwenSseText(result.raw);
  }
}

function parseQwenSseText(raw) {
  const texts = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      const obj = JSON.parse(data);
      collectText(obj, texts);
    } catch {
      // Keep parsing later SSE lines.
    }
  }

  return stripQwenThinking(texts.join(""));
}

function stripQwenThinking(text) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }

  const withoutThinkTags = value.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
  if (!/^Thinking Process:/i.test(withoutThinkTags)) {
    return withoutThinkTags;
  }

  const lines = withoutThinkTags
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line.startsWith("*") && !line.startsWith("-") && !/^(Wait|Okay|Check|Final|Draft)/i.test(line)) {
      return line;
    }
  }

  return withoutThinkTags;
}

function collectText(value, out) {
  if (!value || typeof value !== "object") {
    return;
  }

  const candidates = [
    value.output?.text,
    value.response?.text,
    value.message?.content,
    value.delta?.content,
    value.choices?.[0]?.delta?.content,
    value.choices?.[0]?.message?.content,
    value.data?.message?.content,
    value.data?.content,
    value.content,
    value.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      out.push(candidate);
      return;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, out);
    }
    return;
  }

  for (const key of ["data", "message", "response", "output", "delta"]) {
    collectText(value[key], out);
  }
}
