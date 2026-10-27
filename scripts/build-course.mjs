import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { marked } from "marked";
import {
  areaCode,
  cleanAreaTitle,
  extractImagePaths,
  makeChapterId,
  normalizeAnchor,
  parseGlossary,
  parseSidebar,
  stripMarkdown,
} from "./course-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = process.env.COURSE_REPO
  ? path.resolve(process.env.COURSE_REPO)
  : path.resolve(projectRoot, "..", "ai-agents-from-zero");
const outRoot = path.join(projectRoot, "public", "course");
const chaptersOut = path.join(outRoot, "chapters");

const META_PATHS = [
  "README.md",
  "教程目录大纲.md",
  "全书术语表.md",
  "教程案例链接汇总.md",
  "新手入门与常见问题.md",
  "工具导航与参考资料索引.md",
  "AI智能体与大模型应用开发面试题库.md",
  "教程更新日志.md",
];

if (!fs.existsSync(repoRoot)) {
  console.error(`找不到课程仓库：${repoRoot}`);
  process.exit(1);
}

const read = (relPath) => fs.readFileSync(path.join(repoRoot, relPath), "utf8");

/* ---------------- 第一遍：解析章节结构与原始 token ---------------- */

const sidebar = read("_sidebar.md");
const areas = parseSidebar(sidebar, { metaPaths: META_PATHS });

let order = 0;
const chapters = [];

for (const area of areas) {
  for (const entry of area.chapters) {
    order += 1;
    const raw = read(entry.sourcePath);
    const tokens = marked.lexer(raw);
    const { preambleTokens, sections } = splitTokens(tokens);
    const fields = parsePreamble(raw, preambleTokens);
    const text = stripHtml(raw);
    const codeBlocks = tokens.filter((t) => t.type === "code").length;
    const chapter = {
      ...entry,
      id: makeChapterId(entry.sourcePath),
      areaId: area.id,
      areaTitle: cleanAreaTitle(area.title),
      order,
      raw,
      tokens,
      preambleTokens,
      sections,
      fields,
      codeBlocks,
      imagePaths: extractImagePaths(raw, entry.sourcePath),
      chars: countChars(text),
      plainText: text,
    };
    chapters.push(chapter);
  }
}

// 章节按源路径索引，供链接改写使用
const chapterByPath = new Map(chapters.map((chapter) => [chapter.sourcePath, chapter]));
const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));

/* ---------------- 术语表 ---------------- */

const glossary = parseGlossary(read("全书术语表.md"));

for (const chapter of chapters) {
  const haystack = chapter.plainText.toLowerCase();
  const anchoredText = `${chapter.title} ${chapter.sections.map((section) => section.title).join(" ")} ${chapter.fields.objectives.join(" ")}`.toLowerCase();
  const matched = glossary.terms
    .filter((term) => {
      const inRef = term.refs.some((ref) => path.posix.normalize(ref.target) === chapter.sourcePath);
      const needle = term.term.toLowerCase();
      const count = needle.length >= 2 ? haystack.split(needle).length - 1 : 0;
      // 只保留术语表明确指向本章，或在标题/目标/高频正文中真正出现的术语
      return inRef || (count >= 4 && (anchoredText.includes(needle) || count >= 10));
    })
    .sort((a, b) => b.term.length - a.term.length)
    .slice(0, 18);
  chapter.terms = matched.map((term) => term.term);
}

/* ---------------- 锚点映射 ---------------- */

function buildAnchorMap(chapter) {
  const map = new Map();
  for (const section of chapter.sections) {
    map.set(normalizeAnchor(section.title), section.id);
    for (const sub of section.subheadings) {
      map.set(normalizeAnchor(sub.title), section.id);
    }
  }
  return map;
}

const anchorMaps = new Map(chapters.map((chapter) => [chapter.id, buildAnchorMap(chapter)]));

/* ---------------- 第二遍：渲染 HTML 并改写链接 ---------------- */

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(chaptersOut, { recursive: true });

const chapterMetas = [];
let totalBlocks = 0;

