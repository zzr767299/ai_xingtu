import type { AiSettings } from "../../types";

export class AiError extends Error {
  code: "not-configured" | "timeout" | "network" | "http" | "invalid-response" | "aborted";
  status?: number;
  retryable: boolean;

  constructor(
    code: AiError["code"],
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  retries?: number;
}

export function aiEndpoint(settings: AiSettings): string {
  if (settings.useProxy && settings.proxyUrl) return settings.proxyUrl;
  return `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function isAiConfigured(settings: AiSettings): boolean {
  if (!settings.enabled) return false;
  if (!settings.model.trim()) return false;
  if (settings.useProxy) return Boolean(settings.proxyUrl.trim());
  return Boolean(settings.baseUrl.trim() && settings.apiKey.trim());
}

export async function requestChat(
  settings: AiSettings,
  messages: ChatMessageInput[],
  options: ChatOptions = {},
): Promise<string> {
  if (!isAiConfigured(settings)) {
    throw new AiError(
      "not-configured",
      "AI 服务尚未配置：请在「设置」中填写模型服务地址、模型名和 API Key，或启用本地代理。",
    );
  }

  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? settings.timeoutMs ?? 60000;
  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw new AiError("aborted", "请求已取消");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);

    try {
      const body: Record<string, unknown> = {
        model: settings.model,
        messages,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: false,
      };

      const response = await fetcher(aiEndpoint(settings), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.useProxy || !settings.apiKey
            ? {}
            : { Authorization: `Bearer ${settings.apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable = response.status === 429 || response.status >= 500;
        throw new AiError("http", describeHttpError(response.status, text), {
          status: response.status,
          retryable,
        });
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
        error?: { message?: string };
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new AiError(
          "invalid-response",
          data.error?.message
            ? `模型返回错误：${data.error.message}`
            : "模型返回内容为空，请检查模型名称与接口兼容性。",
          { retryable: true },
        );
      }
      return content;
    } catch (error) {
      lastError = error;
      if (error instanceof AiError) {
        if (error.code === "aborted") throw error;
        if (!error.retryable || attempt === retries) throw error;
      } else if (error instanceof DOMException && error.name === "AbortError") {
        if (options.signal?.aborted) throw new AiError("aborted", "请求已取消");
        throw new AiError("timeout", `模型请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === retries) {
          throw new AiError(
          "network",
          `网络请求失败：${message}。请检查服务地址与网络；若 curl 能访问但浏览器失败，通常是服务端未开放 CORS（OPTIONS 预检 405 或缺少 Access-Control-Allow-Origin），可改用代理。`,
        );
        }
      }
      await delay(700 * (attempt + 1));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AiError("network", "模型请求失败，原因未知");
}

function describeHttpError(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").slice(0, 300);
  if (status === 401 || status === 403) {
    return `鉴权失败（HTTP ${status}）：API Key 无效或没有权限。${snippet ? ` 服务返回：${snippet}` : ""}`;
  }
  if (status === 404) {
    return `接口地址不存在（HTTP 404）：请检查 Base URL 是否包含正确的版本路径。${snippet ? ` 服务返回：${snippet}` : ""}`;
  }
  if (status === 429) {
    return `请求过于频繁或额度不足（HTTP 429）。${snippet ? ` 服务返回：${snippet}` : ""}`;
  }
  return `模型服务返回错误（HTTP ${status}）。${snippet ? ` 服务返回：${snippet}` : ""}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function testConnection(
  settings: AiSettings,
  options: ChatOptions = {},
): Promise<{ ok: true; reply: string; latencyMs: number }> {
  const started = performance.now();
  const reply = await requestChat(
    settings,
    [
      { role: "system", content: "你是一个连通性测试助手。" },
      { role: "user", content: "只回复两个字：连通" },
    ],
    { ...options, retries: 0, timeoutMs: options.timeoutMs ?? 20000 },
  );
  return { ok: true, reply: reply.trim().slice(0, 60), latencyMs: Math.round(performance.now() - started) };
}
