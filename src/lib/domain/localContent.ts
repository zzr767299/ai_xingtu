import type {
  ChapterContent,
  ChapterMeta,
  ChapterSection,
  ExamQuestion,
  Glossary,
  QuestionType,
} from "../../types";
import { EXAM_TEMPLATES, selectTemplate, templateTotal } from "../domain/exam";

export interface ChapterGuide {
  value: string;
  goals: string[];
  concepts: string[];
  prerequisites: string[];
  order: string[];
  minutes: number;
  examPlan: string;
  source: "ai" | "local";
  generatedAt: number;
  note?: string;
}

export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

export interface ChapterSummary {
  corePoints: { title: string; detail: string }[];
  mindmap: MindmapNode;
  termCards: { term: string; summary: string; note: string }[];
  contrasts: { title: string; detail: string; items?: { name: string; text: string }[] }[];
  codeHighlights: { title: string; lang: string; code: string; note: string }[];
  scenarios: string[];
  pitfalls: { title: string; detail: string }[];
  examPoints: string[];
  checklist: string[];
  source: "ai" | "local";
  generatedAt: number;
  note?: string;
}

export interface StudyCheck {
  id: string;
  sectionId: string;
  prompt: string;
  options: { key: string; text: string }[];
  answer: string;
  explanation: string;
}

const STOP_TERMS = new Set(["模型", "数据", "问题", "系统", "方法", "使用", "可以", "需要"]);

export function buildLocalGuide(
  chapter: ChapterMeta,
  previousChapterTitle?: string,
): ChapterGuide {
  const template = selectTemplate(chapter);
  const sectionTitles = chapter.sections.map((section) => section.title);
  const value =
    chapter.advice ||
    `本章共 ${sectionTitles.length} 个知识点，围绕「${sectionTitles.slice(0, 3).join("」「")}」展开，建议按顺序阅读并完成每节检查。`;

  const goals =
    chapter.objectives.length > 0
      ? chapter.objectives
      : sectionTitles.map((title) => `掌握「${title}」的核心概念、使用场景与常见误区`);

  const concepts =
    chapter.terms.length > 0
      ? chapter.terms.slice(0, 10)
      : sectionTitles.slice(0, 8);

  return {
    value,
    goals,
    concepts,
    prerequisites: previousChapterTitle
      ? [`建议先完成「${previousChapterTitle}」`]
      : ["无前置章节，适合作为起点"],
    order: sectionTitles,
    minutes: chapter.estimateMinutes,
    examPlan: `${template.label}试卷：满分 80 分（${template.slots
      .map((slot) => `${slot.count} 题 × ${slot.points} 分`)
      .join(" + ")}）；学习任务 20 分，总分达到 60 分通关。`,
    source: "local",
    generatedAt: Date.now(),
    note: chapter.objectives.length > 0 ? "学习目标直接取自原文「本章课程目标」" : "学习目标由章节结构推导",
  };
}

export function buildLocalSummary(
  chapter: ChapterMeta,
  content: ChapterContent,
  glossary: Glossary,
): ChapterSummary {
  const corePoints = content.sections.map((section) => ({
    title: section.title,
    detail: firstMeaningfulSentence(section) || section.title,
  }));

  const termCards = collectTermCards(chapter, glossary);
  const contrasts = glossary.contrasts
    .filter((contrast) => {
      const text = `${contrast.title} ${contrast.detail} ${(contrast.items ?? [])
        .map((item) => `${item.name} ${item.text}`)
        .join(" ")}`;
      return chapter.terms.some((term) => text.includes(term));
    })
    .slice(0, 6)
    .map((contrast) => ({
      title: contrast.title,
      detail: contrast.detail,
      items: contrast.items,
    }));

  const codeHighlights: ChapterSummary["codeHighlights"] = [];
  const pitfalls: ChapterSummary["pitfalls"] = [];
  const scenarios: string[] = [];

  for (const section of content.sections) {
    for (const block of section.blocks) {
      if (block.k === "code" && codeHighlights.length < 4 && (block.code ?? "").split("\n").length >= 3) {
        codeHighlights.push({
          title: section.title,
          lang: block.lang ?? "text",
          code: (block.code ?? "").slice(0, 900),
          note: "代码摘自章节原文，可对照原文深入阅读。",
        });
      }
    }

    const text = sectionText(section);
    const pitfallSentence = sentences(text).find((sentence) =>
      /注意|误区|坑|报错|避免|错误|失败|常见问题/.test(sentence),
    );
    if (pitfallSentence && pitfalls.length < 4) {
      pitfalls.push({ title: section.title, detail: pitfallSentence });
    }

    const scenarioSentence = sentences(text).find((sentence) =>
      /项目|实战|业务|场景|落地|企业/.test(sentence),
    );
    if (scenarioSentence && scenarios.length < 4) scenarios.push(scenarioSentence);
  }

  const mindmap: MindmapNode = {
    label: chapter.title,
    children: content.sections.map((section) => ({
      label: section.title,
      children: section.subheadings.slice(0, 6).map((sub) => ({ label: sub.title })),
    })),
  };

  return {
    corePoints,
    mindmap,
    termCards,
    contrasts,
    codeHighlights,
    scenarios: scenarios.length ? scenarios : [chapter.advice].filter(Boolean),
    pitfalls: pitfalls.length
      ? pitfalls
      : [{ title: "常见错误", detail: "本地总结未在原文中定位到明确的踩坑段落，请结合各节正文与原文链接复习。" }],
    examPoints: [...new Set([...chapter.sections.map((section) => section.title), ...chapter.terms.slice(0, 6)])],
    checklist: chapter.sections.map((section) => `我能用自己的话解释「${section.title}」并说出它的使用场景`),
    source: "local",
    generatedAt: Date.now(),
    note: "本地总结由章节结构、术语表与原文句子生成，未调用模型",
  };
}