for (const chapter of chapters) {
  const ctx = { chapter, chapterByPath };
  const introBlocks = renderBlocks(chapter.fields.preambleTokens, ctx).filter(
    (block) => block.k !== "hr" && (block.text ?? "").trim().length > 0,
  );

  const sections = chapter.sections.map((section) => {
    const blocks = renderBlocks(section.tokens, ctx);
    totalBlocks += blocks.length;
    return {
      id: section.id,
      title: section.title,
      subheadings: section.subheadings.map((sub) => ({ id: sub.id, title: sub.title })),
      chars: countChars(blocks.map((block) => block.text ?? "").join(" ")),
      blocks,
    };
  });

  const content = {
    schemaVersion: 1,
    id: chapter.id,
    contentHash: chapter.fields.contentHash,
    intro: introBlocks,
    sections,
  };
  fs.writeFileSync(path.join(chaptersOut, `${chapter.id}.json`), JSON.stringify(content));

  const minutes = Math.max(4, Math.round(chapter.chars / 320));
  chapterMetas.push({
    id: chapter.id,
    areaId: chapter.areaId,
    groupTitle: chapter.groupTitle,
    order: chapter.order,
    title: chapter.title,
    sourcePath: chapter.sourcePath,
    sourceUrl: `https://github.com/didilili/ai-agents-from-zero/blob/main/${encodeURI(chapter.sourcePath)}`,
    onlineUrl: `https://didilili.github.io/ai-agents-from-zero/#/${encodeURI(chapter.sourcePath.replace(/\.md$/, ""))}`,
    objectives: chapter.fields.objectives,
    advice: chapter.fields.advice,
    resources: chapter.fields.resources,
    estimateMinutes: minutes,
    chars: chapter.chars,
    codeBlocks: chapter.codeBlocks,
    imageCount: new Set(chapter.imagePaths).size,
    profile: chapter.codeBlocks >= 6 ? "code-heavy" : chapter.codeBlocks >= 2 ? "mixed" : "concept",
    contentHash: chapter.fields.contentHash,
    sections: sections.map((section) => ({ id: section.id, title: section.title, chars: section.chars })),
    terms: chapter.terms ?? [],
    quizCount: Math.max(2, Math.min(6, Math.round(sections.length / 2))),
  });
}

/* ---------------- 课程总表 ---------------- */

const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const now = new Date().toISOString();
const course = {
  schemaVersion: 1,
  courseId: "ai-agents-from-zero",
  title: "AI 智能体实战速成指南",
  version: `${commit.slice(0, 8)}-${now.slice(0, 10)}`,
  generatedAt: now,
  commit,
  source: {
    repo: "https://github.com/didilili/ai-agents-from-zero",
    site: "https://didilili.github.io/ai-agents-from-zero/#/",
    license: "MIT",
    copyright: "didilili",
  },
  stats: {
    areas: areas.length,
    chapters: chapterMetas.length,
    chars: chapters.reduce((sum, chapter) => sum + chapter.chars, 0),
    blocks: totalBlocks,
  },
  areas: areas.map((area) => ({
    id: area.id,
    order: area.order,
    code: areaCode(area.title, area.order),
    title: cleanAreaTitle(area.title),
    fullTitle: area.title,
    groups: area.groups.map((group) => ({
      title: group.title,
      chapterIds: group.chapters.map((chapter) => makeChapterId(chapter.sourcePath)),
    })),
    chapterIds: area.chapters.map((chapter) => makeChapterId(chapter.sourcePath)),
  })),
  chapters: chapterMetas,
};

fs.writeFileSync(path.join(outRoot, "course.json"), JSON.stringify(course, null, 0));
fs.writeFileSync(path.join(outRoot, "glossary.json"), JSON.stringify(glossary, null, 0));

/* ---------------- 工具函数 ---------------- */

