import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/lib/storage/memoryStore";
import { ProgressRepository, parseExportBundle, createEmptyState } from "../src/lib/storage/repo";
import { buildChapterStatuses, computeStudyPoints, resolveResumeTarget } from "../src/lib/domain/rules";
import type { ExamAttempt, StudyProgressState } from "../src/types";
import { chapterMeta } from "./helpers";

function attempt(chapterId: string, total: number, createdAt: number): ExamAttempt {
  return {
    id: `a-${createdAt}`,
    chapterId,
    paperId: "p",
    paperSource: "local",
    createdAt,
    durationMs: 1000,
    studyPoints: 20,
    examScore: total - 20,
    total,
    passed: total >= 60,
    star: total >= 90 ? "gold" : total >= 60 ? "normal" : "failed",
    grades: [],
    answers: {},
    questions: [
      {
        id: "q1",
        type: "choice",
        points: 80,
        prompt: "测试题",
        options: [{ key: "A", text: "正确" }, { key: "B", text: "错误" }],
        answer: "A",
        explanation: "解析",
        difficulty: "easy",
        knowledgePointTitle: "测试知识点",
      },
    ],
    gradedBy: "auto",
  };
}

const chapter = chapterMeta(1);
const chapter2 = chapterMeta(2);

function stateWith(locationUpdatedAt: number): StudyProgressState {
  return {
    chapterProgress: {
      [chapter.id]: {
        chapterId: chapter.id,
        guideAck: true,
        sectionsRead: chapter.sections.map((section) => section.id),
        checks: {},
        summaryRead: false,
        lastSectionId: chapter.sections[1].id,
        updatedAt: locationUpdatedAt,
      },
    },
    attempts: [attempt(chapter.id, 80, 1)],
    wrong: [],
    lastLocation: {
      chapterId: chapter.id,
      sectionId: chapter.sections[1].id,
      tab: "learn",
      updatedAt: locationUpdatedAt,
    },
  };
}

describe("本地持久化与刷新恢复", () => {
  it("保存后重新加载仍能恢复学习位置与成绩", async () => {
    const store = new MemoryStore();
    const repo = new ProgressRepository(store);
    await repo.saveState(stateWith(1000));

    const reloadedRepo = new ProgressRepository(store);
    const reloaded = await reloadedRepo.loadState();
    expect(reloaded.lastLocation?.sectionId).toBe(chapter.sections[1].id);
    expect(reloaded.attempts).toHaveLength(1);
    expect(computeStudyPoints(chapter, reloaded.chapterProgress[chapter.id]).total).toBe(10);

    const statuses = buildChapterStatuses({ chapters: [chapter, chapter2] }, reloaded);
    const target = resolveResumeTarget({ chapters: [chapter, chapter2] }, reloaded, statuses);
    // 第一章 80 分已通关，因此继续目标指向下一章
    expect(target).toMatchObject({ kind: "next", chapterId: chapter2.id });
  });

  it("重新考试保留历史记录，不覆盖旧成绩", async () => {
    const store = new MemoryStore();
    const repo = new ProgressRepository(store);
    const first = stateWith(1000);
    await repo.saveState(first);

    const second: StudyProgressState = {
      ...first,
      attempts: [attempt(chapter.id, 55, 2000), ...first.attempts],
    };
    await repo.saveState(second);

    const reloaded = await repo.loadState();
    expect(reloaded.attempts).toHaveLength(2);
    const statuses = buildChapterStatuses({ chapters: [chapter, chapter2] }, reloaded);
    // 最高分仍为 80（历史最高），不会因低分撤销通关
    expect(statuses[chapter.id].passed).toBe(true);
    expect(statuses[chapter.id].bestTotal).toBe(80);
  });

  it("导出数据可以被严格校验并重新导入", async () => {
    const store = new MemoryStore();
    const repo = new ProgressRepository(store);
    const state = stateWith(1000);
    await repo.saveState(state);
    const bundle = await repo.buildExport(state, "v1", "ai-agents-from-zero");
    const parsed = parseExportBundle(JSON.stringify(bundle));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.bundle.progress.attempts).toHaveLength(1);
      expect(parsed.bundle.progress.lastLocation?.sectionId).toBe(chapter.sections[1].id);
      // 导入后题目元数据不能丢：错题本/成绩详情依赖这些字段
      expect(parsed.bundle.progress.attempts[0].questions[0].knowledgePointTitle).toBe("测试知识点");
    }
  });

  it("拒绝非法格式与不匹配版本", () => {
    expect(parseExportBundle("{not json").ok).toBe(false);
    expect(parseExportBundle(JSON.stringify({ hello: "world" })).ok).toBe(false);
    expect(
      parseExportBundle(
        JSON.stringify({
          schemaVersion: 2,
          exportedAt: 1,
          app: "ai-xingtu",
          courseVersion: "v1",
          courseId: "x",
          progress: createEmptyState(),
        }),
      ).ok,
    ).toBe(false);
  });

  it("导出时默认不包含 API Key", async () => {
    const store = new MemoryStore();
    const repo = new ProgressRepository(store);
    const bundle = await repo.buildExport(stateWith(1), "v1", "course", {
      ai: {
        enabled: true,
        preset: "deepseek",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-secret",
        model: "m",
        useProxy: false,
        proxyUrl: "",
        temperature: 0.4,
        maxTokens: 1000,
        timeoutMs: 30000,
      },
      theme: "dark",
      reduceMotion: false,
      dailyGoalMinutes: 30,
      displayName: "",
    });
    expect(bundle.settings?.ai?.apiKey).toBe("");
  });
});
