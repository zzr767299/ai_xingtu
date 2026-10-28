import type {
  ChapterMeta,
  ChapterProgress,
  ExamAttempt,
  StarTier,
  StudyProgressState,
} from "../../types";

export const STUDY_TASK_POINTS = {
  guide: 2,
  sections: 8,
  checks: 6,
  summary: 4,
} as const;

export const STUDY_MAX = 20;
export const EXAM_MAX = 80;
export const TOTAL_MAX = 100;
export const PASS_SCORE = 60;

export interface StudyTaskState {
  guide: boolean;
  sections: boolean;
  checks: boolean;
  summary: boolean;
}

export interface StudyPointBreakdown {
  total: number;
  tasks: StudyTaskState;
  points: Record<keyof StudyTaskState, number>;
  readCount: number;
  totalSections: number;
  answeredChecks: number;
  totalChecks: number;
}

export function createEmptyProgress(chapterId: string): ChapterProgress {
  return {
    chapterId,
    guideAck: false,
    sectionsRead: [],
    checks: {},
    summaryRead: false,
    updatedAt: Date.now(),
  };
}

/** 学习分只反映任务完成度，不掺入正确率。 */
export function computeStudyPoints(
  chapter: Pick<ChapterMeta, "sections">,
  progress?: ChapterProgress,
): StudyPointBreakdown {
  const sectionIds = chapter.sections.map((section) => section.id);
  const readSet = new Set(progress?.sectionsRead ?? []);
  const readCount = sectionIds.filter((id) => readSet.has(id)).length;
  const answeredChecks = sectionIds.filter((id) => progress?.checks?.[id]?.answered).length;

  const tasks: StudyTaskState = {
    guide: Boolean(progress?.guideAck),
    sections: sectionIds.length > 0 && readCount === sectionIds.length,
    checks: sectionIds.length > 0 && answeredChecks === sectionIds.length,
    summary: Boolean(progress?.summaryRead),
  };

  const points = {
    guide: tasks.guide ? STUDY_TASK_POINTS.guide : 0,
    sections: tasks.sections ? STUDY_TASK_POINTS.sections : 0,
    checks: tasks.checks ? STUDY_TASK_POINTS.checks : 0,
    summary: tasks.summary ? STUDY_TASK_POINTS.summary : 0,
  };

  return {
    total: points.guide + points.sections + points.checks + points.summary,
    tasks,
    points,
    readCount,
    totalSections: sectionIds.length,
    answeredChecks,
    totalChecks: sectionIds.length,
  };
}

export function allStudyTasksDone(breakdown: StudyPointBreakdown): boolean {
  return breakdown.total >= STUDY_MAX;
}

export function starForScore(score: number): StarTier {
  if (score >= 100) return "gold";
  if (score >= 90) return "silver";
  if (score >= 80) return "bronze";
  if (score >= PASS_SCORE) return "normal";
  return "failed";
}

export function starLabel(star: StarTier): string {
  switch (star) {
    case "gold":
      return "金色星星 · 完美通关";
    case "silver":
      return "银色星星 · 掌握扎实";
    case "bronze":
      return "铜色星星 · 大体掌握";
    case "normal":
      return "普通星星 · 达到及格";
    default:
      return "未通关 · 需要复习";
  }
}

export function isPass(total: number): boolean {
  return total >= PASS_SCORE;
}