function collectTermCards(chapter: ChapterMeta, glossary: Glossary) {
  const cards: ChapterSummary["termCards"] = [];
  for (const term of chapter.terms) {
    const found = glossary.terms.find((item) => item.term === term);
    if (found) {
      cards.push({ term: found.term, summary: found.summary, note: found.note });
    }
    if (cards.length >= 8) break;
  }
  return cards;
}

export function buildStudyCheck(
  chapter: ChapterMeta,
  section: ChapterSection,
  glossary: Glossary,
  chapterSections: ChapterSection[],
): StudyCheck {
  const sectionTextValue = sectionText(section);
  const candidates = sentences(sectionTextValue).filter((sentence) =>
    chapter.terms.some((term) => sentence.includes(term)),
  );

  if (candidates.length > 0) {
    const sentence = candidates[0];
    const term = [...chapter.terms]
      .sort((a, b) => b.length - a.length)
      .find((item) => sentence.includes(item));
    if (term) {
      const distractors = glossary.terms
        .map((item) => item.term)
        .filter((item) => item !== term && !sentence.includes(item) && !STOP_TERMS.has(item))
        .slice(0, 30);
      const options = buildOptions(term, distractors, section.id);
      return {
        id: `check_${section.id}`,
        sectionId: section.id,
        prompt: `回顾原文，补全下面的关键术语：\n\n「${sentence.replaceAll(term, "______")}」`,
        options,
        answer: options.find((option) => option.text === term)?.key ?? "A",
        explanation: `原文：${sentence}`,
      };
    }
  }

  const others = chapterSections
    .filter((item) => item.id !== section.id)
    .map((item) => item.title)
    .slice(0, 3);
  const options = buildOptions(section.title, others, section.id + "title");
  return {
    id: `check_${section.id}`,
    sectionId: section.id,
    prompt: "本节主要讨论的主题是：",
    options,
    answer: options.find((option) => option.text === section.title)?.key ?? "A",
    explanation: `本节标题为「${section.title}」。`,
  };
}

function buildOptions(answer: string, distractors: string[], seed: string) {
  const unique = [...new Set(distractors.filter((item) => item && item !== answer))].slice(0, 3);
  while (unique.length < 3) unique.push(`以上都不是（${unique.length + 1}）`);

  const items = seededShuffle([answer, ...unique], seed);
  const keys = ["A", "B", "C", "D"];
  return items.map((text, index) => ({ key: keys[index], text }));
}

