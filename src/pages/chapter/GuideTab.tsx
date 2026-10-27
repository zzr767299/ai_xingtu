import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChapterContent, ChapterMeta } from "../../types";
import { useApp } from "../../state/AppContext";
import { Badge, Button, Card, LinkButton, cn } from "../../components/ui";
import { buildLocalGuide, type ChapterGuide } from "../../lib/domain/localContent";
import { AiError } from "../../lib/ai/provider";
import { formatDate } from "../../lib/utils/format";

type Status = "local" | "loading" | "ai" | "error";

export function GuideTab({
  chapter,
  content,
  previousChapterTitle,
}: {
  chapter: ChapterMeta;
  content: ChapterContent;
  previousChapterTitle?: string;
}) {
  const { ai, glossary, progress, updateChapterProgress } = useApp();
  const localGuide = useMemo(
    () => buildLocalGuide(chapter, previousChapterTitle),
    [chapter, previousChapterTitle],
  );
  const [guide, setGuide] = useState<ChapterGuide>(localGuide);
  const [status, setStatus] = useState<Status>(ai.isAvailable() ? "loading" : "local");
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [model, setModel] = useState<string>("");
  const requested = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chapterProgress = progress.chapterProgress[chapter.id];
  const acknowledged = Boolean(chapterProgress?.guideAck);

  const generate = useCallback(
    async (force: boolean) => {
      if (!ai.isAvailable()) {
        setStatus("local");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      try {
        const result = await ai.guide(chapter, content, glossary, {
          force,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setGuide(result.data);
        setCached(result.cached);
        setModel(result.model);
        setStatus("ai");
      } catch (caught) {
        if (controller.signal.aborted) return;
        const message =
          caught instanceof AiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : String(caught);
        setError(message);
        setStatus("error");
      }
    },
    [ai, chapter, content, glossary],
  );

  useEffect(() => {
    if (!ai.isAvailable()) {
      setStatus("local");
      return;
    }
    if (requested.current === chapter.id) return;
    requested.current = chapter.id;
    void generate(false);
    return () => abortRef.current?.abort();
  }, [chapter.id, ai, generate]);

  const confirm = () => {
    updateChapterProgress(chapter.id, (current) => ({ ...current, guideAck: true }));
  };

  const display = status === "error" ? localGuide : guide;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 bg-panel2/40 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {status === "loading" ? (
              <Badge tone="cyan">
                <span className="pulse-dot">●</span> AI 生成中…
              </Badge>
            ) : status === "ai" ? (
              <Badge tone="cyan">AI 生成 · {model}</Badge>
            ) : status === "error" ? (
              <Badge tone="danger">AI 生成失败 · 已回退本地导读</Badge>
            ) : (
              <Badge tone="neutral">本地生成 · 未配置模型</Badge>
            )}
            {cached && <Badge tone="neutral">来自缓存</Badge>}
            <span className="text-[11px] text-dim">
              {display.source === "ai" ? `生成于 ${formatDate(display.generatedAt)}` : display.note}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {ai.isAvailable() && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void generate(true)}
                disabled={status === "loading"}
              >
                {status === "loading" ? "生成中…" : "重新生成"}
              </Button>
            )}
            <a
              href={chapter.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-2 py-1 text-[11px] text-muted hover:text-cyan"
            >
              原文 ↗
            </a>
          </div>
        </div>

        {status === "error" && error && (
          <div className="border-b border-danger/30 bg-danger/10 px-4 py-2.5 text-[12px] leading-relaxed text-danger">
            <div className="font-medium">AI 导读生成失败</div>
            <p className="mt-0.5">{error}</p>
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void generate(true)}>
                重试
              </Button>
              <a href="#/settings" className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted hover:text-cyan">
                检查 AI 设置
              </a>
            </div>
          </div>
        )}

        <div className="p-5">
          <p className="text-[11px] uppercase tracking-[0.25em] text-dim">CHAPTER BRIEFING</p>
          <h2 className="mt-1.5 text-lg font-semibold text-ink">本章学什么，为什么值得学</h2>
          <p className="mt-2 text-[14px] leading-[1.9] text-prose">{display.value}</p>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <SectionLabel index="01" title="学习目标" hint="完成后你应该能做到" />
          <ol className="mt-3 space-y-2.5">
            {display.goals.map((goal, index) => (
              <li key={`${goal}-${index}`} className="flex gap-2.5 text-[13px] leading-relaxed text-prose">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-cyan/40 bg-cyan/10 font-mono text-[10px] text-cyan">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{goal}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-4">
          <SectionLabel index="02" title="核心概念" hint="读完后应能解释" />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {display.concepts.map((concept) => (
              <span
                key={concept}
                className="rounded-md border border-line bg-panel2/60 px-2 py-1 text-[12px] text-prose"
              >
                {concept}
              </span>
            ))}
          </div>

          <div className="mt-5">
            <SectionLabel index="03" title="前置知识" hint="不满足也可以学，但会更吃力" />
            <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-muted">
              {display.prerequisites.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-dim">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <Card className="p-4">
          <SectionLabel index="04" title="推荐学习顺序" hint="点击可跳到对应知识点" />
          <ol className="mt-3 space-y-1.5">
            {display.order.map((title, index) => {
              const section = chapter.sections.find((item) => item.title === title);
              return (
                <li key={`${title}-${index}`} className="flex items-center gap-2.5">
                  <span className="font-mono text-[10px] text-dim">{String(index + 1).padStart(2, "0")}</span>
                  <LinkButton
                    to={`/learn/${chapter.id}?tab=learn${section ? `&s=${section.id}` : ""}`}
                    variant="ghost"
                    size="sm"
                    className="justify-start px-1.5"
                  >
                    {title}
                  </LinkButton>
                  {index < display.order.length - 1 && <span className="text-[10px] text-dim">↓</span>}
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <SectionLabel index="05" title="时间与考试" />
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-line/60 bg-panel2/50 px-2 py-2.5">
                <div className="text-[10px] text-dim">预计学习</div>
                <div className="text-lg font-semibold text-ink">{display.minutes}</div>
                <div className="text-[10px] text-dim">分钟</div>
              </div>
              <div className="rounded-lg border border-line/60 bg-panel2/50 px-2 py-2.5">
                <div className="text-[10px] text-dim">考试满分</div>
                <div className="text-lg font-semibold text-ink">80</div>
                <div className="text-[10px] text-dim">+ 学习 20 分</div>
              </div>
            </div>
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted">{display.examPlan}</p>
            <p className="mt-1.5 text-[11px] text-dim">总分 60 分通关，通关后解锁下一颗星。</p>
          </Card>

          <Card className={cn("p-4", acknowledged && "border-ok/30")}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">导读确认</span>
              <Badge tone={acknowledged ? "ok" : "neutral"}>{acknowledged ? "已完成 +2" : "待确认"}</Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              确认你已了解本章目标与考试方式。该操作计入学习分 2 分，不涉及掌握程度评分。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={confirm} disabled={acknowledged}>
                {acknowledged ? "已确认目标" : "我已了解，开始学习"}
              </Button>
              <LinkButton to={`/learn/${chapter.id}?tab=learn`} variant="secondary" size="sm">
                进入讲解
              </LinkButton>
            </div>
          </Card>
        </div>
      </div>

      <Card className="p-4 text-[11px] leading-relaxed text-dim">
        导读内容：{guide.source === "ai" ? "由 AI 依据原文生成" : "由本地规则从课程目标与章节结构生成"}。
        原文与版权：{chapter.sourcePath} · {chapter.sourceUrl}
      </Card>
    </div>
  );
}

function SectionLabel({ index, title, hint }: { index: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[10px] text-cyan/70">{index}</span>
      <span className="text-sm font-semibold text-ink">{title}</span>
      {hint && <span className="text-[10px] text-dim">{hint}</span>}
    </div>
  );
}
