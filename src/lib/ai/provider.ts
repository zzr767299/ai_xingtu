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
  /** 覆盖设置里的最大输出 tokens（推理模型的思考 token 也计入该额度） */
  maxTokens?: number;
}

export function aiEndpoint(settings: AiSettings): string {
  if (settings.useProxy && settings.proxyUrl) return settings.proxyUrl;
  return `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export function isAiConfigured(settings: AiSettings): boolean {
  if (!settings.enabled) return false;
  // 代理模式只依赖代理地址；Base URL / 模型 / Key 由代理服务端 .env 提供
  if (settings.useProxy) return Boolean(settings.proxyUrl.trim());
  return Boolean(
    settings.baseUrl.trim() && settings.apiKey.trim() && settings.model.trim(),
  );
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
  const baseMaxTokens = Math.max(256, options.maxTokens ?? settings.maxTokens ?? 2200);
  let lastError: unknown;

  const postOnce = async (maxTokens: number) => {
    if (options.signal?.aborted) throw new AiError("aborted", "请求已取消");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);

    try {
      const body: Record<string, unknown> = {
        // 代理模式下不发送 model，始终使用服务端 .env 的 AI_MODEL，避免前端残留值覆盖
        ...(settings.useProxy ? {} : { model: settings.model }),
        messages,
        temperature: settings.temperature,
        max_tokens: maxTokens,
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
        choices?: {
          message?: { content?: string | null; reasoning_content?: string | null };
          finish_reason?: string;
        }[];
        usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
        error?: { message?: string };
      };

      const choice = data.choices?.[0];
      return {
        content: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? "",
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        errorMessage: data.error?.message,
      };
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (options.signal?.aborted) throw new AiError("aborted", "请求已取消");
        throw new AiError("timeout", `模型请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw new AiError("aborted", "请求已取消");

    try {
      let maxTokens = baseMaxTokens;
      let result = await postOnce(maxTokens);

      // 推理模型的思考 token 会计入 max_tokens，出卷这类长输出很容易被截断；
      // 第一次截断时自动抬高额度重试一次，避免用户只能看到“内容为空”。
      if (result.finishReason === "length" && maxTokens < 16000) {
        maxTokens = Math.min(16000, Math.max(8000, maxTokens * 2));
        result = await postOnce(maxTokens);
      }

      if (result.finishReason === "length") {
        throw new AiError(
          "invalid-response",
          describeTruncation(maxTokens, result.reasoningTokens),
          { retryable: false },
        );
      }

      if (!result.content.trim()) {
        throw new AiError(
          "invalid-response",
          result.errorMessage
            ? `模型返回错误：${result.errorMessage}`
            : "模型返回内容为空，请检查模型名称与接口兼容性。",
          { retryable: true },
        );
      }
      return result.content;
    } catch (error) {
      lastError = error;
      if (error instanceof AiError) {
        if (error.code === "aborted") throw error;
        if (!error.retryable || attempt === retries) throw error;
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
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AiError("network", "模型请求失败，原因未知");
}

function describeTruncation(maxTokens: number, reasoningTokens: number): string {
  const reasoning = reasoningTokens > 0 ? `，其中推理思考占 ${reasoningTokens}` : "";
  return `模型输出在 ${maxTokens} tokens 处被截断${reasoning}。请把「设置 → 最大输出 tokens」调到 8000 以上（推理模型会先消耗思考 token），或改用非推理模型后重新出卷。`;
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
