import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { Badge, Button, Card, LinkButton, ProgressBar, cn } from "../components/ui";
import { StarShape } from "../components/StarIcon";
import { starLabel } from "../lib/domain/rules";
import { formatRelative } from "../lib/utils/format";
import { GuideTab } from "./chapter/GuideTab";
import { LearnTab } from "./chapter/LearnTab";
import { SummaryTab } from "./chapter/SummaryTab";
import { ExamTab } from "./chapter/ExamTab";

type TabId = "guide" | "learn" | "summary" | "exam";

const TABS: { id: TabId; label: string; icon: string; hint: string }[] = [
  { id: "guide", label: "AI 导读", icon: "◎", hint: "目标与路线" },
  { id: "learn", label: "AI 讲解", icon: "▤", hint: "逐节阅读" },
  { id: "summary", label: "图文总结", icon: "❖", hint: "复习资料" },
  { id: "exam", label: "章节考试", icon: "★", hint: "80 分挑战" },
];

export function ChapterPage() {
  const { chapterId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const {
    course,
    chapterById,
    statuses,
    progress,
    areaTitle,
    studyPointsFor,
    contents,
    loadingChapters,
    chapterErrors,
    loadChapterContent,
    setLastLocation,
  } = useApp();

  const chapter = chapterById(chapterId);
  const status = chapter ? statuses[chapter.id] : undefined;
  const content = contents[chapterId];
  const loading = loadingChapters[chapterId];
  const loadError = chapterErrors[chapterId];

  const tabParam = params.get("tab");
  const tab: TabId = TABS.some((item) => item.id === tabParam) ? (tabParam as TabId) : "guide";
  const sectionParam = params.get("s") ?? undefined;

  useEffect(() => {
    if (!chapter) return;
    void loadChapterContent(chapter.id);
  }, [chapter?.id, loadChapterContent]);

  useEffect(() => {
    if (!chapter) return;
    const lastSectionId =
      progress.chapterProgress[chapter.id]?.lastSectionId ?? chapter.sections[0]?.id;
    setLastLocation({
      chapterId: chapter.id,
      sectionId: lastSectionId,
      tab,
      updatedAt: Date.now(),
    });
    // 只在章节或标签切换时记录，滚动位置由 LearnTab 更新
  }, [chapter?.id, tab]);

  useEffect(() => {
    if (!content || !sectionParam || tab !== "learn") return;
    const timer = setTimeout(() => {
      const element = document.getElementById(`section-${sectionParam}`);
      element?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(timer);
  }, [content, sectionParam, tab]);

  if (!chapter) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-ink">找不到这个章节</h1>
        <p className="mt-2 text-sm text-muted">链接可能来自旧版本课程，请回到星图重新选择。</p>
        <LinkButton to="/map" className="mt-4">
          返回星图
        </LinkButton>
      </div>
    );
  }

  const study = studyPointsFor(chapter.id);
  const previous = course.chapters
    .filter((item) => item.areaId === chapter.areaId && item.order < chapter.order)
    .sort((a, b) => b.order - a.order)[0];
  const attempts = progress.attempts
    .filter((attempt) => attempt.chapterId === chapter.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const lastAttempt = attempts[0];

  if (!status?.unlocked) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14">
        <Card className="p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-panel2">
            <StarShape locked size={38} />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">这一关还没有解锁</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            「{chapter.title}」需要先通关前置章节
            {previous ? `「${previous.title}」` : ""}。你可以先查看本关的学习目标，但正文与考试会保持锁定。
          </p>
          {chapter.objectives.length > 0 && (
            <ul className="mx-auto mt-4 max-w-md list-disc space-y-1 pl-5 text-left text-[12.5px] leading-relaxed text-muted">
              {chapter.objectives.slice(0, 4).map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {previous && (
              <LinkButton to={`/learn/${previous.id}`}>去前置章节</LinkButton>
            )}
            <LinkButton to="/map" variant="secondary">
              返回星图
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  const switchTab = (next: TabId) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    if (next !== "learn") nextParams.delete("s");
    setParams(nextParams, { replace: true });
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6 lg:py-6">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-dim" aria-label="面包屑">
        <Link to="/map" className="hover:text-cyan">
          关卡星图
        </Link>
        <span>/</span>
        <span>{areaTitle(chapter.areaId)}</span>
        {chapter.groupTitle && (
          <>
            <span>/</span>
            <span>{chapter.groupTitle}</span>
          </>
        )}
        <span>/</span>
        <span className="text-muted">{chapter.title}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">第 {chapter.order} 关</Badge>
            <Badge tone="cyan">{areaTitle(chapter.areaId)}</Badge>
            <Badge tone="neutral">{chapter.estimateMinutes} 分钟</Badge>
            <Badge tone="neutral">{chapter.sections.length} 个知识点</Badge>
            <Badge tone="neutral">
              {chapter.profile === "code-heavy" ? "工程实战型" : chapter.profile === "mixed" ? "综合型" : "概念理解型"}
            </Badge>
          </div>
          <h1 className="mt-2 max-w-3xl text-xl font-semibold leading-snug text-ink lg:text-2xl">
            {chapter.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-dim">
            <a href={chapter.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-cyan">
              原文 Markdown ↗
            </a>
            <a href={chapter.onlineUrl} target="_blank" rel="noreferrer" className="hover:text-cyan">
              在线阅读 ↗
            </a>
            <span>课程版本 {chapter.contentHash.slice(0, 8)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-line/70 bg-panel2/50 px-4 py-3">
          <StarShape tier={status.star} locked={false} size={34} glow={status.star === "gold"} />
          <div>
            <div className="text-sm font-semibold text-ink">
              {status.passed ? `${status.bestTotal} 分` : `学习分 ${study.total}/20`}
            </div>
            <div className="text-[11px] text-muted">
              {status.passed ? starLabel(status.star) : status.studyPoints === 20 ? "学习任务完成，可参加考试" : "完成学习任务解锁考试"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-line/60 pb-px hide-scrollbar">
        {TABS.map((item) => {
          const active = tab === item.id;
          const examLocked = item.id === "exam" && study.total < 20;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => switchTab(item.id)}
              className={cn(
                "group relative shrink-0 rounded-t-lg px-4 py-2.5 text-left transition-colors",
                active ? "bg-panel2/80 text-cyan" : "text-muted hover:bg-white/[0.03] hover:text-ink",
              )}
              aria-current={active ? "page" : undefined}
            >
              <span className="text-[13px] font-medium">
                <span className="mr-1.5 text-[11px] opacity-80" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </span>
              <span className="ml-2 text-[10px] text-dim">
                {examLocked ? "需完成学习任务" : item.hint}
              </span>
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan" />}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_296px]">
        <div className="min-w-0">
          {loadError && (
            <Card className="mb-4 border-danger/40 bg-danger/10 p-4 text-sm text-danger">
              章节内容加载失败：{loadError}
              <Button size="sm" variant="secondary" className="ml-3" onClick={() => void loadChapterContent(chapter.id)}>
                重试
              </Button>
            </Card>
          )}
          {!content && loading && (
            <Card className="space-y-3 p-6">
              <div className="h-5 w-2/5 skeleton rounded" />
              <div className="h-3 skeleton rounded" />
              <div className="h-3 w-11/12 skeleton rounded" />
              <div className="h-3 w-4/5 skeleton rounded" />
              <div className="h-28 skeleton rounded-xl" />
            </Card>
          )}
          {!content && !loading && !loadError && (
            <Card className="p-6 text-sm text-muted">
              正在准备章节内容…
            </Card>
          )}

          {content && tab === "guide" && (
            <GuideTab chapter={chapter} content={content} previousChapterTitle={previous?.title} />
          )}
          {content && tab === "learn" && <LearnTab chapter={chapter} content={content} />}
          {content && tab === "summary" && <SummaryTab chapter={chapter} content={content} />}
          {content && tab === "exam" && <ExamTab chapter={chapter} content={content} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">学习任务</h2>
              <span className="text-xs tabular-nums text-cyan">{study.total}/20 分</span>
            </div>
            <ProgressBar value={study.total} max={20} className="mt-2" tone="gold" />
            <ul className="mt-3 space-y-2 text-[12px]">
              <TaskRow
                label="AI 导读与目标确认"
                points={2}
                done={study.tasks.guide}
                detail="读完导读后确认"
                onClick={() => switchTab("guide")}
              />
              <TaskRow
                label="必修知识点学习"
                points={8}
                done={study.tasks.sections}
                detail={`${study.readCount}/${study.totalSections} 节已学完`}
                onClick={() => switchTab("learn")}
              />
              <TaskRow
                label="章节互动检查"
                points={6}
                done={study.tasks.checks}
                detail={`${study.answeredChecks}/${study.totalChecks} 题已作答`}
                onClick={() => switchTab("learn")}
              />
              <TaskRow
                label="AI 总结阅读确认"
                points={4}
                done={study.tasks.summary}
                detail="复习完总结后确认"
                onClick={() => switchTab("summary")}
              />
            </ul>
            <div className="mt-3 rounded-lg border border-line/60 bg-panel2/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
              学习分只记录任务完成情况；答对率、考试成绩单独记录，不会重复计分。
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">考试成绩</h2>
            {status.passed || attempts.length > 0 ? (
              <div className="mt-2 space-y-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">最高成绩</span>
                  <span className="font-semibold text-ink">{status.bestTotal} 分</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">星级</span>
                  <span className="flex items-center gap-1.5 text-ink">
                    <StarShape tier={status.star} size={16} />
                    {starLabel(status.star)}
                  </span>
                </div>
                {lastAttempt && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted">最近一次</span>
                    <span className="text-ink">
                      {lastAttempt.total} 分 · {formatRelative(lastAttempt.createdAt)}
                    </span>
                  </div>
                )}
                <div className="text-[11px] text-dim">共 {attempts.length} 次考试记录</div>
                {study.total >= 20 && (
                  <Button size="sm" variant="gold" className="mt-1 w-full" onClick={() => switchTab("exam")}>
                    {status.passed ? "重新挑战更高星" : "再次挑战"}
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                还没有考试记录。满分 80 分，加学习分 20 分，总分 60 分通关。
              </p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">本章术语</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chapter.terms.length ? (
                chapter.terms.slice(0, 10).map((term) => (
                  <Link
                    key={term}
                    to={`/glossary?q=${encodeURIComponent(term)}`}
                    className="rounded-md border border-line/70 bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted hover:border-cyan/40 hover:text-cyan"
                  >
                    {term}
                  </Link>
                ))
              ) : (
                <span className="text-[11px] text-dim">本章未匹配到术语表条目</span>
              )}
            </div>
          </Card>

        </aside>
      </div>
    </div>
  );
}

function TaskRow({
  label,
  points,
  done,
  detail,
  onClick,
}: {
  label: string;
  points: number;
  done: boolean;
  detail: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
            done ? "border-ok/60 bg-ok/15 text-ok" : "border-line text-dim",
          )}
          aria-hidden="true"
        >
          {done ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block", done ? "text-muted line-through decoration-line" : "text-ink")}>
            {label}
            <span className="ml-1 text-[10px] text-dim">+{points}</span>
          </span>
          <span className="block text-[10.5px] text-dim">{detail}</span>
        </span>
      </button>
    </li>
  );
}