export function generateLocalPaper(
  chapter: ChapterMeta,
  content: ChapterContent,
  glossary: Glossary,
): ExamQuestion[] {
  const template = selectTemplate(chapter);
  const questions: ExamQuestion[] = [];
  const usedSentences = new Set<string>();
  const usedTerms = new Set<string>();
  const usedContrasts = new Set<string>();
  const codeBlocks = collectCodeBlocks(content);
  let codeCursor = 0;

  const nextId = (type: QuestionType) => `q_${chapter.id}_${type}_${questions.length + 1}`;

  for (const slot of template.slots) {
    for (let index = 0; index < slot.count; index += 1) {
      const question =
        slot.type === "choice"
          ? makeChoice(chapter, content, glossary, slot.points, usedSentences, usedTerms, nextId)
          : slot.type === "fill"
            ? makeFill(chapter, glossary, slot.points, usedTerms, nextId)
            : slot.type === "contrast"
              ? makeContrast(chapter, glossary, slot.points, nextId, usedContrasts)
              : slot.type === "code-read"
                ? makeCodeRead(codeBlocks, codeCursor++, slot.points, nextId)
                : slot.type === "code-fill"
                  ? makeCodeFill(codeBlocks, codeCursor++, slot.points, nextId)
                  : slot.type === "application"
                    ? makeApplication(chapter, content, slot.points, nextId)
                    : slot.type === "practice"
                      ? makePractice(chapter, slot.points, nextId)
                      : makeDesign(chapter, content, slot.points, nextId);

      if (question) questions.push(question);
    }
  }

  // 兜底：若内容不足以支撑某类题目，用综合设计题补齐，保证总分仍为 80。
  // variant 让每道补充题换一个设计视角，避免出现完全相同的题干。
  let designVariant = questions.filter((question) => question.type === "design").length;
  while (questions.reduce((sum, question) => sum + question.points, 0) < 80) {
    const missing = 80 - questions.reduce((sum, question) => sum + question.points, 0);
    const points = missing >= 10 ? 10 : missing;
    questions.push(makeDesign(chapter, content, points, nextId, designVariant++));
  }

  return questions;
}

function makeChoice(
  chapter: ChapterMeta,
  content: ChapterContent,
  glossary: Glossary,
  points: number,
  usedSentences: Set<string>,
  usedTerms: Set<string>,
  nextId: (type: QuestionType) => string,
): ExamQuestion | null {
  for (const section of content.sections) {
    const candidates = sentences(sectionText(section)).filter(
      (sentence) =>
        !usedSentences.has(sentence) &&
        sentence.length >= 18 &&
        sentence.length <= 130 &&
        chapter.terms.some((term) => sentence.includes(term)),
    );
    if (!candidates.length) continue;

    const sentence = candidates[0];
    const term = [...chapter.terms]
      .sort((a, b) => b.length - a.length)
      .find((item) => sentence.includes(item) && !usedTerms.has(item));
    if (!term) continue;

    const pool = [
      ...chapter.terms,
      ...glossary.terms.map((item) => item.term).filter((item) => !STOP_TERMS.has(item)),
    ].filter((item) => item !== term && !sentence.includes(item));
    const options = buildOptions(term, pool.slice(0, 40), nextId("choice"));
    usedSentences.add(sentence);
    usedTerms.add(term);

    return {
      id: nextId("choice"),
      type: "choice",
      points,
      knowledgePointId: section.id,
      knowledgePointTitle: section.title,
      prompt: `根据章节原文，选择最合适填入空白的术语：\n\n${sentence.replaceAll(term, "「____」")}`,
      options,
      answer: options.find((option) => option.text === term)?.key ?? "A",
      explanation: `原文为：「${sentence}」。该概念出自「${section.title}」。`,
      sourceRef: { sectionId: section.id, sectionTitle: section.title, quote: sentence },
      difficulty: "easy",
    };
  }
  return null;
}

function makeFill(
  chapter: ChapterMeta,
  glossary: Glossary,
  points: number,
  usedTerms: Set<string>,
  nextId: (type: QuestionType) => string,
): ExamQuestion | null {
  const pool = glossary.terms.filter(
    (term) =>
      chapter.terms.includes(term.term) && !usedTerms.has(term.term) && term.summary.length >= 4,
  );
  const term = pool[0];
  if (!term) return null;
  usedTerms.add(term.term);
  return {
    id: nextId("fill"),
    type: "fill",
    points,
    knowledgePointTitle: chapter.terms.includes(term.term) ? term.term : undefined,
    prompt: `根据术语表定义，写出对应术语：\n\n「${term.summary}」（${term.note ? `易混点：${term.note}` : "提示：参见全书术语表"}）`,
    answer: term.term,
    answerAlternatives: [term.term.toLowerCase()],
    explanation: `${term.term}：${term.summary}。`,
    difficulty: "easy",
  };
}

