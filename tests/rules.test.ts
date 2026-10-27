import { describe, expect, it } from "vitest";
import type { ChapterProgress, ExamAttempt, StudyProgressState } from "../src/types";
import {
  buildChapterStatuses,
  computeStudyPoints,
  createEmptyProgress,
  mergeProgress,
  remapChapterIds,
  resolveResumeTarget,
  starForScore,
  totalScore,
} from "../src/lib/domain/rules";
import { createEmptyState } from "../src/lib/storage/repo";
import { chapterMeta } from "./helpers";

function fullProgress(chapterId: string, sectionIds: string[]): ChapterProgress {
  return {
    ...createEmptyProgress(chapterId),
    guideAck: true,
    sectionsRead: sectionIds,
    checks: Object.fromEntries(sectionIds.map((id) => [id, { answered: true, correct: true }])),
    summaryRead: true,
    updatedAt: Date.now(),
  };
}

describe("学习分结构", () => {
  const chapter = chapterMeta(1);
  const sectionIds = chapter.sections.map((section) => section.id);

  it("空进度为 0 分", () => {
    const result = computeStudyPoints(chapter);
    expect(result.total).toBe(0);
    expect(result.tasks).toEqual({ guide: false, sections: false, checks: false, summary: false });
  });

  it("四个任务分别计 2 / 8 / 6 / 4 分，合计 20", () => {
    const progress = fullProgress(chapter.id, sectionIds);
    const result = computeStudyPoints(chapter, progress);
    expect(result.points).toEqual({ guide: 2, sections: 8, checks: 6, summary: 4 });
    expect(result.total).toBe(20);
    expect(result.tasks).toEqual({ guide: true, sections: true, checks: true, summary: true });
  });

  it("只读了一部分知识点不发 8 分", () => {
    const progress = { ...fullProgress(chapter.id, sectionIds), sectionsRead: [sectionIds[0]], checks: {} };
    const result = computeStudyPoints(chapter, progress);
    expect(result.total).toBe(2 + 4);
    expect(result.tasks.sections).toBe(false);
    expect(result.tasks.checks).toBe(false);
  });

  it("学习分与考试分互不重复，总分不超过 100", () => {
    expect(totalScore(20, 80)).toBe(100);
    expect(totalScore(20, 95)).toBe(100);
    expect(totalScore(-5, 200)).toBe(80);
  });
});

describe("星级与通关线", () => {
  it.each([
    [100, "gold"],
    [99, "silver"],
    [90, "silver"],
    [89, "bronze"],
    [80, "bronze"],
    [79, "normal"],
    [60, "normal"],
    [59, "failed"],
    [0, "failed"],
  ])("%i 分对应 %s", (score, star) => {
    expect(starForScore(score)).toBe(star);
  });

  it("59 分不通过，60 分通过", () => {
    expect(totalScore(20, 39)).toBe(59);
    expect(totalScore(20, 40)).toBe(60);
  });
});

function attempt(chapterId: string, total: number, createdAt = Date.now()): ExamAttempt {
  return {
    id: `attempt-${chapterId}-${total}-${createdAt}`,
    chapterId,
    paperId: "paper-1",
    paperSource: "local",
    createdAt,
    durationMs: 1000,
    studyPoints: 20,
    examScore: total - 20,
    total,
    passed: total >= 60,
    star: starForScore(total),
    grades: [],
    answers: {},
    questions: [],
    gradedBy: "auto",
  };
}

describe("解锁系统", () => {
  const course = { chapters: [chapterMeta(1), chapterMeta(2), chapterMeta(3)] };

  it("第一章默认解锁，其余锁定", () => {
    const statuses = buildChapterStatuses(course, createEmptyState());
    expect(statuses["ch_test_1"].unlocked).toBe(true);
    expect(statuses["ch_test_2"].unlocked).toBe(false);
    expect(statuses["ch_test_3"].unlocked).toBe(false);
  });

  it("59 分不通过，不解锁下一关", () => {
    const state: StudyProgressState = {
      ...createEmptyState(),
      attempts: [attempt("ch_test_1", 59)],
      chapterProgress: {},
    };
    const statuses = buildChapterStatuses(course, state);
    expect(statuses["ch_test_1"].passed).toBe(false);
    expect(statuses["ch_test_2"].unlocked).toBe(false);
  });

  it("每个大关卡的首章默认解锁，大关卡之间可自由选择", () => {
    const multiArea = {
      chapters: [
        chapterMeta(1, { areaId: "area-01" }),
        chapterMeta(2, { areaId: "area-01" }),
        chapterMeta(3, { areaId: "area-02" }),
        chapterMeta(4, { areaId: "area-02" }),
      ],
    };
    const initial = buildChapterStatuses(multiArea, createEmptyState());
    expect(initial["ch_test_1"].unlocked).toBe(true);
    expect(initial["ch_test_2"].unlocked).toBe(false);
    expect(initial["ch_test_3"].unlocked).toBe(true);
    expect(initial["ch_test_4"].unlocked).toBe(false);

    const passedFirst = buildChapterStatuses(multiArea, {
      ...createEmptyState(),
      attempts: [attempt("ch_test_1", 80)],
    });
    expect(passedFirst["ch_test_2"].unlocked).toBe(true);
    expect(passedFirst["ch_test_3"].unlocked).toBe(true);
    expect(passedFirst["ch_test_4"].unlocked).toBe(false);
  });

  it("通关后解锁下一关，且不会因为之后的低分而撤销", () => {
    const state: StudyProgressState = {
      ...createEmptyState(),
      attempts: [attempt("ch_test_1", 80, 1), attempt("ch_test_1", 45, 2)],
    };
    const statuses = buildChapterStatuses(course, state);
    expect(statuses["ch_test_1"].passed).toBe(true);
    expect(statuses["ch_test_1"].bestTotal).toBe(80);
    expect(statuses["ch_test_2"].unlocked).toBe(true);
    expect(statuses["ch_test_3"].unlocked).toBe(false);
  });
});