function splitTokens(tokens) {
  const preambleTokens = [];
  const sections = [];
  let current = null;

  for (const token of tokens) {
    if (token.type === "heading" && token.depth === 1) continue;
    if (token.type === "heading" && token.depth === 2) {
      current = {
        id: `kp_${hash(token.text).slice(0, 8)}`,
        title: stripMarkdown(token.text),
        tokens: [],
        subheadings: [],
      };
      sections.push(current);
      continue;
    }
    if (token.type === "heading" && token.depth === 3 && current) {
      const sub = { id: `sub_${hash(token.text).slice(0, 8)}`, title: stripMarkdown(token.text) };
      current.subheadings.push(sub);
      current.tokens.push({ ...token, __anchorId: sub.id });
      continue;
    }
    (current ? current.tokens : preambleTokens).push(token);
  }

  // 章节ID 冲突兜底
  const seen = new Set();
  for (const section of sections) {
    let id = section.id;
    let suffix = 1;
    while (seen.has(id)) id = `${section.id}_${suffix++}`;
    seen.add(id);
    section.id = id;
  }

  return { preambleTokens, sections };
}

function parsePreamble(raw, preambleTokens) {
  const objectives = [];
  const objectiveBlock = raw.match(/本章课程目标[：:]\s*([\s\S]*?)(?=\n\*\*学习建议|\n\*\*官方文档|\n---|\n## )/);
  if (objectiveBlock) {
    for (const line of objectiveBlock[1].split(/\r?\n/)) {
      const item = line.match(/^\s*[-*]\s+(.+)$/);
      if (item) objectives.push(stripMarkdown(item[1]));
    }
  }

  const adviceMatch = raw.match(/\*\*学习建议[：:]\*\*\s*([^\n]+)/);
  const resourcesMatch = raw.match(/\*\*官方文档与资源[：:]\*\*\s*([^\n]+)/);

  // 导读字段已结构化，从正文 intro 中剔除，避免重复
  const filtered = [];
  for (let index = 0; index < preambleTokens.length; index += 1) {
    const token = preambleTokens[index];
    const text = token.raw ?? "";
    if (/本章课程目标/.test(text)) {
      // 目标列表紧跟在标题段落之后（中间可能有空行 token），一并剔除
      let lookahead = index + 1;
      while (preambleTokens[lookahead]?.type === "space") lookahead += 1;
      if (preambleTokens[lookahead]?.type === "list") index = lookahead;
      continue;
    }
    if (/学习建议|官方文档与资源/.test(text)) continue;
    filtered.push(token);
  }

  return {
    objectives,
    advice: adviceMatch ? stripMarkdown(adviceMatch[1]) : "",
    resources: resourcesMatch ? stripMarkdown(resourcesMatch[1]) : "",
    preambleTokens: filtered,
    contentHash: hash(raw),
  };
}

function renderBlocks(tokens, ctx) {
  const blocks = [];

  for (const token of tokens) {
    if (token.type === "space") continue;

    if (token.type === "heading" && token.depth === 3) {
      const anchorId = token.__anchorId ?? `sub_${hash(token.text).slice(0, 8)}`;
      const inner = marked.parseInline(token.text);
      blocks.push({
        k: "h3",
        html: redactSecrets(`<h3 id="${anchorId}">${inner}</h3>`),
        text: stripMarkdown(token.text),
      });
      continue;
    }

    if (token.type === "code") {
      const safeCode = redactSecrets(token.text);
      blocks.push({
        k: "code",
        lang: token.lang || "text",
        code: safeCode,
        text: safeCode,
      });
      continue;
    }

    if (token.type === "paragraph") {
      const inline = token.tokens ?? [];
      if (inline.length === 1 && inline[0].type === "image") {
        const image = inline[0];
        blocks.push({
          k: "img",
          src: redactSecrets(resolveImage(image.href, ctx)),
          alt: redactSecrets(image.text || ""),
          text: redactSecrets(image.text || ""),
        });
        continue;
      }
    }

    const html = rewriteHtml(marked.parser([token]), ctx);
    const kind = token.type === "list" ? (token.ordered ? "ol" : "ul") : token.type;
    blocks.push({
      k: kind === "blockquote" ? "quote" : kind,
      html,
      text: htmlToText(html),
    });
  }

  return blocks;
}

/**
 * 课程原文中可能包含已过期的云存储预签名链接或示例密钥（例如火山 TOS 的
 * X-Tos-Credential / Access Key ID）。公开仓库推送会被 GitHub 密钥扫描拦截，
 * 因此在构建阶段统一脱敏；这些链接本身也已失效，不影响学习。
 */
function redactSecrets(value) {
  return value
    .replace(/\bAKLT[A-Za-z0-9_-]{8,}/g, "AKLT_REDACTED")
    .replace(/(X-Tos-Credential=)[^&"'\s]+/gi, "$1REDACTED")
    .replace(/(X-Tos-Signature=)[^&"'\s]+/gi, "$1REDACTED")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-REDACTED");
}

function rewriteHtml(html, ctx) {
  return redactSecrets(html.replace(/\b(href|src)="([^"]*)"/g, (full, attr, value) => {
    if (!value || /^(https?:|mailto:|data:|blob:|\/\/|\/)/i.test(value)) return full;

    if (attr === "src") {
      const src = resolveImage(value, ctx);
      return src ? `${attr}="${src}"` : full;
    }

    if (!value.startsWith("#")) {
      const [pathPart, anchorPart] = value.split("#");
      if (/\.md$/i.test(pathPart)) {
        const target = resolveChapter(pathPart, ctx);
        if (target) {
          const anchor = anchorPart ? anchorMaps.get(target.id)?.get(normalizeAnchor(anchorPart)) : null;
          const suffix = anchor ? `?s=${anchor}` : "";
          return `${attr}="#/learn/${target.id}${suffix}"`;
        }
        return `${attr}="${metaDocUrl(pathPart)}"`;
      }
      // 案例源码等仓库内文件，指向 GitHub 原文
      if (attr === "href") {
        const repoUrl = repoFileUrl(pathPart, ctx);
        if (repoUrl) return `${attr}="${repoUrl}"`;
      }
      return full;
    }

    if (!value.startsWith("#/")) {
      const anchor = anchorMaps.get(ctx.chapter.id)?.get(normalizeAnchor(value.slice(1)));
      if (anchor) return `${attr}="#/learn/${ctx.chapter.id}?s=${anchor}"`;
    }
    return full;
  }));
}

function resolveChapter(pathPart, ctx) {
  const decoded = safeDecode(pathPart);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.chapter.sourcePath), decoded));
  return chapterByPath.get(resolved);
}