function makeContrast(
  chapter: ChapterMeta,
  glossary: Glossary,
  points: number,
  nextId: (type: QuestionType) => string,
  used: Set<string>,
): ExamQuestion {
  const half = Math.floor(points / 2);
  const namesKey = (names: string[]) => names.map((name) => name.trim().toLowerCase()).sort().join("|");

  let selected:
    | { contrast: Glossary["contrasts"][number]; items: { name: string; text: string }[]; names: string[] }
    | undefined;

  for (const contrast of glossary.contrasts) {
    if (used.has(contrast.title)) continue;
    if (!chapter.terms.some((term) => contrast.title.includes(term))) continue;
    const items = contrast.items ?? [];
    const names =
      items.length >= 2 ? items.slice(0, 2).map((item) => item.name) : splitContrast(contrast.title);
    const key = namesKey(names);
    // 同一组概念即使标题写法不同（带/不带小节编号），也视为已使用
    if (used.has(key)) continue;
    used.add(contrast.title);
    used.add(key);
    names.forEach((name) => used.add(name));
    selected = { contrast, items, names };
    break;
  }

  if (selected) {
    const { contrast, items, names } = selected;
    const criteria = names.map((name, index) => ({
      point: `说明「${name}」的定位与适用场景`,
      keywords: [
        name,
        ...(items[index]?.text ?? "").split(/[，。；、]/).filter((word) => word.length >= 2).slice(0, 2),
      ],
      points: index === 0 ? half : points - half,
    }));
    return {
      id: nextId("contrast"),
      type: "contrast",
      points,
      knowledgePointTitle: names.join(" / "),
      prompt: `辨析「${contrast.title}」：请说明两者的核心区别、各自解决的问题，以及什么时候该用哪一个。${
        contrast.detail ? `\n\n提示：${contrast.detail}` : ""
      }`,
      answer: items.length
        ? items.map((item) => `${item.name}：${item.text}`).join("\n") +
          (contrast.detail ? `\n${contrast.detail}` : "")
        : contrast.detail,
      rubric: { criteria, notes: "按两个概念的定位、区别与选型场景给分。" },
      explanation: contrast.detail,
      difficulty: "medium",
    };
  }

  // 没有可用的术语表对照时，从本章术语/知识点里组合一对尚未出现过的概念
  const pool = [
    ...new Set([...chapter.terms, ...chapter.sections.map((section) => section.title)]),
  ].filter((item) => item && !used.has(item));

  const pairs: [string, string][] = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      pairs.push([pool[i], pool[j]]);
    }
  }
  const pair = pairs.find(([a, b]) => !used.has(namesKey([a, b]))) ?? ["概念 A", "概念 B"];
  const [nameA, nameB] = pair;
  used.add(`${nameA} / ${nameB}`);
  used.add(namesKey([nameA, nameB]));
  used.add(nameA);
  used.add(nameB);

  return {
    id: nextId("contrast"),
    type: "contrast",
    points,
    knowledgePointTitle: `${nameA} / ${nameB}`,
    prompt: `请结合本章内容，辨析「${nameA}」与「${nameB}」的定位差异，并说明各自适合的使用场景。`,
    answer: `需要分别说明「${nameA}」与「${nameB}」解决的问题、核心机制和适用边界。`,
    rubric: {
      criteria: [
        { point: `说明「${nameA}」`, keywords: [nameA], points: half },
        { point: `说明「${nameB}」`, keywords: [nameB], points: points - half },
      ],
    },
    explanation: "参考答案需覆盖两个概念的定位与边界。",
    difficulty: "medium",
  };
}

function makeApplication(
  chapter: ChapterMeta,
  content: ChapterContent,
  points: number,
  nextId: (type: QuestionType) => string,
): ExamQuestion {
  const section =
    content.sections.find((item) => /项目|实战|案例|应用/.test(item.title)) ?? content.sections[0];
  const terms = chapter.terms.filter((term) => sectionText(section).includes(term)).slice(0, 3);
  const keywords = terms.length ? terms : chapter.terms.slice(0, 3);
  const base = Math.floor(points / Math.max(1, keywords.length));
  const criteria = keywords.map((keyword, index) => ({
    point: `结合「${keyword}」说明方案`,
    keywords: [keyword],
    points: index === keywords.length - 1 ? points - base * (keywords.length - 1) : base,
  }));

  return {
    id: nextId("application"),
    type: "application",
    points,
    knowledgePointId: section?.id,
    knowledgePointTitle: section?.title,
    prompt: `真实项目场景：你需要在一个 AI 应用里处理「${section?.title ?? chapter.title}」相关任务。请给出你的处理思路，说明会用到本章的哪些机制、为什么这样选，以及需要注意的风险。`,
    answer: `应结合 ${keywords.join("、")} 等本章概念，给出可执行步骤并说明选型理由与风险。`,
    rubric: {
      criteria: criteria.length
        ? criteria
        : [
            { point: "给出可执行步骤", keywords: ["步骤", "流程"], points: Math.floor(points / 2) },
            { point: "说明原因与风险", keywords: ["因为", "风险"], points: points - Math.floor(points / 2) },
          ],
      notes: "本地判分仅按关键词命中估分，建议结合评语自评。",
    },
    explanation: `本题关联「${section?.title}」，参考原文该节内容组织答案。`,
    sourceRef: { sectionId: section?.id, sectionTitle: section?.title },
    difficulty: "hard",
  };
}

