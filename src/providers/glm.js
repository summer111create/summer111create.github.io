import crypto from "node:crypto";

const GLM_BASE_URL = "https://chatglm.cn";
const DEFAULT_MODEL = "glm-4-plus";
const DEFAULT_ASSISTANT_ID = "65940acff94777010aa6b796";
const ASSISTANT_ID_MAP = {
  "glm-4-plus": "65940acff94777010aa6b796",
  "glm-4": "65940acff94777010aa6b796",
  "glm-4-think": "676411c38945bbc58a905d31",
  "glm-4-zero": "676411c38945bbc58a905d31",
};

const SIGN_SECRET = "8a1317a7468aa3ad86e997d08f3f31cb";
const X_EXP_GROUPS =
  "na_android_config:exp:NA,na_4o_config:exp:4o_A,tts_config:exp:tts_config_a," +
  "na_glm4plus_config:exp:open,mainchat_server_app:exp:A,mobile_history_daycheck:exp:a," +
  "desktop_toolbar:exp:A,chat_drawing_server:exp:A,drawing_server_cogview:exp:cogview4," +
  "app_welcome_v2:exp:A,chat_drawing_streamv2:exp:A,mainchat_rm_fc:exp:add," +
  "mainchat_dr:exp:open,chat_auto_entrance:exp:A,drawing_server_hi_dream:control:A," +
  "homepage_square:exp:close,assistant_recommend_prompt:exp:3,app_home_regular_user:exp:A," +
  "memory_common:exp:enable,mainchat_moe:exp:300,assistant_greet_user:exp:greet_user," +
  "app_welcome_personalize:exp:A,assistant_model_exp_group:exp:glm4.5," +
  "ai_wallet:exp:ai_wallet_enable";

export class GlmProvider {
  constructor(config, browser) {
    this.id = config.id;
    this.type = "glm";
    this.baseUrl = config.baseUrl || GLM_BASE_URL;
    this.model = config.model || DEFAULT_MODEL;
    this.browser = browser;
    this.conversationId = null;
    this.deviceId = crypto.randomUUID().replace(/-/g, "");
  }

  listModels() {
    return [
      {
        id: this.id,
        upstreamModel: this.model,
        aliases: [`${this.id}/${this.model}`, "glm-web/glm-4-plus"],
      },
      {
        id: `${this.id}-think`,
        upstreamModel: "glm-4-think",
        aliases: [`${this.id}/glm-4-think`, "glm-web/glm-4-think"],
      },
    ];
  }

  async chat({ model, prompt }) {
    const page = await this.browser.pageForUrl(this.baseUrl);
    await waitForUsablePage(page, this.baseUrl);

    let accessToken = await findAccessToken(page, this.baseUrl);
    if (!accessToken) {
      accessToken = await refreshAccessToken(page, this.deviceId);
    }

    const result = await page.evaluate(
      async ({ accessToken, body, deviceId, requestId, sign, xExpGroups }) => {
        const headers = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "App-Name": "chatglm",
          Origin: "https://chatglm.cn",
          "X-App-Platform": "pc",
          "X-App-Version": "0.0.1",
          "X-App-fr": "default",
          "X-Device-Brand": "",
          "X-Device-Id": deviceId,
          "X-Device-Model": "",
          "X-Exp-Groups": xExpGroups,
          "X-Lang": "zh",
          "X-Nonce": sign.nonce,
          "X-Request-Id": requestId,
          "X-Sign": sign.sign,
          "X-Timestamp": sign.timestamp,
        };
        if (accessToken) {
          headers.Authorization = `Bearer ${accessToken}`;
        }

        const res = await fetch("https://chatglm.cn/chatglm/backend-api/assistant/stream", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify(body),
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
          return { ok: false, status: 500, error: "ChatGLM response has no body" };
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
        accessToken,
        body: buildRequestBody({
          conversationId: this.conversationId,
          model,
          prompt,
        }),
        deviceId: this.deviceId,
        requestId: crypto.randomUUID().replace(/-/g, ""),
        sign: generateSign(),
        xExpGroups: X_EXP_GROUPS,
      },
    );

    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        throw new Error(
          "GLM login expired. Open the CDP Chrome, log in at chatglm.cn, then retry.",
        );
      }
      throw new Error(`GLM API error ${result.status || ""}: ${result.error || "unknown"}`);
    }

    const parsed = parseGlmSse(result.raw || "");
    if (!this.conversationId && parsed.conversationId) {
      this.conversationId = parsed.conversationId;
    }
    return parsed.text;
  }
}

