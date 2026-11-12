import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { messagesToPrompt, writeJson } from "./openai.js";

const MAX_AGENT_TURNS = 8;
const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".chrome-profile",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
]);

export async function handleOpenClawAgent(req, res, registry, config, options = {}) {
  const body = await readJson(req);

  if (options.openai && body.stream) {
    await writeAgentSseChatCompletion(res, body.model, runOpenClawAgent(body, registry, config));
    return;
  }

  const result = await runOpenClawAgent(body, registry, config);

  if (options.openai) {
    writeJson(res, 200, createAgentChatCompletion(result));
    return;
  }

  writeJson(res, 200, result);
}

export async function runOpenClawAgent(body, registry, config) {
  validateAgentRequest(body);

  const modelRef = body.model;
  const { provider, model } = registry.resolve(modelRef);
  const workspaceRoot = resolveWorkspaceRoot(body, config);
  const messages = buildAgentMessages(body, config.agent || {});
  const toolRuns = [];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const prompt = messagesToPrompt(messages);
    const text = await provider.chat({ model, prompt, messages });
    const toolCall = extractToolCall(text);

    if (!toolCall) {
      return {
        id: `ocagent_${randomUUID()}`,
        object: "openclaw.agent.run",
        created: Math.floor(Date.now() / 1000),
        model: modelRef,
        workspaceRoot,
        message: stripToolPayload(text),
        tools: toolRuns,
        stop_reason: "end_turn",
      };
    }

    const result = await executeTool(toolCall, workspaceRoot, config.agent || {});
    toolRuns.push({
      id: toolCall.id,
      name: toolCall.name,
      input: summarizeInput(toolCall.input),
      ok: result.ok,
      summary: result.summary,
    });

    messages.push({ role: "assistant", content: JSON.stringify({ tool_use: toolCall }) });
    messages.push({
      role: "user",
      content: [
        "Tool result:",
        JSON.stringify({
          id: toolCall.id,
          name: toolCall.name,
          ok: result.ok,
          result: result.data,
          error: result.error,
        }),
        "Continue. If the task is complete, provide the final answer without a tool_use JSON object.",
      ].join("\n"),
    });
  }

  return {
    id: `ocagent_${randomUUID()}`,
    object: "openclaw.agent.run",
    created: Math.floor(Date.now() / 1000),
    model: modelRef,
    workspaceRoot,
    message: `Agent stopped after ${MAX_AGENT_TURNS} tool turns. Please narrow the request.`,
    tools: toolRuns,
    stop_reason: "max_turns",
  };
}

function buildAgentMessages(body, agentConfig = {}) {
  const rawMessages = Array.isArray(body.messages)
    ? body.messages
    : [{ role: "user", content: body.input || body.prompt || "" }];

  return [
    { role: "system", content: buildAgentSystemPrompt(agentConfig) },
    ...rawMessages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: normalizeContent(message.content),
    })),
  ];
}

function buildAgentSystemPrompt(agentConfig = {}) {
  const pathPolicy = agentConfig.allowAnyPath
    ? "Path policy: absolute paths and paths outside workspace are allowed by configuration. Prefer workspace-relative paths for project files, and use absolute paths when the user asks for files elsewhere."
    : "Use workspace-relative paths. Never use absolute paths unless the user supplied one and it is inside the workspace.";

  return [
    "You are OpenClaw Lite Agent, a coding agent with local workspace tools.",
    "When the user asks to inspect, create, modify, optimize, refactor, or fix files, call tools and complete the work.",
    "Respond with exactly one JSON object when you need a tool. Do not wrap it in markdown.",
    "Tool call shape:",
    "{\"tool_use\":{\"name\":\"tool_name\",\"input\":{}}}",
    "Available tools:",
    "- workspace_info: {} returns the workspace root.",
    "- list_files: {\"path\":\".\",\"maxFiles\":300} lists files under a relative path.",
    "- read_file: {\"path\":\"relative/path\",\"maxBytes\":120000} reads a UTF-8 text file.",
    "- write_file: {\"path\":\"relative/path\",\"content\":\"full file content\"} creates or overwrites a UTF-8 text file.",
    "- replace_in_file: {\"path\":\"relative/path\",\"oldText\":\"exact text\",\"newText\":\"replacement text\"} replaces exact text.",
    "- search_files: {\"query\":\"text\",\"path\":\".\",\"maxMatches\":50,\"regex\":false} searches text files.",
    pathPolicy,
    "Before editing an existing file, read it first unless the user supplied the full current content.",
    "After tool results are returned, continue with more tool calls or provide a concise final answer.",
  ].join("\n");
}