function makeCodeRead(
  codeBlocks: { section: ChapterSection; lang: string; code: string }[],
  cursor: number,
  points: number,
  nextId: (type: QuestionType) => string,
): ExamQuestion | null {
  const block = codeBlocks[cursor];
  if (!block) return null;
  const identifiers = [...new Set((block.code.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []))].slice(0, 4);
  const criteria = identifiers.slice(0, 3).map((identifier, index) => ({
    point: `说明 \`${identifier}\` 的作用`,
    keywords: [identifier],
    points: index === 0 ? Math.floor(points / 2) : Math.floor(points / 4),
  }));
  const sum = criteria.reduce((total, criterion) => total + criterion.points, 0);
  if (criteria.length) criteria[criteria.length - 1].points += points - sum;

  return {
    id: nextId("code-read"),
    type: "code-read",
    points,
    knowledgePointTitle: block.section.title,
    prompt: `阅读下面这段代码，说明它的整体作用、关键调用，以及在实际运行时可能出现的问题。\n\n\`\`\`${block.lang}\n${block.code.slice(0, 1200)}\n\`\`\``,
    answer: `应说明代码的整体目的，并解释 ${identifiers.join("、")} 等关键标识符的作用。`,
    code: block.code,
    rubric: {
      criteria: criteria.length
        ? criteria
        : [{ point: "说明代码作用", keywords: ["作用"], points }],
    },
    explanation: "对照原文该代码块前后的说明进行复盘。",
    sourceRef: { sectionId: block.section.id, sectionTitle: block.section.title },
    difficulty: "medium",
  };
}

function makeCodeFill(
  codeBlocks: { section: ChapterSection; lang: string; code: string }[],
  cursor: number,
  points: number,
  nextId: (type: QuestionType) => string,
): ExamQuestion | null {
  const block = codeBlocks.find((item, index) => index >= cursor && item.code.split("\n").length >= 4);
  if (!block) return null;
  const lines = block.code.split("\n");
  const targetIndex = lines.findIndex(
    (line, index) => index > 0 && /[=:()]/.test(line) && line.trim() && !/^\s*#/.test(line),
  );
  if (targetIndex < 0) return null;
  const target = lines[targetIndex];
  const indentation = target.match(/^\s*/)?.[0] ?? "";
  const blanked = [...lines];
  blanked[targetIndex] = `${indentation}# ____`;

  const tokens = (target.match(/[A-Za-z_][A-Za-z0-9_]{2,}|[（(][^)）]*[)）]/g) ?? [])
    .filter((token) => token.length >= 3)
    .slice(0, 3);
  const criteria = tokens.map((token, index) => ({
    point: `补全 \`${token}\``,
    keywords: [token],
    points: index === tokens.length - 1 ? points - Math.floor(points / Math.max(1, tokens.length)) * (tokens.length - 1) : Math.floor(points / Math.max(1, tokens.length)),
  }));

  return {
    id: nextId("code-fill"),
    type: "code-fill",
    points,
    knowledgePointTitle: block.section.title,
    prompt: `下面代码缺少了一行，请补全缺失的代码。\n\n\`\`\`${block.lang}\n${blanked.join("\n").slice(0, 1200)}\n\`\`\`\n\n只写缺失的那一行。`,
    answer: target.trim(),
    code: block.code,
    rubric: {
      criteria: criteria.length ? criteria : [{ point: "补全关键调用", keywords: ["("], points }],
      notes: "本地判分按关键标识符是否出现估算，不等同于真实运行测试。",
    },
    explanation: `原文代码为：\n\`\`\`${block.lang}\n${target}\n\`\`\``,
    sourceRef: { sectionId: block.section.id, sectionTitle: block.section.title },
    difficulty: "hard",
  };
}

