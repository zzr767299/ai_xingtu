import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useApp } from "../state/AppContext";
import { Badge, Card, LinkButton, ProgressBar, ProgressRing, Stat, cn } from "../components/ui";
import { StarRating, StarShape } from "../components/StarIcon";
import { areaCompletion, courseTotals, starLabel, tabLabel } from "../lib/domain/rules";
import { formatRelative } from "../lib/utils/format";

export function HomePage() {
  const {
    course,
    statuses,
    progress,
    resume,
    settings,
    chapters,
    chapterById,
    areaTitle,
    studyPointsFor,
    settings: appSettings,
  } = useApp();

  const totals = courseTotals(statuses);
  const completedAreas = course.areas.filter(
    (area) => areaCompletion(area.chapterIds, statuses).complete,
  ).length;
  const unresolved = progress.wrong.filter((entry) => !entry.resolved).length;
  const recentAttempts = useMemo(
    () => [...progress.attempts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4),
    [progress.attempts],
  );

  const bookmarks = useMemo(
    () =>
      chapters.filter((chapter) => progress.chapterProgress[chapter.id]?.summaryBookmarked),
    [chapters, progress.chapterProgress],
  );

  const currentChapter = "chapterId" in resume ? chapterById(resume.chapterId) : undefined;
  const currentStatus = currentChapter ? statuses[currentChapter.id] : undefined;
  const currentStudy = currentChapter ? studyPointsFor(currentChapter.id) : undefined;
  const continueHref =
    resume.kind === "review"
      ? "/review"
      : `/learn/${resume.chapterId}${
          resume.kind === "resume" && resume.sectionId
            ? `?s=${encodeURIComponent(resume.sectionId)}&tab=${resume.tab}`
            : resume.kind === "resume"
              ? `?tab=${resume.tab}`
              : ""
        }`;

  const hasAnyProgress =
    progress.attempts.length > 0 ||
    Object.values(progress.chapterProgress).some(
      (item) => item.guideAck || item.sectionsRead.length > 0 || item.summaryRead,
    );

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 lg:px-6 lg:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-dim">学习控制台</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink lg:text-[28px]">
            {settings.displayName ? `${settings.displayName}，` : ""}继续你的星途
          </h1>
          <p className="mt-1 text-sm text-muted">
            {course.title} · 课程版本 {course.version} · 共 {course.stats.chapters} 个章节
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={appSettings.ai.enabled ? "cyan" : "neutral"}>
            {appSettings.ai.enabled ? `AI · ${appSettings.ai.model}` : "AI 未配置"}
          </Badge>
          <Badge tone="neutral">课程 {course.source.license}</Badge>
        </div>
      </div>

      {!hasAnyProgress && (
        <Card className="mb-6 border-cyan/25 bg-gradient-to-r from-cyan/8 to-blue/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-ink">三步开始第一关</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                ① 打开导读确认目标 → ② 逐节阅读并完成学习检查 → ③ 复习总结后参加 80 分章节考试；总分 60 分通关并解锁下一颗星。
              </p>
            </div>
            <LinkButton to={continueHref} size="md">
              进入第一关
            </LinkButton>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card className="relative overflow-hidden p-5 lg:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan/10 blur-3xl" />
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <ProgressRing percent={totals.percent} size={146}>
              <span className="text-3xl font-semibold tabular-nums text-ink">{totals.percent}%</span>
              <span className="mt-0.5 text-[11px] text-muted">总进度</span>
            </ProgressRing>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="cyan">当前目标</Badge>
                {currentChapter ? (
                  <>
                    <Badge tone="neutral">{areaTitle(currentChapter.areaId)}</Badge>
                    {currentStatus?.passed ? (
                      <Badge tone="ok">已通关 · {currentStatus.bestTotal} 分</Badge>
                    ) : (
                      <Badge tone="gold">学习中</Badge>
                    )}
                  </>
                ) : (
                  <Badge tone="ok">全部通关</Badge>
                )}
              </div>
              <h2 className="mt-2.5 text-lg font-semibold leading-snug text-ink">
                {currentChapter ? currentChapter.title : "所有关卡均已通关"}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{resume.reason}</p>

              {currentChapter && currentStudy && (
                <div className="mt-4 space-y-2.5">
                  <ProgressBar
                    value={currentStudy.total}
                    max={20}
                    label={`学习任务 ${currentStudy.total}/20 分 · 已读 ${currentStudy.readCount}/${currentStudy.totalSections} 节`}
                    tone="gold"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["guide", "导读", currentStudy.tasks.guide],
                        ["sections", "知识点", currentStudy.tasks.sections],
                        ["checks", "检查", currentStudy.tasks.checks],
                        ["summary", "总结", currentStudy.tasks.summary],
                      ] as const
                    ).map(([key, label, done]) => (
                      <span
                        key={key}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
                          done
                            ? "border-ok/40 bg-ok/10 text-ok"
                            : "border-line bg-white/[0.03] text-dim",
                        )}
                      >
                        <span aria-hidden="true">{done ? "✓" : "○"}</span>
                        {label}
                        {done ? "" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <LinkButton
                  to={continueHref}
                  size="lg"
                  icon={<span aria-hidden="true">▶</span>}
                >
                  {resume.kind === "review"
                    ? "去错题本复习"
                    : resume.kind === "resume"
                      ? `继续学习 · ${tabLabel(resume.tab)}`
                      : "开始学习"}
                </LinkButton>
                <LinkButton to="/map" variant="secondary" size="lg">
                  查看星图
                </LinkButton>
                {currentChapter && currentStatus?.passed && (
                  <LinkButton
                    to={`/learn/${currentChapter.id}?tab=exam`}
                    variant="ghost"
                    size="lg"
                  >
                    重新挑战
                  </LinkButton>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="已通关章节" value={`${totals.passed}/${totals.total}`} hint={`${totals.percent}% 完成`} tone="cyan" />
          <Stat label="已完成大关卡" value={`${completedAreas}/${course.areas.length}`} hint="需通关全部必修章节" />
          <Stat
            label="最近学习"
            value={formatRelative(progress.lastLocation?.updatedAt)}
            hint={progress.lastLocation ? chapterById(progress.lastLocation.chapterId)?.title.slice(0, 14) : "尚未开始"}
          />
          <Stat label="待复习错题" value={unresolved} hint={unresolved ? "建议先复盘再挑战" : "暂无待复习错题"} tone={unresolved ? "gold" : "default"} />
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">大关卡进度</h2>
          <Link to="/map" className="text-xs text-cyan hover:underline">
            进入星图 →
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {course.areas.map((area) => {
            const completion = areaCompletion(area.chapterIds, statuses);
            const nextChapter = chapters.find(
              (chapter) => chapter.areaId === area.id && !statuses[chapter.id]?.passed,
            );
            const started = area.chapterIds.some((id) => statuses[id]?.started);
            return (
              <Card key={area.id} className="p-4">
                <div className="flex items-start gap-3">
                  <StarShape
                    tier={completion.complete ? "gold" : completion.passed > 0 ? "normal" : "failed"}
                    size={30}
                    glow={completion.complete}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-dim">{area.code}</span>
                      {completion.complete ? (
                        <Badge tone="ok">已通关</Badge>
                      ) : completion.passed > 0 || started ? (
                        <Badge tone="cyan">进行中</Badge>
                      ) : (
                        <Badge tone="neutral">可开始</Badge>
                      )}
                    </div>
                    <h3 className="mt-1 truncate text-sm font-medium text-ink" title={area.title}>
                      {area.title}
                    </h3>
                    <ProgressBar
                      value={completion.passed}
                      max={completion.total}
                      className="mt-2.5"
                      label={`${completion.passed}/${completion.total} 章 · 平均 ${completion.average || "—"} 分`}
                    />
                    {nextChapter && (
                      <Link
                        to={`/learn/${nextChapter.id}`}
                        className="mt-2 inline-flex text-[11px] text-muted hover:text-cyan"
                      >
                        下一步：{nextChapter.title} →
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">最近成绩</h2>
            <Link to="/review" className="text-xs text-cyan hover:underline">
              错题本 →
            </Link>
          </div>
          {recentAttempts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              还没有考试记录。完成一章学习任务后即可参加 80 分章节考试。
            </p>
          ) : (
            <ul className="space-y-2.5">
              {recentAttempts.map((attempt) => {
                const chapter = chapterById(attempt.chapterId);
                return (
                  <li
                    key={attempt.id}
                    className="flex items-center gap-3 rounded-xl border border-line/60 bg-panel2/40 px-3 py-2.5"
                  >
                    <StarShape tier={attempt.star} size={22} glow={attempt.star === "gold"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{chapter?.title ?? attempt.chapterId}</div>
                      <div className="text-[11px] text-dim">
                        {formatRelative(attempt.createdAt)} · 学习 {attempt.studyPoints} + 考试 {attempt.examScore}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-base font-semibold tabular-nums", attempt.passed ? "text-cyan" : "text-danger")}>
                        {attempt.total}
                      </div>
                      <div className="text-[10px] text-dim">{starLabel(attempt.star)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">复习队列</h2>
            <Badge tone={unresolved ? "gold" : "neutral"}>{unresolved} 条待复习</Badge>
          </div>
          {unresolved === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              暂无待复习错题。考试中的失分题目会自动进入错题本。
            </div>
          ) : (
            <ul className="space-y-2">
              {progress.wrong
                .filter((entry) => !entry.resolved)
                .slice(0, 4)
                .map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2">
                    <div className="truncate text-[12.5px] text-ink">{entry.question.prompt.replace(/[#*`]/g, "").slice(0, 60)}</div>
                    <div className="mt-0.5 text-[11px] text-dim">
                      {chapterById(entry.chapterId)?.title ?? entry.chapterId} · 失分 {entry.lostPoints}
                    </div>
                  </li>
                ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-2 text-[11px] text-dim">
            <StarRating star={totals.passed >= totals.total && totals.total > 0 ? "gold" : "failed"} size={14} />
            <span>星级以历史最高有效成绩为准</span>
          </div>
        </Card>
      </div>

      {bookmarks.length > 0 && (
        <Card className="mt-4 p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">收藏的总结</h2>
            <Badge tone="gold">{bookmarks.length} 篇</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bookmarks.map((chapter) => (
              <Link
                key={chapter.id}
                to={`/learn/${chapter.id}?tab=summary`}
                className="rounded-lg border border-line/60 bg-panel2/40 px-3 py-2 text-[12px] text-muted transition-colors hover:border-gold/40 hover:text-ink"
              >
                <span className="mr-1.5 text-gold">★</span>
                {chapter.title}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <footer className="mt-8 border-t border-line/50 pt-4 text-[11px] leading-relaxed text-dim">
        课程内容来自{" "}
        <a className="text-cyan hover:underline" href={course.source.repo} target="_blank" rel="noreferrer">
          ai-agents-from-zero
        </a>
        （{course.source.license} · {course.source.copyright}）。原文版权归原作者所有，本应用提供学习流程、AI 讲解与考核编排。
      </footer>
    </div>
  );
}