export function totalScore(studyPoints: number, examScore: number): number {
  const study = clamp(Math.round(studyPoints), 0, STUDY_MAX);
  const exam = clamp(Math.round(examScore), 0, EXAM_MAX);
  return study + exam;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ChapterStatus {
  chapterId: string;
  unlocked: boolean;
  passed: boolean;
  bestTotal: number;
  bestAttemptId?: string;
  lastAttempt?: ExamAttempt;
  star: StarTier;
  studyPoints: number;
  studyTasks: StudyTaskState;
  started: boolean;
}

/**
 * 解锁规则：
 * - 每个大关卡的第一章默认开放，用户可自由选择想学的领域；
 * - 同一大关卡内，后续章节仍需前一章通关才解锁；
 * - 已解锁状态不会因后续低分撤销。
 */
export function buildChapterStatuses(
  course: { chapters: ChapterMeta[] },
  state: StudyProgressState,
): Record<string, ChapterStatus> {
  const statuses: Record<string, ChapterStatus> = {};
  const sorted = [...course.chapters].sort((a, b) => a.order - b.order);
  let previousPassed = true;
  let currentAreaId: string | null = null;

  for (const chapter of sorted) {
    const firstOfArea = chapter.areaId !== currentAreaId;
    if (firstOfArea) {
      currentAreaId = chapter.areaId;
      previousPassed = true;
    }

    const progress = state.chapterProgress[chapter.id];
    const attempts = state.attempts
      .filter((attempt) => attempt.chapterId === chapter.id)
      .sort((a, b) => b.createdAt - a.createdAt);
    const best = attempts.reduce<ExamAttempt | undefined>(
      (winner, attempt) => (!winner || attempt.total > winner.total ? attempt : winner),
      undefined,
    );
    const study = computeStudyPoints(chapter, progress);
    const passed = Boolean(best && best.total >= PASS_SCORE);
    const unlocked = firstOfArea || previousPassed;

    statuses[chapter.id] = {
      chapterId: chapter.id,
      unlocked,
      passed,
      bestTotal: best?.total ?? 0,
      bestAttemptId: best?.id,
      lastAttempt: attempts[0],
      star: best ? best.star : "failed",
      studyPoints: study.total,
      studyTasks: study.tasks,
      started: Boolean(
        progress &&
          (progress.guideAck ||
            progress.sectionsRead.length > 0 ||
            progress.summaryRead ||
            attempts.length > 0),
      ),
    };

    previousPassed = passed;
  }

  return statuses;
}

export function courseTotals(statuses: Record<string, ChapterStatus>) {
  const values = Object.values(statuses);
  const passed = values.filter((status) => status.passed).length;
  return {
    passed,
    total: values.length,
    percent: values.length === 0 ? 0 : Math.round((passed / values.length) * 100),
  };
}

export function areaCompletion(
  areaChapterIds: string[],
  statuses: Record<string, ChapterStatus>,
) {
  const passed = areaChapterIds.filter((id) => statuses[id]?.passed).length;
  const scores = areaChapterIds
    .map((id) => statuses[id]?.bestTotal ?? 0)
    .filter((score) => score > 0);
  return {
    passed,
    total: areaChapterIds.length,
    percent: areaChapterIds.length ? Math.round((passed / areaChapterIds.length) * 100) : 0,
    average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0,
    complete: areaChapterIds.length > 0 && passed === areaChapterIds.length,
  };
}

export type ResumeTarget =
  | { kind: "resume"; chapterId: string; sectionId?: string; tab: string; reason: string }
  | { kind: "next"; chapterId: string; reason: string }
  | { kind: "review"; reason: string }
  | { kind: "start"; chapterId: string; reason: string };

/** 首页「继续学习」的目标：优先恢复原始位置，其次最近未完成章节。 */
export function resolveResumeTarget(
  course: { chapters: ChapterMeta[] },
  state: StudyProgressState,
  statuses: Record<string, ChapterStatus>,
): ResumeTarget {
  const sorted = [...course.chapters].sort((a, b) => a.order - b.order);
  const last = state.lastLocation;
  const lastChapter = last ? course.chapters.find((chapter) => chapter.id === last.chapterId) : undefined;

  if (last && lastChapter) {
    const status = statuses[lastChapter.id];
    if (status && !status.passed) {
      return {
        kind: "resume",
        chapterId: lastChapter.id,
        sectionId: last.sectionId,
        tab: last.tab,
        reason: `上次在「${lastChapter.title}」学习，已回到${tabLabel(last.tab)}的具体位置。`,
      };
    }
    const next = sorted.find(
      (chapter) => statuses[chapter.id]?.unlocked && !statuses[chapter.id]?.passed,
    );
    if (next) {
      return {
        kind: "next",
        chapterId: next.id,
        reason: `「${lastChapter.title}」已通关，继续最近未完成的「${next.title}」。`,
      };
    }
    return { kind: "review", reason: "所有关卡都已通关，可以去错题本复习或重新挑战高分。" };
  }

  const firstUnfinished = sorted.find(
    (chapter) => statuses[chapter.id]?.unlocked && !statuses[chapter.id]?.passed,
  );
  if (firstUnfinished) {
    return {
      kind: "start",
      chapterId: firstUnfinished.id,
      reason: `从第一关「${firstUnfinished.title}」开始你的星途。`,
    };
  }
  return { kind: "review", reason: "暂无可学习章节，请检查课程数据。" };
}

export function tabLabel(tab: string): string {
  switch (tab) {
    case "guide":
      return "AI 导读";
    case "summary":
      return "图文总结";
    case "exam":
      return "章节考试";
    default:
      return "AI 讲解";
  }
}

/** 合并进度：同一章取并集，考试记录按 id 去重，导入不会覆盖更晚的记录。 */
export function mergeProgress(
  current: StudyProgressState,
  incoming: StudyProgressState,
): StudyProgressState {
  const chapterProgress = { ...current.chapterProgress };
  for (const [chapterId, next] of Object.entries(incoming.chapterProgress ?? {})) {
    const prev = chapterProgress[chapterId];
    if (!prev) {
      chapterProgress[chapterId] = next;
      continue;
    }
    chapterProgress[chapterId] = {
      ...prev,
      guideAck: prev.guideAck || next.guideAck,
      sectionsRead: [...new Set([...prev.sectionsRead, ...next.sectionsRead])],
      checks: { ...prev.checks, ...next.checks },
      summaryRead: prev.summaryRead || next.summaryRead,
      summaryBookmarked: prev.summaryBookmarked || next.summaryBookmarked,
      summaryChecklist: [...new Set([...(prev.summaryChecklist ?? []), ...(next.summaryChecklist ?? [])])],
      lastSectionId: next.updatedAt >= prev.updatedAt ? next.lastSectionId : prev.lastSectionId,
      notes: next.notes ?? prev.notes,
      updatedAt: Math.max(prev.updatedAt, next.updatedAt),
    };
  }

  const attemptMap = new Map<string, ExamAttempt>();
  for (const attempt of [...current.attempts, ...(incoming.attempts ?? [])]) {
    const existing = attemptMap.get(attempt.id);
    if (!existing || attempt.createdAt > existing.createdAt) attemptMap.set(attempt.id, attempt);
  }

  const wrongMap = new Map(current.wrong.map((entry) => [entry.id, entry]));
  for (const entry of incoming.wrong ?? []) wrongMap.set(entry.id, entry);

  const lastA = current.lastLocation?.updatedAt ?? 0;
  const lastB = incoming.lastLocation?.updatedAt ?? 0;

  return {
    chapterProgress,
    attempts: [...attemptMap.values()].sort((a, b) => b.createdAt - a.createdAt),
    wrong: [...wrongMap.values()].sort((a, b) => b.createdAt - a.createdAt),
    lastLocation: lastB > lastA ? incoming.lastLocation : current.lastLocation,
  };
}

/** 课程同步后把旧进度映射到新章节 ID：先按源路径，再按内容哈希兜底。 */
export function remapChapterIds(
  state: StudyProgressState,
  previous: Record<string, { sourcePath: string; contentHash: string }>,
  next: { pathToId: Record<string, string>; hashToId: Record<string, string> },
): StudyProgressState {
  const nextIds = new Set(Object.values(next.pathToId));
  const mapId = (oldId: string) => {
    if (nextIds.has(oldId)) return oldId;
    const meta = previous[oldId];
    if (!meta) return oldId;
    return next.pathToId[meta.sourcePath] ?? next.hashToId[meta.contentHash] ?? oldId;
  };

  const chapterProgress: Record<string, ChapterProgress> = {};
  for (const [id, progress] of Object.entries(state.chapterProgress)) {
    const target = mapId(id);
    chapterProgress[target] = { ...progress, chapterId: target };
  }

  return {
    chapterProgress,
    attempts: state.attempts.map((attempt) => ({ ...attempt, chapterId: mapId(attempt.chapterId) })),
    wrong: state.wrong.map((entry) => ({ ...entry, chapterId: mapId(entry.chapterId) })),
    lastLocation: state.lastLocation
      ? { ...state.lastLocation, chapterId: mapId(state.lastLocation.chapterId) }
      : null,
  };
}
