import type { ChapterContent, CourseData, Glossary } from "../../types";

const BASE = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const contentCache = new Map<string, Promise<ChapterContent>>();

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}course/${path}`, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`课程数据加载失败（${response.status}）：${path}。请先运行 npm run course:build。`);
  }
  return (await response.json()) as T;
}

let coursePromise: Promise<CourseData> | null = null;
let glossaryPromise: Promise<Glossary> | null = null;

export function loadCourse(): Promise<CourseData> {
  coursePromise ??= fetchJson<CourseData>("course.json");
  return coursePromise;
}

export function loadGlossary(): Promise<Glossary> {
  glossaryPromise ??= fetchJson<Glossary>("glossary.json");
  return glossaryPromise;
}

export function loadChapter(id: string): Promise<ChapterContent> {
  const cached = contentCache.get(id);
  if (cached) return cached;
  const promise = fetchJson<ChapterContent>(`chapters/${id}.json`);
  contentCache.set(id, promise);
  promise.catch(() => contentCache.delete(id));
  return promise;
}

export function clearChapterCache() {
  contentCache.clear();
}
