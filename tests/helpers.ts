import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChapterContent, ChapterMeta, CourseData, Glossary } from "../src/types";

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "course");

let courseCache: CourseData | null = null;

export function loadCourse(): CourseData {
  courseCache ??= JSON.parse(fs.readFileSync(path.join(publicRoot, "course.json"), "utf8")) as CourseData;
  return courseCache;
}

export function loadGlossary(): Glossary {
  return JSON.parse(fs.readFileSync(path.join(publicRoot, "glossary.json"), "utf8")) as Glossary;
}

export function loadChapterContent(id: string): ChapterContent {
  return JSON.parse(fs.readFileSync(path.join(publicRoot, "chapters", `${id}.json`), "utf8")) as ChapterContent;
}

export function chapterMeta(order: number, overrides: Partial<ChapterMeta> = {}): ChapterMeta {
  return {
    id: `ch_test_${order}`,
    areaId: "area-01",
    groupTitle: null,
    order,
    title: `测试章节 ${order}`,
    sourcePath: `${order}-test.md`,
    sourceUrl: `https://example.com/${order}`,
    onlineUrl: `https://example.com/online/${order}`,
    objectives: ["理解测试概念", "能够应用到实际项目"],
    advice: "先读概念再看例子。",
    resources: "",
    estimateMinutes: 20,
    chars: 1200,
    codeBlocks: 0,
    imageCount: 0,
    profile: "concept",
    contentHash: `hash-${order}`,
    sections: [
      { id: `kp_${order}_1`, title: "知识点一", chars: 300 },
      { id: `kp_${order}_2`, title: "知识点二", chars: 300 },
    ],
    terms: ["Token", "RAG"],
    quizCount: 2,
    ...overrides,
  };
}
