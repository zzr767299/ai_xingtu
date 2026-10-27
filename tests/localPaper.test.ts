import { describe, expect, it } from "vitest";
import { validatePaper } from "../src/lib/domain/exam";
import {
  buildLocalGuide,
  buildLocalSummary,
  buildStudyCheck,
  generateLocalPaper,
} from "../src/lib/domain/localContent";
import { loadChapterContent, loadCourse, loadGlossary } from "./helpers";

const course = loadCourse();
const glossary = loadGlossary();

describe("真实课程数据上的本地内容生产", () => {
  it("所有章节都能生成严格 80 分的合法试卷", () => {
    for (const chapter of course.chapters) {
      const content = loadChapterContent(chapter.id);
      const questions = generateLocalPaper(chapter, content, glossary);
      const validation = validatePaper(questions, 80);
      expect(validation.ok, `${chapter.title}：${validation.errors.join("；")}`).toBe(true);
      expect(questions.reduce((sum, question) => sum + question.points, 0)).toBe(80);
    }
  });

  it("每份试卷的主观题都带可执行评分细则", () => {
    for (const chapter of course.chapters) {
      const content = loadChapterContent(chapter.id);
      const questions = generateLocalPaper(chapter, content, glossary);
      for (const question of questions) {
        if (question.type === "choice" || question.type === "fill") continue;
        expect(question.rubric?.criteria.length ?? 0, `${chapter.title} / ${question.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("导读包含来自原文的目标、概念与考试计划", () => {
    for (const chapter of course.chapters.slice(0, 12)) {
      const guide = buildLocalGuide(chapter);
      expect(guide.goals.length).toBeGreaterThan(0);
      expect(guide.concepts.length).toBeGreaterThan(0);
      expect(guide.order.length).toBe(chapter.sections.length);
      expect(guide.examPlan).toContain("80");
      expect(guide.minutes).toBeGreaterThanOrEqual(4);
      expect(guide.source).toBe("local");
    }
  });

  it("总结覆盖全部知识点并生成结构图", () => {
    for (const chapter of course.chapters.slice(0, 12)) {
      const content = loadChapterContent(chapter.id);
      const summary = buildLocalSummary(chapter, content, glossary);
      expect(summary.corePoints.length).toBe(content.sections.length);
      expect(summary.mindmap.label).toBe(chapter.title);
      expect(summary.checklist.length).toBe(content.sections.length);
      expect(summary.source).toBe("local");
    }
  });

  it("每节学习检查都有四个选项且答案在选项中", () => {
    for (const chapter of course.chapters.slice(0, 16)) {
      const content = loadChapterContent(chapter.id);
      for (const section of content.sections) {
        const check = buildStudyCheck(chapter, section, glossary, content.sections);
        expect(check.options).toHaveLength(4);
        expect(check.options.some((option) => option.key === check.answer)).toBe(true);
        expect(new Set(check.options.map((option) => option.text)).size).toBe(4);
      }
    }
  });
});