async function executeTool(toolCall, workspaceRoot, agentConfig = {}) {
  const name = normalizeToolName(toolCall.name);
  const input = toolCall.input || {};

  try {
    if (name === "workspace_info") {
      return ok("Workspace info returned.", {
        root: workspaceRoot,
        allowAnyPath: Boolean(agentConfig.allowAnyPath),
      });
    }
    if (name === "list_files") {
      return await toolListFiles(workspaceRoot, input, agentConfig);
    }
    if (name === "read_file") {
      return await toolReadFile(workspaceRoot, input, agentConfig);
    }
    if (name === "write_file") {
      return await toolWriteFile(workspaceRoot, input, agentConfig);
    }
    if (name === "replace_in_file") {
      return await toolReplaceInFile(workspaceRoot, input, agentConfig);
    }
    if (name === "search_files") {
      return await toolSearchFiles(workspaceRoot, input, agentConfig);
    }
    return fail(`Unknown tool: ${toolCall.name}`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

async function toolListFiles(workspaceRoot, input, agentConfig) {
  const root = resolveToolPath(workspaceRoot, input.path || ".", agentConfig);
  const maxFiles = clampNumber(input.maxFiles, 1, 1000, 300);
  const files = [];
  await walkFiles(root, workspaceRoot, files, maxFiles, agentConfig);
  return ok(`Listed ${files.length} file(s).`, { files });
}

async function toolReadFile(workspaceRoot, input, agentConfig) {
  const filePath = resolveToolPath(workspaceRoot, input.path || input.file_path, agentConfig);
  const maxBytes = clampNumber(input.maxBytes, 1, 1000000, 120000);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("read_file.path must point to a file.");
  }
  const content = await fs.readFile(filePath, "utf8");
  return ok(`Read ${content.length} character(s).`, {
    path: formatToolPath(workspaceRoot, filePath, agentConfig),
    content: content.slice(0, maxBytes),
    truncated: content.length > maxBytes,
  });
}

async function toolWriteFile(workspaceRoot, input, agentConfig) {
  const relPath = input.path || input.file_path || input.filePath;
  const filePath = resolveToolPath(workspaceRoot, relPath, agentConfig);
  if (typeof input.content !== "string") {
    throw new Error("write_file.content must be a string.");
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, input.content, "utf8");
  return ok(`Wrote ${input.content.length} character(s).`, {
    path: formatToolPath(workspaceRoot, filePath, agentConfig),
    bytes: Buffer.byteLength(input.content, "utf8"),
  });
}

async function toolReplaceInFile(workspaceRoot, input, agentConfig) {
  const relPath = input.path || input.file_path || input.filePath;
  const filePath = resolveToolPath(workspaceRoot, relPath, agentConfig);
  if (typeof input.oldText !== "string" || typeof input.newText !== "string") {
    throw new Error("replace_in_file.oldText and newText must be strings.");
  }
  const content = await fs.readFile(filePath, "utf8");
  if (!content.includes(input.oldText)) {
    throw new Error("replace_in_file.oldText was not found.");
  }
  const next = content.replace(input.oldText, input.newText);
  await fs.writeFile(filePath, next, "utf8");
  return ok("Replaced text.", {
    path: formatToolPath(workspaceRoot, filePath, agentConfig),
    replacements: 1,
  });
}

async function toolSearchFiles(workspaceRoot, input, agentConfig) {
  const root = resolveToolPath(workspaceRoot, input.path || ".", agentConfig);
  const maxMatches = clampNumber(input.maxMatches, 1, 500, 50);
  const files = [];
  await walkFiles(root, workspaceRoot, files, 1000, agentConfig);

  const query = String(input.query || "");
  if (!query) {
    throw new Error("search_files.query must be non-empty.");
  }

  const regex = input.regex ? new RegExp(query, "i") : null;
  const matches = [];

  for (const relPath of files) {
    if (matches.length >= maxMatches) {
      break;
    }
    const filePath = resolveToolPath(workspaceRoot, relPath, agentConfig);
    const content = await readTextFileBestEffort(filePath);
    if (content == null) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < maxMatches; index++) {
      const line = lines[index];
      const found = regex ? regex.test(line) : line.toLowerCase().includes(query.toLowerCase());
      if (found) {
        matches.push({ path: relPath, line: index + 1, text: line.slice(0, 300) });
      }
    }
  }

  return ok(`Found ${matches.length} match(es).`, { matches });
}

async function walkFiles(root, workspaceRoot, out, maxFiles, agentConfig = {}) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= maxFiles || DEFAULT_EXCLUDES.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, workspaceRoot, out, maxFiles, agentConfig);
    } else if (entry.isFile()) {
      out.push(formatToolPath(workspaceRoot, fullPath, agentConfig));
    }
  }
}

async function readTextFileBestEffort(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 300000) {
      return null;
    }
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) {
      return null;
    }
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function extractToolCall(text) {
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const raw = parsed.tool_use || parsed.tool || parsed;
      const name = raw.name || raw.tool_name;
      if (!name) {
        continue;
      }
      return {
        id: raw.id || `toolu_${randomUUID()}`,
        name: normalizeToolName(name),
        input: normalizeToolInput(raw),
      };
    } catch {
      // Try the next JSON candidate.
    }
  }
  return null;
}