function makePractice(
  chapter: ChapterMeta,
  points: number,
  nextId: (type: QuestionType) => string,
): ExamQuestion {
  const goal = chapter.objectives[0] ?? `完成与「${chapter.title}」相关的最小可运行示例`;
  const keywords = chapter.terms.slice(0, 3);
  const base = Math.floor(points / Math.max(1, keywords.length || 1));
  const criteria = (keywords.length ? keywords : ["代码", "输出"]).map((keyword, index, array) => ({
    point: `在实操中体现「${keyword}」`,
    keywords: [keyword],
    points: index === array.length - 1 ? points - base * (array.length - 1) : base,
  }));

  return {
    id: nextId("practice"),
    type: "practice",
    points,
    prompt: `本章实操任务：${goal}\n\n请提交你的实现步骤、关键代码片段或运行输出（至少说明你实际做了什么、看到了什么结果）。`,
    answer: `需要围绕「${goal}」给出可复现的步骤、代码或运行输出，并体现 ${keywords.join("、")}。`,
    rubric: { criteria, notes: "本地无法真实执行你的代码，分数为关键词估分。" },
    explanation: "请以原文案例源码为对照复盘。",
    difficulty: "hard",
  };
}

function makeDesign(
  chapter: ChapterMeta,
  content: ChapterContent,
  points: number,
  nextId: (type: QuestionType) => string,
  variant = 0,
): ExamQuestion {
  const angles = ["业务流程", "数据与状态", "可靠性与风险", "成本与性能", "评估与迭代"];
  const angle = angles[variant % angles.length];
  const focusIndex = content.sections.length ? variant % content.sections.length : -1;
  const focus = focusIndex >= 0 ? content.sections[focusIndex] : undefined;
  const titles = content.sections
    .filter((_, index) => index !== focusIndex)
    .slice(0, 3)
    .map((section) => section.title);
  const half = Math.floor(points / 2);
  const rest = points - half - Math.floor(points / 4);
  return {
    id: nextId("design"),
    type: "design",
    points,
    prompt: `综合设计题：围绕「${focus?.title ?? chapter.title}」，从「${angle}」角度设计一个可落地的应用或工作流。请说明业务目标、${titles.join(" / ") || "核心模块"} 在架构中的位置、关键流程，以及你会如何验证它有效。`,
    answer: `方案应覆盖业务目标、核心模块（${titles.join("、") || "本章知识点"}）、关键流程与验证方式。`,
    rubric: {
      criteria: [
        { point: "说明业务目标与场景", keywords: ["目标", "场景", "业务"], points: half },
        { point: "说明架构与关键流程", keywords: ["架构", "流程", "模块"], points: Math.floor(points / 4) },
        { point: "说明验证与风险", keywords: ["验证", "风险", "测试"], points: rest },
      ],
      notes: "本地关键词估分，评语会列出命中与遗漏点。",
    },
    explanation: "结合本章各知识点的定位组织答案，避免只罗列名词。",
    difficulty: "hard",
  };
}

function collectCodeBlocks(content: ChapterContent) {
  const blocks: { section: ChapterSection; lang: string; code: string }[] = [];
  for (const section of content.sections) {
    for (const block of section.blocks) {
      if (block.k === "code" && (block.code ?? "").trim().length >= 10) {
        blocks.push({ section, lang: block.lang ?? "text", code: block.code ?? "" });
      }
    }
  }
  return blocks;
}

export function sectionText(section: ChapterSection): string {
  return section.blocks
    .filter((block) => block.k !== "code" && block.k !== "img")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])\s*|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12 && sentence.length <= 160);
}

function firstMeaningfulSentence(section: ChapterSection): string {
  const text = sectionText(section);
  const candidates = sentences(text).filter((sentence) => !/^[一二三四五六七八九十\d]+[、.]/.test(sentence));
  return candidates[0] ?? text.slice(0, 90);
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const result = [...items];
  // FNV-1a + mulberry32：同一题目每次打开顺序稳定，但不同题目答案位置分散
  let state = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function splitContrast(title: string): string[] {
  return title.split(/\s+vs\s+|、/i).map((item) => item.trim()).filter(Boolean).slice(0, 2);
}

export function templateSummary(): string {
  return EXAM_TEMPLATES.map(
    (template) => `${template.label}（${templateTotal(template)} 分）：${template.description}`,
  ).join("；");
}
