#!/usr/bin/env node
/**
 * 可选的安全代理：把 API Key 留在服务端，浏览器只访问本代理。
 * 启动：AI_BASE_URL=... AI_API_KEY=... AI_MODEL=... node server/ai-proxy.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 读取项目根目录 .env（不依赖第三方库；已存在的环境变量优先）
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !(match[1] in process.env)) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch {
  // .env 可选
}

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const BASE_URL = (process.env.AI_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.AI_API_KEY ?? "";
const DEFAULT_MODEL = process.env.AI_MODEL ?? "deepseek-chat";
const ALLOW_ORIGIN = process.env.PROXY_ALLOW_ORIGIN ?? "*";

const MAX_BODY = 2 * 1024 * 1024;

function send(res, status, payload, extraHeaders = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    ...extraHeaders,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, {
      ok: true,
      baseUrl: BASE_URL,
      model: DEFAULT_MODEL,
      hasKey: Boolean(API_KEY),
    });
    return;
  }

  if (req.method !== "POST" || !req.url?.startsWith("/api/ai/chat")) {
    send(res, 404, { error: "not found" });
    return;
  }

  if (!API_KEY) {
    send(res, 500, { error: "代理未配置 AI_API_KEY，请在服务端环境变量中设置。" });
    return;
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (error) {
    send(res, 400, { error: error.message });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: payload.model || DEFAULT_MODEL,
        messages: payload.messages,
        temperature: payload.temperature ?? 0.4,
        max_tokens: payload.max_tokens ?? 2200,
        stream: false,
      }),
      signal: controller.signal,
    });

    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    });
    res.end(text);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    send(res, timedOut ? 504 : 502, {
      error: timedOut ? "上游模型超时" : `上游请求失败：${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    clearTimeout(timer);
  }
});

server.listen(PORT, () => {
  console.log(`AI 代理已启动：http://localhost:${PORT}/api/ai/chat`);
  console.log(`上游：${BASE_URL} · 模型：${DEFAULT_MODEL} · Key：${API_KEY ? "已配置" : "未配置"}`);
  if (!API_KEY) console.log("请设置 AI_API_KEY 环境变量后重启。");
});