function extractJsonCandidates(text) {
  const source = String(text || "");
  const candidates = [];
  const fenced = /```(?:json|openclaw-tool)?\s*([\s\S]*?)```/gi;
  let match;

  while ((match = fenced.exec(source))) {
    if (match[1]?.trim().startsWith("{")) {
      candidates.push(match[1].trim());
    }
  }

  const trimmed = source.trim();
  if (trimmed.startsWith("{")) {
    candidates.push(trimmed);
  }

  for (let start = source.indexOf("{"); start !== -1; start = source.indexOf("{", start + 1)) {
    const objectText = readBalancedJsonObject(source, start);
    if (objectText) {
      candidates.push(objectText);
    }
  }

  return [...new Set(candidates)];
}

function readBalancedJsonObject(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return "";
}

function normalizeToolInput(raw) {
  if (raw.input && typeof raw.input === "object") {
    return raw.input;
  }
  if (raw.arguments && typeof raw.arguments === "object") {
    return raw.arguments;
  }
  if (typeof raw.arguments === "string") {
    try {
      return JSON.parse(raw.arguments);
    } catch {
      return {};
    }
  }

  const reserved = new Set(["id", "name", "tool_name", "type", "input", "arguments"]);
  const input = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (!reserved.has(key)) {
      input[key] = value;
    }
  }
  return input;
}

function normalizeToolName(name) {
  const value = String(name || "").trim();
  const lower = value.toLowerCase();
  const aliases = {
    write: "write_file",
    writefile: "write_file",
    edit: "replace_in_file",
    read: "read_file",
    grep: "search_files",
    glob: "list_files",
    ls: "list_files",
  };
  return aliases[lower] || lower;
}

function resolveWorkspaceRoot(body, config) {
  const configured = config.agent?.workspaceRoot || process.cwd();
  const requested = body.workspaceRoot && config.agent?.allowRequestWorkspaceRoot
    ? body.workspaceRoot
    : configured;
  return path.resolve(String(requested));
}

function resolveToolPath(workspaceRoot, inputPath, agentConfig = {}) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("Tool path must be a non-empty string.");
  }

  const normalizedInput = inputPath.replace(/^file:\/\//i, "");
  const target = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(workspaceRoot, normalizedInput);
  const root = path.resolve(workspaceRoot);

  if (agentConfig.allowAnyPath) {
    return target;
  }

  if (!isInside(root, target)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }
  return target;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) ? !relative.startsWith("..") && !path.isAbsolute(relative) : true;
}

function toWorkspaceRelative(workspaceRoot, filePath) {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
}

function formatToolPath(workspaceRoot, filePath, agentConfig = {}) {
  if (!agentConfig.allowAnyPath || isInside(path.resolve(workspaceRoot), path.resolve(filePath))) {
    return toWorkspaceRelative(workspaceRoot, filePath);
  }
  return path.resolve(filePath);
}

function stripToolPayload(text) {
  let value = String(text || "").trim();
  for (const candidate of extractJsonCandidates(value)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.tool_use || parsed.tool || parsed.name || parsed.tool_name) {
        value = value.replace(candidate, "").trim();
      }
    } catch {
      // Keep original text.
    }
  }
  return value;
}

function summarizeInput(input) {
  const copy = { ...(input || {}) };
  if (typeof copy.content === "string") {
    copy.content = `<${copy.content.length} chars>`;
  }
  if (typeof copy.newText === "string") {
    copy.newText = `<${copy.newText.length} chars>`;
  }
  if (typeof copy.oldText === "string") {
    copy.oldText = `<${copy.oldText.length} chars>`;
  }
  return copy;
}

function createAgentChatCompletion(result) {
  return {
    id: `chatcmpl_${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.message,
        },
        finish_reason: result.stop_reason === "max_turns" ? "length" : "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    openclaw_agent: {
      workspaceRoot: result.workspaceRoot,
      tools: result.tools,
    },
  };
}

async function writeAgentSseChatCompletion(res, model, resultPromise) {
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

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  try {
    const result = await resultPromise;
    for (const chunk of chunkText(result.message, 64)) {
      writeSse(res, {
        id,
        object: "chat.completion.chunk",
        created,
        model: result.model || model,
        choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
      });
    }
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created,
      model: result.model || model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: `Error: ${message}` }, finish_reason: null }],
    });
    writeSse(res, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
  } finally {
    clearInterval(heartbeat);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

function validateAgentRequest(body) {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  if (typeof body.model !== "string" || !body.model) {
    throw new Error("Request body requires string field 'model'");
  }
  const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
  if (!hasMessages && !body.input && !body.prompt) {
    throw new Error("Request body requires 'messages', 'input', or 'prompt'");
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

function ok(summary, data) {
  return { ok: true, summary, data };
}

function fail(error) {
  return { ok: false, summary: error, error };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(number)));
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