function resolveImage(value, ctx) {
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value;
  const decoded = safeDecode(value);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.chapter.sourcePath), decoded));
  return `/course-assets/${encodeURI(resolved)}`;
}

function repoFileUrl(pathPart, ctx) {
  const decoded = safeDecode(pathPart);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(ctx.chapter.sourcePath), decoded));
  const absolute = path.join(repoRoot, resolved);
  if (!absolute.startsWith(repoRoot)) return null;
  if (!fs.existsSync(absolute)) return null;
  const base = "https://github.com/didilili/ai-agents-from-zero";
  try {
    const isDir = fs.statSync(absolute).isDirectory();
    return `${base}/${isDir ? "tree" : "blob"}/main/${encodeURI(resolved)}`;
  } catch {
    return null;
  }
}

function metaDocUrl(pathPart) {
  const clean = safeDecode(pathPart).replace(/\.md$/i, "");
  return `https://didilili.github.io/ai-agents-from-zero/#/${encodeURI(clean)}`;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return htmlToText(value);
}

function countChars(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z][A-Za-z0-9_.-]*/g) ?? []).length;
  return cjk + latin * 2;
}

function hash(value) {
  // 与 course-lib 中保持一致即可，这里只需要稳定短哈希
  let h1 = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h1 ^= value.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + value.length.toString(16);
}

console.log(
  `课程构建完成：${areaCount()} 个大关卡 / ${chapterMetas.length} 个章节 / ${totalBlocks} 个内容块`,
);
console.log(`输出目录：${outRoot}`);
console.log(`课程版本：${course.version}`);

function areaCount() {
  return areas.length;
}
