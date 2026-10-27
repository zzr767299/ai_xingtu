export function makeChapterId(sourcePath: string): string;
export function normalizeAnchor(value: string): string;
export function stripMarkdown(value: string): string;
export interface SidebarChapter {
  title: string;
  sourcePath: string;
  groupTitle: string | null;
}
export interface SidebarArea {
  id: string;
  order: number;
  title: string;
  chapters: SidebarChapter[];
  groups: { title: string; chapters: SidebarChapter[] }[];
}
export function parseSidebar(raw: string, options?: { metaPaths?: string[] }): SidebarArea[];
export function areaCode(title: string, order: number): string;
export function cleanAreaTitle(title: string): string;
export function parseGlossary(raw: string): {
  terms: { term: string; summary: string; note: string; refs: { text: string; target: string }[]; group: string }[];
  contrasts: {
    id: string;
    title: string;
    detail: string;
    items?: { name: string; text: string }[];
  }[];
};
export function extractLinks(markdown: string): { text: string; target: string }[];
export function extractImagePaths(markdown: string, chapterSourcePath: string): string[];