function buildRequestBody({ conversationId, model, prompt }) {
  return {
    assistant_id: ASSISTANT_ID_MAP[model] || DEFAULT_ASSISTANT_ID,
    conversation_id: conversationId || "",
    project_id: "",
    chat_type: "user_chat",
    meta_data: {
      cogview: { rm_label_watermark: false },
      is_test: false,
      input_question_type: "xxxx",
      channel: "",
      draft_id: "",
      chat_mode: "zero",
      is_networking: false,
      quote_log_id: "",
      platform: "pc",
    },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    ],
  };
}

async function waitForUsablePage(page, baseUrl) {
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
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  }
}

async function findAccessToken(page, baseUrl) {
  try {
    const cookies = await page.context().cookies([baseUrl]);
    return cookies.find((cookie) => cookie.name === "chatglm_token")?.value || "";
  } catch {
    return "";
  }
}

async function refreshAccessToken(page, deviceId) {
  const refreshToken = await findRefreshToken(page);
  if (!refreshToken) {
    return "";
  }

  const result = await page.evaluate(
    async ({ refreshToken, deviceId, requestId, sign }) => {
      const res = await fetch("https://chatglm.cn/chatglm/user-api/user/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
          "App-Name": "chatglm",
          "X-App-Platform": "pc",
          "X-App-Version": "0.0.1",
          "X-Device-Id": deviceId,
          "X-Request-Id": requestId,
          "X-Sign": sign.sign,
          "X-Nonce": sign.nonce,
          "X-Timestamp": sign.timestamp,
        },
        credentials: "include",
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        return { ok: false, error: (await res.text()).slice(0, 500) };
      }

      const data = await res.json();
      const accessToken =
        data?.result?.access_token || data?.result?.accessToken || data?.accessToken || "";
      return { ok: true, accessToken };
    },
    {
      refreshToken,
      deviceId,
      requestId: crypto.randomUUID().replace(/-/g, ""),
      sign: generateSign(),
    },
  );

  return result.ok ? result.accessToken || "" : "";
}

async function findRefreshToken(page) {
  try {
    const cookies = await page.context().cookies(["https://chatglm.cn"]);
    return cookies.find((cookie) => cookie.name === "chatglm_refresh_token")?.value || "";
  } catch {
    return "";
  }
}

function generateSign() {
  const value = Date.now().toString();
  const digits = value.split("").map((char) => Number(char));
  const sum = digits.reduce((acc, digit) => acc + digit, 0) - digits[value.length - 2];
  const replacement = sum % 10;
  const timestamp = value.substring(0, value.length - 2) + replacement + value.slice(-1);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const sign = crypto
    .createHash("md5")
    .update(`${timestamp}-${nonce}-${SIGN_SECRET}`)
    .digest("hex");
  return { timestamp, nonce, sign };
}

function parseGlmSse(raw) {
  let conversationId = "";
  let accumulated = "";
  const chunks = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }

    const dataText = trimmed.slice(5).trim();
    if (!dataText || dataText === "[DONE]") {
      continue;
    }

    try {
      const data = JSON.parse(dataText);
      if (typeof data.conversation_id === "string") {
        conversationId ||= data.conversation_id;
      }

      const fullText = extractGlmText(data);
      if (fullText && fullText.length > accumulated.length) {
        chunks.push(fullText.slice(accumulated.length));
        accumulated = fullText;
      }
    } catch {
      // Keep parsing later SSE lines.
    }
  }

  return { text: chunks.join(""), conversationId };
}

function extractGlmText(data) {
  if (Array.isArray(data.parts)) {
    for (const part of data.parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const content = part.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const item of content) {
        if (item?.type === "text" && typeof item.text === "string") {
          return item.text;
        }
      }
    }
  }

  const candidates = [data.text, data.content, data.delta, data.choices?.[0]?.delta?.content];
  return candidates.find((value) => typeof value === "string" && value) || "";
}
