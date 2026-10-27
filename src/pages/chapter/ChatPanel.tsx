import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ChapterContent, ChapterMeta, ChatMessage } from "../../types";
import { useApp } from "../../state/AppContext";
import { Badge, Button, cn } from "../../components/ui";
import { MarkdownText } from "../../components/Markdown";
import { AiError } from "../../lib/ai/provider";
import { quickActionPrompt } from "../../lib/ai/prompts";

const QUICK_ACTIONS = [
  { id: "simplify", label: "换个更容易的说法" },
  { id: "example", label: "举一个实际案例" },
  { id: "compare", label: "对比易混概念" },
  { id: "code", label: "解释相关代码" },
  { id: "usage", label: "开发者怎么用" },
  { id: "quiz", label: "出一道小题考我" },
];

export function ChatPanel({
  chapter,
  content,
  sectionTitle,
  onClose,
}: {
  chapter: ChapterMeta;
  content: ChapterContent;
  sectionTitle?: string;
  onClose: () => void;
}) {
  const { ai, glossary, repo, settings, notify } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const available = ai.isAvailable();

  useEffect(() => {
    let cancelled = false;
    void repo.getChat(chapter.id).then((history) => {
      if (!cancelled) setMessages(history);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [chapter.id, repo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!available) {
      setError("AI 服务尚未配置。请先在设置中配置模型服务，或继续使用本地讲解内容。");
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: trimmed,
      at: Date.now(),
      contextSectionId: sectionTitle,
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setError(null);
    setSending(true);
    await repo.saveChat(chapter.id, history);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await ai.chat(
        chapter,
        content,
        glossary,
        history.map((message) => ({ role: message.role, content: message.content })),
        sectionTitle,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const assistant: ChatMessage = { role: "assistant", content: reply, at: Date.now(), contextSectionId: sectionTitle };
      const next = [...history, assistant];
      setMessages(next);
      await repo.saveChat(chapter.id, next);
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message =
        caught instanceof AiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : String(caught);
      setError(message);
      notify("AI 回复失败，可重试", "error");
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setSending(false);
    await repo.saveChat(chapter.id, []);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-scrim/55 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-[440px] flex-col border-l border-line bg-panel-solid shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="AI 讲解助手"
      >
        <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-cyan">✦</span>
              <span className="text-sm font-semibold text-ink">AI 讲解助手</span>
              <Badge tone={available ? "cyan" : "neutral"}>
                {available ? settings.ai.model : "未配置"}
              </Badge>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              上下文：{sectionTitle ?? chapter.sections[0]?.title ?? chapter.title}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void clear()} disabled={messages.length === 0}>
              清空
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-muted hover:bg-white/5 hover:text-ink"
              aria-label="关闭助手"
            >
              ✕
            </button>
          </div>
        </div>

        {!available && (
          <div className="border-b border-line/60 bg-panel2/60 px-4 py-2.5 text-[11px] leading-relaxed text-muted">
            当前使用本地讲解内容。配置模型后，助手会基于本章原文回答，并标注【AI 补充】。
            <Link to="/settings" className="ml-1 text-cyan hover:underline">
              去配置 →
            </Link>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="rounded-xl border border-line/60 bg-panel2/40 p-3 text-[12px] leading-relaxed text-muted">
              我会基于「{chapter.title}」的原文回答。可以先点下面的快捷提问，或直接输入你的问题。
              原文没有覆盖的内容会标注为【AI 补充】。
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.at}-${index}`}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                  message.role === "user"
                    ? "bg-cyan/15 text-ink"
                    : "border border-line/70 bg-panel2/60 text-prose",
                )}
              >
                {message.role === "assistant" ? (
                  <MarkdownText text={message.content} className="text-[13px] leading-relaxed" />
                ) : (
                  <span className="whitespace-pre-wrap">{message.content}</span>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan [animation-delay:300ms]" />
              </span>
              正在结合本章原文思考…
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] leading-relaxed text-danger">
              {error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-line/70 p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={sending}
                onClick={() =>
                  void send(quickActionPrompt(action.id, sectionTitle ?? chapter.sections[0]?.title ?? chapter.title))
                }
                className="rounded-full border border-line/70 bg-panel2/60 px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-cyan/40 hover:text-cyan disabled:opacity-40"
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              placeholder={available ? "追问本章知识点，Enter 发送…" : "AI 未配置，暂不能对话"}
              disabled={!available || sending}
              className="min-h-[46px] flex-1 resize-none rounded-xl border border-line bg-panel2/60 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-dim focus:border-cyan/50 disabled:opacity-60"
            />
            <Button size="sm" onClick={() => void send(input)} disabled={!available || sending || !input.trim()}>
              发送
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
