import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChapterContent, ChapterMeta, ChapterSection } from "../../types";
import { useApp } from "../../state/AppContext";
import { Badge, Button, Card, ProgressBar, cn } from "../../components/ui";
import { Link } from "react-router-dom";
import { CourseBlocks, MarkdownText } from "../../components/Markdown";
import { buildStudyCheck, type StudyCheck } from "../../lib/domain/localContent";
import { AiError } from "../../lib/ai/provider";
import { ChatPanel } from "./ChatPanel";

export function LearnTab({ chapter, content }: { chapter: ChapterMeta; content: ChapterContent }) {
  const { glossary, progress, updateChapterProgress, setLastLocation } = useApp();
  const chapterProgress = progress.chapterProgress[chapter.id];
  const readSet = useMemo(() => new Set(chapterProgress?.sectionsRead ?? []), [chapterProgress?.sectionsRead]);
  const [activeSectionId, setActiveSectionId] = useState(content.sections[0]?.id ?? "");
  const [activeSubId, setActiveSubId] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [notes, setNotes] = useState(chapterProgress?.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(true);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const navRef = useRef<HTMLElement | null>(null);

  const checks = useMemo(() => {
    const map: Record<string, StudyCheck> = {};
    for (const section of content.sections) {
      map[section.id] = buildStudyCheck(chapter, section, glossary, content.sections);
    }
    return map;
  }, [chapter, content.sections, glossary]);

  useEffect(() => {
    setNotes(chapterProgress?.notes ?? "");
    setNotesSaved(true);
  }, [chapter.id]);

  // 目录高亮：以视口上方 128px 为基准线，取最后一个越线的节/小节。
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = 128;
      let currentSection = content.sections[0]?.id ?? "";
      for (const section of content.sections) {
        const element = sectionRefs.current[section.id];
        if (element && element.getBoundingClientRect().top <= line) currentSection = section.id;
      }
      setActiveSectionId(currentSection);

      let currentSub = "";
      const activeContent = content.sections.find((section) => section.id === currentSection);
      for (const heading of activeContent?.subheadings ?? []) {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= line) currentSub = heading.id;
      }
      setActiveSubId(currentSub);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [content]);

  // 目录内部滚动：让当前小节保持在目录可视范围内（只调整目录自身，不拖动页面）。
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || nav.offsetParent === null) return;
    const item =
      nav.querySelector<HTMLElement>(`[data-nav-sub="${activeSubId}"]`) ??
      nav.querySelector<HTMLElement>(`[data-nav-section="${activeSectionId}"]`);
    if (!item) return;
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const padding = 14;
    if (itemRect.top < navRect.top + padding) {
      nav.scrollTop -= navRect.top + padding - itemRect.top;
    } else if (itemRect.bottom > navRect.bottom - padding) {
      nav.scrollTop += itemRect.bottom - (navRect.bottom - padding);
    }
  }, [activeSectionId, activeSubId]);

  useEffect(() => {
    if (!activeSectionId) return;
    const timer = setTimeout(() => {
      updateChapterProgress(chapter.id, (current) =>
        current.lastSectionId === activeSectionId ? current : { ...current, lastSectionId: activeSectionId },
      );
      setLastLocation({
        chapterId: chapter.id,
        sectionId: activeSectionId,
        tab: "learn",
        updatedAt: Date.now(),
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [activeSectionId, chapter.id, setLastLocation, updateChapterProgress]);

  const toggleRead = (sectionId: string) => {
    updateChapterProgress(chapter.id, (current) => ({
      ...current,
      lastSectionId: sectionId,
      sectionsRead: current.sectionsRead.includes(sectionId)
        ? current.sectionsRead.filter((id) => id !== sectionId)
        : [...current.sectionsRead, sectionId],
    }));
  };

  const answerCheck = (sectionId: string, key: string) => {
    const check = checks[sectionId];
    if (!check) return;
    updateChapterProgress(chapter.id, (current) => ({
      ...current,
      checks: {
        ...current.checks,
        [sectionId]: {
          answered: true,
          correct: key === check.answer,
          answer: key,
          at: Date.now(),
        },
      },
    }));
  };

  const saveNotes = useCallback(() => {
    updateChapterProgress(chapter.id, (current) => ({ ...current, notes }));
    setNotesSaved(true);
  }, [chapter.id, notes, updateChapterProgress]);

  const activeSection = content.sections.find((section) => section.id === activeSectionId);
  const readCount = chapter.sections.filter((section) => readSet.has(section.id)).length;

  const jumpToSection = (sectionId: string) => {
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSectionId(sectionId);
    setActiveSubId("");
  };

  const jumpToSub = (sectionId: string, subId: string) => {
    document.getElementById(subId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSectionId(sectionId);
    setActiveSubId(subId);
  };

  return (
    <div className="xl:grid xl:grid-cols-[232px_minmax(0,1fr)] xl:items-start xl:gap-5">
      <SectionNav
        containerRef={navRef}
        sections={content.sections}
        readSet={readSet}
        checks={chapterProgress?.checks}
        activeSectionId={activeSectionId}
        activeSubId={activeSubId}
        readCount={readCount}
        onAsk={() => setChatOpen(true)}
        onJumpSection={jumpToSection}
        onJumpSub={jumpToSub}
        className="hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto"
      />

      <div className="min-w-0 space-y-4">
      <Card className="p-4 xl:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">逐节学习</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              已学完 {readCount}/{chapter.sections.length} 节。每节读完后标记完成，并作答学习检查。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setChatOpen(true)}>
            ✦ 问 AI 助手
          </Button>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
          {content.sections.map((section, index) => {
            const read = readSet.has(section.id);
            const answered = chapterProgress?.checks?.[section.id]?.answered;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => jumpToSection(section.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors",
                  activeSectionId === section.id
                    ? "border-cyan/50 bg-cyan/10 text-cyan"
                    : "border-line bg-panel2/40 text-muted hover:text-ink",
                )}
              >
                <span className="font-mono text-[9px] opacity-70">{String(index + 1).padStart(2, "0")}</span>
                <span className="max-w-[140px] truncate">{section.title}</span>
                <span aria-hidden="true" className={read ? "text-ok" : answered ? "text-gold" : "text-dim"}>
                  {read ? "✓" : answered ? "◐" : "○"}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {content.intro.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-2 text-[11px] uppercase tracking-[0.22em] text-dim">本章说明</h2>
          <CourseBlocks blocks={content.intro} />
        </Card>
      )}

      {content.sections.map((section, index) => {
        const read = readSet.has(section.id);
        const recorded = chapterProgress?.checks?.[section.id];
        const check = checks[section.id];
        return (
          <Card
            key={section.id}
            className={cn("scroll-mt-24 p-5", read && "border-ok/25")}
            as="section"
          >
            <div
              id={`section-${section.id}`}
              ref={(element) => { sectionRefs.current[section.id] = element; }}
              data-section-id={section.id}
              className="scroll-mt-28"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-line/50 pb-2.5">
                <h2 className="flex items-start gap-2.5 text-base font-semibold leading-snug text-ink">
                  <span className="mt-0.5 font-mono text-[11px] text-cyan/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {section.title}
                </h2>
                <Badge tone={read ? "ok" : "neutral"}>{read ? "已学完" : `${section.chars} 字`}</Badge>
              </div>

              <CourseBlocks blocks={section.blocks} />

              <SectionExplain chapter={chapter} content={content} sectionId={section.id} sectionTitle={section.title} />

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/40 pt-3">
                <Button size="sm" variant={read ? "secondary" : "primary"} onClick={() => toggleRead(section.id)}>
                  {read ? "取消已学完" : "标记本节已学完"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChatOpen(true)}>
                  针对本节提问
                </Button>
                <a
                  href={chapter.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-[11px] text-dim hover:text-cyan"
                >
                  查看原文 ↗
                </a>
              </div>
            </div>

            {check && (
              <StudyCheckCard
                check={check}
                recorded={recorded}
                onAnswer={(key) => answerCheck(section.id, key)}
                onBack={() => sectionRefs.current[section.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            )}
          </Card>
        );
      })}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">我的笔记</h2>
            <p className="mt-0.5 text-[11px] text-muted">笔记保存在本地，随章节进度一起导出。</p>
          </div>
          <div className="flex items-center gap-2">
            {!notesSaved && <span className="text-[11px] text-gold">有未保存修改</span>}
            <Button
              size="sm"
              variant="secondary"
              onClick={saveNotes}
              onBlur={saveNotes}
              disabled={notesSaved}
            >
              保存笔记
            </Button>
          </div>
        </div>
        <textarea
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            setNotesSaved(false);
          }}
          onBlur={saveNotes}
          rows={5}
          placeholder="记录你的理解、疑问或项目想法…"
          className="mt-3 w-full resize-y rounded-xl border border-line bg-panel2/50 px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-dim focus:border-cyan/50"
        />
      </Card>
      </div>

      {chatOpen && (
        <ChatPanel
          chapter={chapter}
          content={content}
          sectionTitle={activeSection?.title}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

function SectionNav({
  sections,
  readSet,
  checks,
  activeSectionId,
  activeSubId,
  readCount,
  onAsk,
  onJumpSection,
  onJumpSub,
  className,
  containerRef,
}: {
  sections: ChapterSection[];
  readSet: Set<string>;
  checks?: Record<string, { answered: boolean }>;
  activeSectionId: string;
  activeSubId: string;
  readCount: number;
  onAsk: () => void;
  onJumpSection: (sectionId: string) => void;
  onJumpSub: (sectionId: string, subId: string) => void;
  className?: string;
  containerRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <aside
      ref={containerRef}
      aria-label="章节目录"
      className={cn("rounded-2xl border border-line/80 bg-panel/75 p-2.5 backdrop-blur-sm", className)}
    >
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-ink">逐节学习</h2>
        <span className="shrink-0 text-[10px] tabular-nums text-cyan">
          {readCount}/{sections.length} 节
        </span>
      </div>
      <ProgressBar value={readCount} max={sections.length} className="mt-2 px-1" />
      <ol className="mt-2">
        {sections.map((section, index) => {
          const read = readSet.has(section.id);
          const answered = Boolean(checks?.[section.id]?.answered);
          const active = activeSectionId === section.id;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onJumpSection(section.id)}
                data-nav-section={section.id}
                aria-current={active ? "true" : undefined}
                title={section.title}
                className={cn(
                  "flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-[11.5px] leading-snug transition-colors",
                  active ? "bg-cyan/10 text-cyan" : "text-muted hover:bg-white/[0.04] hover:text-ink",
                )}
              >
                <span className="mt-px font-mono text-[9px] opacity-60">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1">{section.title}</span>
                <span
                  aria-hidden="true"
                  className={cn("text-[10px]", read ? "text-ok" : answered ? "text-gold" : "text-dim")}
                >
                  {read ? "✓" : answered ? "◐" : "○"}
                </span>
              </button>
              {section.subheadings.length > 0 && (
                <ul className="my-0.5 ml-[19px] space-y-px border-l border-line/50 pl-1.5">
                  {section.subheadings.map((heading) => {
                    const subActive = activeSubId === heading.id;
                    return (
                      <li key={heading.id}>
                        <button
                          type="button"
                          onClick={() => onJumpSub(section.id, heading.id)}
                          data-nav-sub={heading.id}
                          aria-current={subActive ? "true" : undefined}
                          title={heading.title}
                          className={cn(
                            "block w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] leading-snug transition-colors",
                            subActive
                              ? "bg-cyan/10 text-cyan"
                              : "text-dim hover:bg-white/[0.03] hover:text-muted",
                          )}
                        >
                          {heading.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" size="sm" className="mt-2.5 w-full" onClick={onAsk}>
        ✦ 问 AI 助手
      </Button>
    </aside>
  );
}

function StudyCheckCard({
  check,
  recorded,
  onAnswer,
  onBack,
}: {
  check: StudyCheck;
  recorded?: { answered: boolean; correct: boolean; answer?: string };
  onAnswer: (key: string) => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const answered = Boolean(recorded?.answered);
  const correct = Boolean(recorded?.correct);
  const chosen = selected ?? recorded?.answer ?? null;

  return (
    <div className="mt-4 rounded-xl border border-cyan/20 bg-gradient-to-br from-cyan/[0.06] to-transparent p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-medium text-cyan">
          <span aria-hidden="true">◈</span> 学习检查
          <span className="text-dim">不计入考试分，只用于确认理解</span>
        </div>
        {answered && (
          <Badge tone={correct ? "ok" : "danger"}>{correct ? "回答正确" : "需要回顾"}</Badge>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-prose">{check.prompt}</p>
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {check.options.map((option) => {
          const isChosen = chosen === option.key;
          const isAnswer = option.key === check.answer;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setSelected(option.key);
                onAnswer(option.key);
              }}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-[12px] leading-relaxed transition-colors",
                answered && isAnswer
                  ? "border-ok/50 bg-ok/10 text-ok"
                  : answered && isChosen && !isAnswer
                    ? "border-danger/50 bg-danger/10 text-danger"
                    : "border-line/70 bg-panel2/40 text-muted hover:border-cyan/40 hover:text-ink",
              )}
            >
              <span className="font-mono text-[10px] opacity-70">{option.key}</span>
              <span>{option.text}</span>
              {answered && isAnswer && <span className="ml-auto text-[10px]">✓</span>}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-2.5 rounded-lg border border-line/60 bg-panel2/50 px-3 py-2 text-[12px] leading-relaxed text-muted">
          <div className="text-[11px] text-dim">解析</div>
          <p className="mt-0.5">{check.explanation}</p>
          {!correct && (
            <button type="button" onClick={onBack} className="mt-1.5 text-[11px] text-cyan hover:underline">
              ↑ 回到本节知识点
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SectionExplain({
  chapter,
  content,
  sectionId,
  sectionTitle,
}: {
  chapter: ChapterMeta;
  content: ChapterContent;
  sectionId: string;
  sectionTitle: string;
}) {
  const { ai } = useApp();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [cached, setCached] = useState(false);

  const run = async (force = false) => {
    if (!ai.isAvailable()) return;
    setStatus("loading");
    setError("");
    try {
      const result = await ai.explainSection(chapter, content, undefined, sectionId, { force });
      setText(result.data);
      setCached(result.cached);
      setStatus("ready");
    } catch (caught) {
      setError(
        caught instanceof AiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
      setStatus("error");
    }
  };

  if (!ai.isAvailable()) {
    return (
      <div className="mt-4 rounded-xl border border-line/60 bg-panel2/30 p-3 text-[11.5px] leading-relaxed text-muted">
        <span className="text-[11px] font-medium text-ink">AI 精讲 · 未配置</span>
        <p className="mt-1">
          原文已按知识点分块展示，可先阅读并完成学习检查。配置模型后可生成逐节精讲（是什么 / 解决什么问题 / 何时使用 / 常见错误）。
          <Link to="/settings" className="ml-1 text-cyan hover:underline">
            去配置 →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-blue/25 bg-blue/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink">
          AI 精讲 · {sectionTitle}
          {cached && <span className="ml-2 text-[10px] text-dim">来自缓存</span>}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void run(status === "ready")} disabled={status === "loading"}>
          {status === "loading" ? "生成中…" : status === "ready" ? "重新生成" : "生成逐节精讲"}
        </Button>
      </div>
      {status === "idle" && (
        <p className="mt-1 text-[11px] text-dim">
          基于本节原文生成结构化讲解；超出原文的内容会标注【AI 补充】。
        </p>
      )}
      {status === "loading" && (
        <div className="mt-2 space-y-2">
          <div className="h-3 w-2/3 skeleton rounded" />
          <div className="h-3 skeleton rounded" />
          <div className="h-3 w-5/6 skeleton rounded" />
        </div>
      )}
      {status === "error" && (
        <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {error}
          <button type="button" onClick={() => void run(true)} className="ml-2 text-[11px] text-cyan hover:underline">
            重试
          </button>
        </div>
      )}
      {status === "ready" && <MarkdownText text={text} className="mt-1.5 text-[13px]" />}
    </div>
  );
}
