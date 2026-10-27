import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeChapterId } from "../scripts/course-lib.mjs";
import { upstreamImageUrl } from "../src/lib/course/assets";
import { loadChapterContent, loadCourse, loadGlossary } from "./helpers";

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "course");

describe("课程数据完整性", () => {
  const course = loadCourse();
  const glossary = loadGlossary();

  it("包含 5 个大关卡与 78 个章节", () => {
    expect(course.areas).toHaveLength(5);
    expect(course.chapters).toHaveLength(78);
    expect(course.stats.chapters).toBe(78);
  });

  it("大关卡引用覆盖所有章节且顺序连续", () => {
    const ids = course.areas.flatMap((area) => area.chapterIds);
    expect(ids).toHaveLength(78);
    expect(new Set(ids).size).toBe(78);
    const sorted = [...course.chapters].sort((a, b) => a.order - b.order);
    expect(sorted.map((chapter) => chapter.order)).toEqual(Array.from({ length: 78 }, (_, index) => index + 1));
  });

  it("章节 ID 由源路径稳定推导，改标题不会改变", () => {
    for (const chapter of course.chapters) {
      expect(chapter.id).toBe(makeChapterId(chapter.sourcePath));
    }
  });

  it("每章都有知识点与正文文件（个别原文未提供课程目标）", () => {
    for (const chapter of course.chapters) {
      const file = path.join(publicRoot, "chapters", `${chapter.id}.json`);
      expect(fs.existsSync(file), `${chapter.title} 缺少内容文件`).toBe(true);
      const content = loadChapterContent(chapter.id);
      expect(content.id).toBe(chapter.id);
      expect(content.contentHash).toBe(chapter.contentHash);
      expect(content.sections.length).toBeGreaterThan(0);
      expect(chapter.sections.length).toBe(content.sections.length);
      if (chapter.objectives.length === 0) {
        // 原文个别章节没有「本章课程目标」，本地导读会从知识点结构推导
        expect(content.sections.length).toBeGreaterThan(0);
      }
    }
  });

  it("正文链接已改写为站内路由，图片指向课程素材目录", () => {
    for (const chapter of course.chapters.slice(0, 30)) {
      const content = loadChapterContent(chapter.id);
      const html = [content.intro, ...content.sections.map((section) => section.blocks)]
        .flat()
        .map((block) => block.html ?? "")
        .join("\n");
      expect(html, `${chapter.title} 仍有 .md 链接`).not.toMatch(/href="[^"]+\.md/);
      const imageBlocks = [content.intro, ...content.sections.map((section) => section.blocks)]
        .flat()
        .filter((block) => block.k === "img");
      for (const block of imageBlocks) {
        expect(
          block.src?.startsWith("/course-assets/") || /^https?:\/\//.test(block.src ?? ""),
        ).toBe(true);
      }
    }
  });

  it("术语表解析出术语与易混对照", () => {
    expect(glossary.terms.length).toBeGreaterThan(150);
    expect(glossary.contrasts.length).toBeGreaterThan(15);
    expect(glossary.terms.find((term) => term.term === "Checkpoint")).toBeTruthy();
  });

  it("本地缺失的课程图片能映射到上游 raw 地址", () => {
    expect(upstreamImageUrl("/course-assets/images/1-1/a.jpg")).toBe(
      "https://raw.githubusercontent.com/didilili/ai-agents-from-zero/main/images/1-1/a.jpg",
    );
    expect(upstreamImageUrl("https://example.com/a.jpg")).toBeNull();
    expect(upstreamImageUrl("images/a.jpg")).toBeNull();
    expect(upstreamImageUrl(undefined)).toBeNull();
  });

  it("课程来源与许可是 MIT", () => {
    expect(course.source.license).toBe("MIT");
    expect(course.source.repo).toContain("ai-agents-from-zero");
  });
});
