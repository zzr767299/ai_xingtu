import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ChapterContent, ChapterMeta, ChatMessage, ChatSession } from "../../types";
import { useApp } from "../../state/AppContext";
import { Badge, Button, cn } from "../../components/ui";
import { MarkdownText } from "../../components/Markdown";
import { AiError } from "../../lib/ai/provider";
import { quickActionPrompt } from "../../lib/ai/prompts";
import { formatRelative } from "../../lib/utils/format";
import { sessionTitle } from "../../lib/storage/repo";

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
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const available = ai.isAvailable();

  const activeSession = sessions.find((session) => session.id === activeId);
  const messages = activeSession?.messages ?? [];
  const sending = sendingId !== null;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 载入本章历史对话，切换章节时重置。
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setSessions([]);
    sessionsRef.current = [];
    setActiveId(null);
    activeIdRef.current = null;
    setError(null);
    setInput("");
    setHistoryOpen(false);
    void repo.getChatSessions(chapter.id).then((list) => {
      if (cancelled) return;
      sessionsRef.current = list;
      setSessions(list);
      setActiveId(list[0]?.id ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [chapter.id, repo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sendingId, activeId]);

  // Esc：历史抽屉 > 全屏 > 关闭面板。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (historyOpen) setHistoryOpen(false);
      else if (fullscreen) setFullscreen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyOpen, fullscreen, onClose]);

  const persist = (next: ChatSession[]) => {
    sessionsRef.current = next;
    setSessions(next);
    void repo.saveChatSessions(chapter.id, next);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!available) {
      setError("AI 服务尚未配置。请先在设置中配置模型服务，或继续使用本地讲解内容。");
      return;
    }

    const now = Date.now();
    let session = sessionsRef.current.find((item) => item.id === activeIdRef.current);
    let next = sessionsRef.current;
    if (!session) {
      session = {
        id: `chat_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        chapterId: chapter.id,
        title: sessionTitle(trimmed),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      next = [session, ...next];
      activeIdRef.current = session.id;
      setActiveId(session.id);
    }
    const sessionId = session.id;
    const userMessage: ChatMessage = {
      role: "user",
      content: trimmed,
      at: now,
      contextSectionId: sectionTitle,
    };
    const history = [...session.messages, userMessage];
    persist(
      next.map((item) =>
        item.id === sessionId ? { ...item, messages: history, updatedAt: now } : item,
      ),
    );
    setInput("");
    setError(null);
    setSendingId(sessionId);

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
      const target = sessionsRef.current.find((item) => item.id === sessionId);
      if (!target) return;
      persist(
        sessionsRef.current.map((item) =>
          item.id === sessionId
            ? { ...item, messages: [...item.messages, assistant], updatedAt: Date.now() }
            : item,
        ),
      );
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
      setSendingId((current) => (current === sessionId ? null : current));
    }
  };

  const clear = () => {
    const id = activeIdRef.current;
    if (!id) return;
    if (sendingId === id) {
      abortRef.current?.abort();
      setSendingId(null);
    }
    setError(null);
    const next = sessionsRef.current.filter((session) => session.id !== id);
    persist(next);
    setActiveId(next[0]?.id ?? null);
  };

  const startNew = () => {
    setError(null);
    setInput("");
    setActiveId(null);
    setHistoryOpen(false);
  };

  const pickSession = (id: string) => {
    setActiveId(id);
    setError(null);
    setHistoryOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-scrim/55 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        className={cn(
          "relative flex h-full w-full flex-col border-l border-line bg-panel-solid shadow-2xl",
          fullscreen ? "max-w-none" : "max-w-[440px]",
        )}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="AI 讲解助手"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
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
          <div className="flex shrink-0 items-center gap-1">
            {!fullscreen && (
              <button
                type="button"
                onClick={() => setHistoryOpen((current) => !current)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-line/60 bg-panel2/50 text-muted transition-colors hover:border-cyan/40 hover:text-cyan"
                aria-label="历史对话"
                aria-pressed={historyOpen}
                title="历史对话"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                  <path d="M12 8v4l3 2" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => setFullscreen((current) => !current)}
              className="hidden h-7 w-7 items-center justify-center rounded-md border border-line/60 bg-panel2/50 text-muted transition-colors hover:border-cyan/40 hover:text-cyan sm:flex"
              aria-label={fullscreen ? "退出全屏" : "全屏显示"}
              aria-pressed={fullscreen}
              title={fullscreen ? "退出全屏（Esc）" : "全屏显示"}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {fullscreen ? (
                  <>
                    <path d="M4 14h6v6" />
                    <path d="M20 10h-6V4" />
                    <path d="M14 10l7-7" />
                    <path d="M3 21l7-7" />
                  </>
                ) : (
                  <>
                    <path d="M15 3h6v6" />
                    <path d="M9 21H3v-6" />
                    <path d="M21 3l-7 7" />
                    <path d="M3 21l7-7" />
                  </>
                )}
              </svg>
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clear}
              disabled={messages.length === 0}
              title="清空并删除当前对话"
            >
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

        <div className="relative flex min-h-0 flex-1">
          {fullscreen ? (
            <ChatHistory
              className="w-[248px] shrink-0 border-r border-line/70 bg-panel2/25"
              sessions={sessions}
              activeId={activeId}
              onNew={startNew}
              onPick={pickSession}
            />
          ) : historyOpen ? (
            <>
              <div
                className="absolute inset-0 z-10 bg-scrim/45"
                onClick={() => setHistoryOpen(false)}
                aria-hidden="true"
              />
              <ChatHistory
                className="absolute inset-y-0 left-0 z-20 w-[280px] border-r border-line bg-panel-solid shadow-2xl"
                sessions={sessions}
                activeId={activeId}
                onNew={startNew}
                onPick={pickSession}
              />
            </>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className={cn("space-y-3", fullscreen && "mx-auto w-full max-w-4xl")}>
                {!loaded && <p className="text-[12px] text-dim">正在载入历史对话…</p>}
                {loaded && messages.length === 0 && (
                  <div className="rounded-xl border border-line/60 bg-panel2/40 p-3 text-[12px] leading-relaxed text-muted">
                    我会基于「{chapter.title}」的原文回答。可以先点下面的快捷提问，或直接输入你的问题。
                    原文没有覆盖的内容会标注为【AI 补充】。对话会自动保存在左侧「历史对话」里。
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
                {sendingId !== null && sendingId === activeId && (
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
            </div>

            <div className="border-t border-line/70 p-3">
              <div className={cn(fullscreen && "mx-auto w-full max-w-4xl")}>
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
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ChatHistory({
  sessions,
  activeId,
  onNew,
  onPick,
  className,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onNew: () => void;
  onPick: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="border-b border-line/60 p-2.5">
        <Button size="sm" variant="secondary" className="w-full" onClick={onNew}>
          ＋ 新建对话
        </Button>
      </div>
      <div className="flex items-center justify-between px-3 pb-1 pt-3 text-[10px] uppercase tracking-[0.18em] text-dim">
        <span>历史对话（本章）</span>
        <span className="tabular-nums">{sessions.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {activeId === null && sessions.length > 0 && (
          <div className="rounded-lg border border-cyan/40 bg-cyan/10 px-2.5 py-2">
            <span className="text-[12px] text-cyan">新对话</span>
            <span className="mt-0.5 block text-[10px] text-dim">提问后自动保存</span>
          </div>
        )}
        {sessions.length === 0 && (
          <p className="px-1.5 py-3 text-[11px] leading-relaxed text-dim">
            还没有历史对话。提问后会自动保存在这里，下次打开可继续查看。
          </p>
        )}
        {sessions.map((session) => {
          const active = session.id === activeId;
          return (
            <button
              key={session.id}
              type="button"
              onClick={() => onPick(session.id)}
              aria-current={active ? "true" : undefined}
              title={session.title}
              className={cn(
                "block w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                active ? "border-cyan/40 bg-cyan/10" : "border-transparent hover:bg-white/[0.04]",
              )}
            >
              <span className={cn("line-clamp-2 text-[12px] leading-snug", active ? "text-cyan" : "text-ink")}>
                {session.title}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-dim">
                <span>{formatRelative(session.updatedAt)}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{session.messages.length} 条</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
