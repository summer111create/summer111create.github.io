import { randomUUID } from "node:crypto";

export async function handleChatCompletions(req, res, registry) {
  const body = await readJson(req);
  validateChatRequest(body);

  const { provider, model } = registry.resolve(body.model);
  const prompt = messagesToPrompt(body.messages);

  if (body.stream) {
    if (typeof provider.streamChat === "function") {
      await writeProviderSseChatCompletion(res, body.model, provider.streamChat({
        model,
        prompt,
        messages: body.messages,
      }));
      return;
    }

    const text = await provider.chat({
      model,
      prompt,
      messages: body.messages,
    });
    writeSseChatCompletion(res, body.model, text);
    return;
  }

  const text = await provider.chat({
    model,
    prompt,
    messages: body.messages,
  });

  writeJson(res, 200, createChatCompletion(body.model, text));
}

export function createChatCompletion(model, content) {
  return {
    id: `chatcmpl_${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

export function writeSseChatCompletion(res, model, content) {
  const id = `chatcmpl_${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  writeSse(res, {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });
  for (const chunk of chunkText(content, 64)) {
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    });
  }
  writeSse(res, {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

export async function writeProviderSseChatCompletion(res, model, deltas) {
  const id = `chatcmpl_${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  writeSse(res, {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  try {
    for await (const delta of deltas) {
      if (!delta) {
        continue;
      }
      writeSse(res, {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      });
    }
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write("data: [DONE]\n\n");
  } catch (error) {
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "error" }],
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    res.write("data: [DONE]\n\n");
  } finally {
    res.end();
  }
}

export function messagesToPrompt(messages) {
  return messages
    .map((message) => {
      const role = message.role || "user";
      const content = normalizeContent(message.content);
      return `${role}: ${content}`;
    })
    .join("\n\n");
}

export function writeJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value, null, 2));
}

export function writeError(res, status, message) {
  writeJson(res, status, {
    error: {
      message,
      type: "openclaw_web_bridge_error",
    },
  });
}

function validateChatRequest(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  if (typeof body.model !== "string" || !body.model) {
    throw new Error("Request body requires string field 'model'");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("Request body requires non-empty array field 'messages'");
  }
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text") {
          return part.text || "";
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function writeSse(res, value) {
  res.write(`data: ${JSON.stringify(value)}\n\n`);
}

function chunkText(text, size) {
  const chunks = [];
  const value = String(text || "");
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}
