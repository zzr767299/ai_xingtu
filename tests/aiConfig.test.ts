import { describe, expect, it } from "vitest";
import { aiEndpoint, isAiConfigured, requestChat } from "../src/lib/ai/provider";
import type { AiSettings } from "../src/types";

const proxyConfig: AiSettings = {
  enabled: true,
  preset: "custom",
  baseUrl: "",
  apiKey: "",
  model: "",
  useProxy: true,
  proxyUrl: "http://localhost:8787/api/ai/chat",
  temperature: 0.4,
  maxTokens: 128,
  timeoutMs: 5000,
};

describe("AI 配置校验", () => {
  it("代理模式只要求代理地址，Base URL / 模型 / Key 可以留空", () => {
    expect(isAiConfigured(proxyConfig)).toBe(true);
    expect(isAiConfigured({ ...proxyConfig, proxyUrl: "" })).toBe(false);
    expect(isAiConfigured({ ...proxyConfig, enabled: false })).toBe(false);
    expect(aiEndpoint(proxyConfig)).toBe("http://localhost:8787/api/ai/chat");
  });

  it("直连模式必须同时有 Base URL、模型与 Key", () => {
    const direct: AiSettings = {
      ...proxyConfig,
      useProxy: false,
      baseUrl: "https://api.example.com/v1",
      model: "demo-model",
      apiKey: "sk-test",
    };
    expect(isAiConfigured(direct)).toBe(true);
    expect(isAiConfigured({ ...direct, model: "" })).toBe(false);
    expect(isAiConfigured({ ...direct, apiKey: "" })).toBe(false);
    expect(isAiConfigured({ ...direct, baseUrl: "" })).toBe(false);
  });

  it("代理模式下模型留空时不发送 model，由代理读取 .env", async () => {
    const captured: { value?: { url: string; body: Record<string, unknown>; headers: Record<string, string> } } = {};
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured.value = {
        url,
        body: JSON.parse(String(init.body)),
        headers: init.headers as Record<string, string>,
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: "连通" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const reply = await requestChat(
      proxyConfig,
      [{ role: "user", content: "ping" }],
      { fetchImpl, retries: 0 },
    );
    expect(reply).toBe("连通");
    expect(captured.value?.url).toBe("http://localhost:8787/api/ai/chat");
    expect(captured.value?.body.model).toBeUndefined();
    expect(captured.value?.body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(captured.value?.headers.Authorization).toBeUndefined();
  });

  it("代理模式下即使表单填了模型也不发送，.env 始终生效", async () => {
    let model: unknown = "unset";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      model = JSON.parse(String(init.body)).model;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await requestChat({ ...proxyConfig, model: "override-model" }, [{ role: "user", content: "ping" }], {
      fetchImpl,
      retries: 0,
    });
    expect(model).toBeUndefined();
  });

  it("直连未配置时给出可读错误", async () => {
    await expect(
      requestChat({ ...proxyConfig, useProxy: false }, [{ role: "user", content: "ping" }]),
    ).rejects.toThrow("AI 服务尚未配置");
  });

  it("输出被截断时自动提高 max_tokens 重试一次", async () => {
    const budgets: number[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { max_tokens: number };
      budgets.push(body.max_tokens);
      if (budgets.length === 1) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "{\"questions\":[" }, finish_reason: "length" }],
            usage: { completion_tokens_details: { reasoning_tokens: 1900 } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{\"questions\":[]}" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const reply = await requestChat(proxyConfig, [{ role: "user", content: "出卷" }], {
      fetchImpl,
      retries: 0,
    });
    expect(reply).toBe("{\"questions\":[]}");
    expect(budgets).toEqual([256, 8000]);
  });

  it("提高额度后仍被截断时提示调整最大输出 tokens", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "" }, finish_reason: "length" }],
          usage: { completion_tokens_details: { reasoning_tokens: 2200 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    await expect(
      requestChat(proxyConfig, [{ role: "user", content: "出卷" }], { fetchImpl, retries: 0 }),
    ).rejects.toThrow(/被截断.*推理思考占 2200/);
  });
});