describe("继续学习定位", () => {
  const course = { chapters: [chapterMeta(1), chapterMeta(2)] };

  it("恢复到上次章节与知识点", () => {
    const state: StudyProgressState = {
      ...createEmptyState(),
      chapterProgress: { ch_test_1: fullProgress("ch_test_1", ["kp_1_1", "kp_1_2"]) },
      lastLocation: { chapterId: "ch_test_1", sectionId: "kp_1_2", tab: "learn", updatedAt: 100 },
    };
    const statuses = buildChapterStatuses(course, state);
    const target = resolveResumeTarget(course, state, statuses);
    expect(target).toMatchObject({ kind: "resume", chapterId: "ch_test_1", sectionId: "kp_1_2" });
  });

  it("上次章节已通关时指向下一章未完成章节", () => {
    const state: StudyProgressState = {
      ...createEmptyState(),
      attempts: [attempt("ch_test_1", 90)],
      lastLocation: { chapterId: "ch_test_1", tab: "exam", updatedAt: 100 },
    };
    const statuses = buildChapterStatuses(course, state);
    const target = resolveResumeTarget(course, state, statuses);
    expect(target).toMatchObject({ kind: "next", chapterId: "ch_test_2" });
  });
});

describe("合并与课程同步", () => {
  it("合并进度时取并集且考试记录去重", () => {
    const current: StudyProgressState = {
      chapterProgress: {
        ch_test_1: { ...createEmptyProgress("ch_test_1"), sectionsRead: ["a"], notes: "旧笔记" },
      },
      attempts: [attempt("ch_test_1", 70, 10)],
      wrong: [],
      lastLocation: { chapterId: "ch_test_1", tab: "guide", updatedAt: 10 },
    };
    const incoming: StudyProgressState = {
      chapterProgress: {
        ch_test_1: { ...createEmptyProgress("ch_test_1"), sectionsRead: ["b"], guideAck: true },
      },
      attempts: [attempt("ch_test_1", 70, 10), attempt("ch_test_1", 85, 20)],
      wrong: [],
      lastLocation: { chapterId: "ch_test_1", tab: "learn", updatedAt: 20 },
    };
    const merged = mergeProgress(current, incoming);
    expect(merged.chapterProgress["ch_test_1"].sectionsRead.sort()).toEqual(["a", "b"]);
    expect(merged.chapterProgress["ch_test_1"].notes).toBe("旧笔记");
    expect(merged.attempts).toHaveLength(2);
    expect(merged.lastLocation?.updatedAt).toBe(20);
  });

  it("课程同步后按源路径或内容哈希保留进度", () => {
    const state: StudyProgressState = {
      chapterProgress: {
        ch_old: { ...createEmptyProgress("ch_old"), guideAck: true },
        ch_moved: { ...createEmptyProgress("ch_moved"), summaryRead: true },
      },
      attempts: [attempt("ch_old", 88)],
      wrong: [],
      lastLocation: { chapterId: "ch_old", tab: "learn", updatedAt: 1 },
    };
    const previous = {
      ch_old: { sourcePath: "1-a.md", contentHash: "h1" },
      ch_moved: { sourcePath: "2-b.md", contentHash: "h2" },
    };
    const next = {
      pathToId: { "1-a.md": "ch_new", "9-c.md": "ch_c" },
      hashToId: { h1: "ch_new", h2: "ch_by_hash" },
    };
    const remapped = remapChapterIds(state, previous, next);
    expect(remapped.chapterProgress.ch_new.guideAck).toBe(true);
    expect(remapped.chapterProgress.ch_by_hash.summaryRead).toBe(true);
    expect(remapped.attempts[0].chapterId).toBe("ch_new");
    expect(remapped.lastLocation?.chapterId).toBe("ch_new");
  });
});
