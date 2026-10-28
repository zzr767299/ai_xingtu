import { createHash } from "node:crypto";
import path from "node:path";

/** 稳定 ID：由源文件相对路径推导，标题改名、章节重排都不会改变。 */
export function makeChapterId(sourcePath) {
  const normalized = sourcePath.split(path.sep).join("/");
  return `ch_${createHash("sha1").update(normalized).digest("hex").slice(0, 10)}`;
}

/** 去掉 docsify 锚点前缀、大小写、标点与空格差异，用于标题匹配。 */
export function normalizeAnchor(value) {
  return decodeSafe(value)
    .replace(/^_+/, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function stripMarkdown(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** 解析 docsify 侧边栏：0 缩进 = 大关卡，2 = 章节或分组，4 = 分组内章节。 */
export function parseSidebar(raw, { metaPaths = [] } = {}) {
  const metaSet = new Set(metaPaths.map((p) => p.split(path.sep).join("/")));
  const areas = [];
  let area = null;
  let group = null;

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^(\s*)- (.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const body = match[2].trim();
    if (!body) continue;

    const link = body.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

    if (indent === 0) {
      if (link) continue; // 顶层的首页/术语表等元文档不属于关卡
      area = { title: body, chapters: [], groups: [] };
      areas.push(area);
      group = null;
      continue;
    }

    if (!area) continue;

    if (indent === 2) {
      if (link) {
        const sourcePath = link[2].split(path.sep).join("/");
        if (metaSet.has(sourcePath)) continue;
        const chapter = { title: link[1].trim(), sourcePath, groupTitle: null };
        area.chapters.push(chapter);
        group = null;
      } else {
        group = { title: body, chapters: [] };
        area.groups.push(group);
      }
      continue;
    }

    if (indent >= 4 && link && group) {
      const sourcePath = link[2].split(path.sep).join("/");
      if (metaSet.has(sourcePath)) continue;
      const chapter = { title: link[1].trim(), sourcePath, groupTitle: group.title };
      area.chapters.push(chapter);
      group.chapters.push(chapter);
    }
  }

  return areas.map((item, index) => ({
    ...item,
    id: `area-${String(index + 1).padStart(2, "0")}`,
    order: index + 1,
  }));
}

export function areaCode(title, order) {
  const match = title.match(/^(\d{2})\b/);
  return match ? match[1] : String(order).padStart(2, "0");
}

export function cleanAreaTitle(title) {
  return title.replace(/^\d{2}\s*[、.]?\s*/, "").trim();
}

/** 解析术语表：四列表格 + 第 15 节的概念对照。 */
export function parseGlossary(raw) {
  const lines = raw.split(/\r?\n/);
  const terms = [];
  const contrasts = [];
  let currentH2 = "";
  let currentH3 = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      currentH2 = h2[1].trim();
      currentH3 = "";
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      currentH3 = h3[1].trim();
    }

    if (line.trim().startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i += 1;
      }
      const rows = tableLines
        .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
        .filter((cells) => !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
      if (rows.length > 1) {
        const header = rows[0];
        if (header[0] === "术语" && header.length >= 4) {
          for (const cells of rows.slice(1)) {
            const term = stripMarkdown(cells[0]);
            if (!term) continue;
            terms.push({
              term,
              summary: stripMarkdown(cells[1] || ""),
              note: stripMarkdown(cells[2] || ""),
              refs: extractLinks(cells[3] || ""),
              group: currentH2,
            });
          }
        } else if (header[0] === "容易混淆的概念") {
          for (const cells of rows.slice(1)) {
            contrasts.push({
              id: `cx_${terms.length}_${contrasts.length}`,
              title: stripMarkdown(cells[0]),
              detail: stripMarkdown(cells[1] || ""),
            });
          }
        }
      }
      continue;
    }

    if (currentH2.startsWith("15") && currentH3) {
      // 去掉「15.5 」这类小节编号，才能与第 3 节的速查表标题合并
      const contrastTitle = currentH3.replace(/^\d+(\.\d+)?\s*[、.]?\s*/, "");
      const bullet = line.match(/^-\s+\*\*(.+?)\*\*[：:]\s*(.+)$/);
      if (bullet) {
        let contrast = contrasts.find((item) => item.title === contrastTitle);
        if (!contrast) {
          contrast = { id: `cx_${contrasts.length}`, title: contrastTitle, items: [], detail: "" };
          contrasts.push(contrast);
        }
        contrast.items ??= [];
        contrast.items.push({ name: stripMarkdown(bullet[1].trim()), text: stripMarkdown(bullet[2].trim()) });
      }
      const oneLine = line.match(/^一句话判断[：:]\s*(.+)$/);
      if (oneLine) {
        let contrast = contrasts.find((item) => item.title === contrastTitle);
        if (!contrast) {
          contrast = { id: `cx_${contrasts.length}`, title: contrastTitle, items: [], detail: "" };
          contrasts.push(contrast);
        }
        contrast.detail = stripMarkdown(oneLine[1].trim());
      }
    }

    i += 1;
  }

  const seen = new Set();
  const merged = new Map();
  for (const contrast of contrasts) {
    const key = contrast.title.toLowerCase().replace(/\s+/g, "");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...contrast,
        items: contrast.items ? [...contrast.items] : undefined,
      });
      continue;
    }
    const items = [...(existing.items ?? [])];
    for (const item of contrast.items ?? []) {
      if (!items.some((candidate) => candidate.name === item.name)) items.push(item);
    }
    merged.set(key, {
      ...existing,
      detail:
        (contrast.detail?.length ?? 0) > (existing.detail?.length ?? 0)
          ? contrast.detail
          : existing.detail,
      items: items.length ? items : undefined,
    });
  }

  return {
    terms: terms.filter((item) => {
      const key = item.term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    contrasts: [...merged.values()],
  };
}

export function extractLinks(markdown) {
  const result = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(markdown))) {
    const target = match[2];
    if (!/^https?:\/\//.test(target)) {
      result.push({ text: match[1], target: target.split("#")[0] });
    }
  }
  return result;
}

/** 课程正文里被引用的图片（相对仓库根目录的 posix 路径）。 */
export function extractImagePaths(markdown, chapterSourcePath) {
  const dir = path.posix.dirname(chapterSourcePath);
  const paths = [];
  const regex = /!\[[^\]]*\]\(([^)\s]+)/g;
  let match;
  while ((match = regex.exec(markdown))) {
    const src = match[1];
    if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) continue;
    paths.push(path.posix.normalize(path.posix.join(dir, src)));
  }
  return paths;
}
