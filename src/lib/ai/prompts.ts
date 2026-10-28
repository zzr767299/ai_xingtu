import type { ChapterContent, ChapterMeta, ExamQuestion, Glossary } from "../../types";
import { questionTypeLabel, type ExamTemplate } from "../domain/exam";

export const PROMPT_VERSION = "v3";

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export function chapterDigest(
  chapter: ChapterMeta,
  content: ChapterContent | undefined,
  glossary: Glossary | undefined,
  options: { maxChars?: number; includeCode?: boolean } = {},
): string {
  const maxChars = options.maxChars ?? 5200;
  const perSection = content?.sections.length ? Math.floor(maxChars / content.sections.length) : 0;

  const sections =
    content?.sections
      .map((section) => {
        const text = section.blocks
          .filter((block) => block.k !== "img")
          .map((block) => {
            if (block.k === "code") {
              return options.includeCode ? `\`\`\`${block.lang}\n${truncate(block.code ?? "", 700)}\n\`\`\`` : "";
            }
            return block.text ?? "";
          })
          .filter(Boolean)
          .join("\n");
        return `### ${section.title}\n${truncate(text, Math.max(600, perSection))}`;
      })
      .join("\n\n") ?? "";

  const termLines = (chapter.terms ?? [])
    .map((term) => {
      const found = glossary?.terms.find((item) => item.term === term);
      return found ? `- ${found.term}：${found.summary}${found.note ? `（易混点：${found.note}）` : ""}` : `- ${term}`;
    })
    .join("\n");

  return [
    `【章节标题】${chapter.title}`,
    `【所属知识领域】${chapter.areaId}`,
    `【原文课程目标】`,
    chapter.objectives.length ? chapter.objectives.map((goal, index) => `${index + 1}. ${goal}`).join("\n") : "（原文未提供）",
    chapter.advice ? `【原文学习建议】${chapter.advice}` : "",
    `【知识点目录】`,
    chapter.sections.map((section, index) => `${index + 1}. ${section.title}`).join("\n"),
    entity(termLines) ? `【本章术语】\n${termLines}` : "",
    `【正文节选】\n${sections || "（无正文内容）"}`,
    `【原文链接】${chapter.sourceUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function entity(value: string): boolean {
  return value.trim().length > 0;
}

const JSON_RULES = "只输出一个 JSON 对象，不要输出 Markdown 代码块、解释文字或多余注释。所有内容使用简体中文。";

export function guidePrompt(chapter: ChapterMeta, digest: string): { system: string; user: string } {
  return {
    system: `你是「AI 星途」学习系统的课程导读设计师。你的任务是把章节原文整理成学习者进入章节前真正有用的导读。${JSON_RULES}
要求：
1. 所有事实必须来自给定原文，不得编造章节没有的知识点。
2. goals 是 2-6 条可检验的学习目标，措辞具体，不要“了解/熟悉”这类空话堆砌。
3. concepts 列出本章必须掌握的核心概念（优先使用原文术语）。
4. prerequisites 是学习本章前需要的前置知识；如果原文未说明，根据知识点目录谨慎推断，措辞用“建议先了解”。
5. order 给出推荐学习顺序，必须覆盖全部知识点。
6. minutes 为预计学习分钟数（阅读 + 练习）。
7. examPlan 说明本章考试形式、满分 80 分、学习任务 20 分、60 分通关。
返回字段：{"value":string,"goals":string[],"concepts":string[],"prerequisites":string[],"order":string[],"minutes":number,"examPlan":string}`,
    user: `章节信息：\n\n${digest}\n\n请为「${chapter.title}」生成导读 JSON。`,
  };
}

export function summaryPrompt(chapter: ChapterMeta, digest: string): { system: string; user: string } {
  return {
    system: `你是「AI 星途」的复习资料编辑，擅长把技术章节整理成可反复查看的知识总结。${JSON_RULES}
要求：
1. corePoints 覆盖本章全部知识点，每条包含标题与 1-2 句准确解释。
2. mindmap 是知识结构树，label 用短语，children 最多三层。
3. termCards 取本章最关键的术语，summary 一句话解释，note 写易混点。
4. contrasts 给出本章容易混淆的概念对比，items 写各自定位。
5. codeHighlights 仅在原文有代码时填写，code 必须原样摘录，不得改写。
6. scenarios 写真实工作场景；pitfalls 写常见错误与排查；examPoints 写高频考点；checklist 写可自测的短句。
7. 原文没有覆盖的扩展知识，必须在该条内容前加「【AI 补充】」。
返回字段：{"corePoints":[{"title","detail"}],"mindmap":{"label","children":[{"label","children":[{"label"}]}]},"termCards":[{"term","summary","note"}],"contrasts":[{"title","detail","items":[{"name","text"}]}],"codeHighlights":[{"title","lang","code","note"}],"scenarios":string[],"pitfalls":[{"title","detail"}],"examPoints":string[],"checklist":string[]}`,
    user: `章节信息：\n\n${digest}\n\n请为「${chapter.title}」生成复习总结 JSON。`,
  };
}

export function paperPrompt(
  digest: string,
  template: ExamTemplate,
): { system: string; user: string } {
  const slots = template.slots
    .map((slot) => `- ${questionTypeLabel(slot.type)}（type=${slot.type}）：${slot.count} 题，每题 ${slot.points} 分`)
    .join("\n");

  return {
    system: `你是「AI 星途」的命题老师，需要依据课程原文出一份章节考试卷。${JSON_RULES}
硬性要求：
1. 题目数量与题型必须严格按给定配置，不得增删题型；每类题目的题数与分值必须一致。
2. 所有题目分值之和必须严格等于 80 分。
3. 选择题 answer 必须是 options 中某个 option 的 key；options 至少 3 个，key 用 A/B/C/D，正确答案只有一个。
4. 填空题 answer 为简短短语；可提供 answerAlternatives 兼容同义写法。
5. 主观题（辨析/应用/代码阅读/代码补全/实操/设计）必须提供 rubric.criteria，且每条 criteria 的 points 之和必须严格等于该题 points；每条至少 1 个可用于判分的关键词。主观题同样必须填写参考答案 answer（用于关键词判分与阅卷参考），不能省略或留空。
6. 题目必须考查理解、迁移、排错与选型能力，禁止出死记硬背字面量的题：
   - 不得考 Base URL、URL、域名、端口、文件路径、版本号、密钥前缀、默认参数数值、价格等随时可以查文档确认的字面量。
   - 填空题的答案应是概念、机制、术语或适用场景，不能是网址、路径或一长串参数值。
   - 反面示例（不要出）：「最常见的 Base URL 是 ____」「默认端口号是 ____」「pip install 的包名是 ____」。
7. 代码题必须在 code 字段给出代码，题干只写任务说明，不要在 prompt 里重复贴代码：
   - code-read（代码阅读）：prompt 说明要分析什么；code 原样摘录原文中的完整代码；codeLang 写语言。
   - code-fill（代码补全）：prompt 说明要补哪一行；code 存放原文代码，但必须把要补的那一行替换成「# ____」（Python）或「// ____」（其他语言）的占位行；不要把被挖掉的那一行留在 code 里。
   - 任何代码题都不能出现「阅读下面代码 / 下面是一个消息列表」却看不到代码的情况；原文没有代码时不要出代码题。
8. 题目要覆盖本章核心知识点，避免多道题重复同一句原文；难度标注 easy/medium/hard。
9. explanation 说明答案依据，涉及原文时引用知识点标题。
返回字段：{"questions":[{"type","points","knowledgePointTitle","prompt","options":[{"key","text"}],"answer","answerAlternatives":[],"rubric":{"criteria":[{"point","keywords":[],"points":number}],"notes":""},"explanation","difficulty","code","codeLang"}]}`,
    user: `章节信息：\n\n${digest}\n\n试卷配置（${template.label}）：\n${slots}\n\n请出一份总分恰好 80 分的试卷 JSON。`,
  };
}

export function repairPrompt(errors: string[], previous: string): { system: string; user: string } {
  return {
    system: `你是试卷/JSON 修复器。上一轮输出未通过结构校验。${JSON_RULES}
请只修复错误，不要改变题目考查意图；分值必须严格等于 80，主观题评分细则分值和必须等于题目分值。
额外要求：
- 缺少代码的代码题，必须把代码补进 code 字段（代码补全题用「# ____」占位），题干不要重复贴代码。
- 只考 URL、域名、端口、路径、版本号等字面量的题目，必须改写成考查概念、机制或适用场景的题，但保留原分值与题型。`,
    user: `校验错误：\n${errors.map((error) => `- ${error}`).join("\n")}\n\n上一轮输出：\n${truncate(previous, 12000)}\n\n请输出修复后的完整 JSON。`,
  };
}

export function gradingPrompt(
  questions: ExamQuestion[],
  answers: Record<string, string>,
): { system: string; user: string } {
  const payload = questions.map((question) => ({
    questionId: question.id,
    type: question.type,
    points: question.points,
    prompt: question.prompt,
    referenceAnswer: question.answer,
    rubric: question.rubric,
    userAnswer: answers[question.id] ?? "",
  }));

  return {
    system: `你是严格的阅卷老师。请按参考答案与评分细则评分。${JSON_RULES}
要求：
1. 只批改给定题目，questionId 必须与输入一致。
2. score 为 0 到该题满分之间的数字，不得超过满分。
3. 合理但表述不同的答案只要符合专业含义就应给分，不得因为措辞不同判错。
4. feedback 用中文说明得分依据，指出命中与遗漏的关键点。
5. hits/misses 填写命中和遗漏的关键得分点关键词。
返回字段：{"grades":[{"questionId","score","feedback","hits":[],"misses":[]}]}`,
    user: `待批改数据：\n${truncate(JSON.stringify(payload, null, 2), 14000)}`,
  };
}

export function chatSystemPrompt(chapter: ChapterMeta, sectionTitle: string | undefined, digest: string): string {
  return `你是「AI 星途」的章节讲解助手，正在陪用户学习《${chapter.title}》。
- 回答必须优先基于提供的章节原文；引用原文时说明来自哪个知识点。
- 原文没有覆盖的内容，用「【AI 补充】」标注，不得伪造原文引用。
- 回答要具体、可执行，涉及代码时给出代码块和逐段说明。
- 用户当前正在学习的知识点：${sectionTitle ?? chapter.sections[0]?.title ?? chapter.title}。
- 不要编造原文链接或章节编号。

章节资料：
${truncate(digest, 5000)}`;
}

export function similarPrompt(
  wrong: { prompt: string; answer: string; knowledgePointTitle?: string; type: string },
  digest: string,
): { system: string; user: string } {
  return {
    system: `你是「AI 星途」的错题教练。请围绕原错题考查的同一知识点，出一道同类型但情境不同的新题，用于检验用户是否真正理解。${JSON_RULES}
要求：
1. 不得直接重复原题，也不得只改数字或措辞。
2. 新题必须能依据章节原文作答，不引入原文没有的内容。
3. 如果题型适合客观题，请给出明确参考答案；如果是主观题，给出 rubric.criteria，关键词要能区分是否真正理解。
4. explanation 说明考点与判断依据，引用知识点标题。
返回字段：{"prompt":string,"answer":string,"explanation":string,"rubric":{"criteria":[{"point","keywords":[],"points":number}]}}`,
    user: `原错题：\n${JSON.stringify(wrong, null, 2)}\n\n章节资料：\n${truncate(digest, 3200)}\n\n请生成一道同类新题 JSON。`,
  };
}


export function explainPrompt(
  chapterTitle: string,
  sectionTitle: string,
  sectionText: string,
  digest: string,
): { system: string; user: string } {
  return {
    system: `你是「AI 星途」的章节精讲老师。请把指定知识点的原文整理成可直接学习的讲解，用 Markdown 输出（不要 JSON）。
结构要求：
## 一句话理解
## 它是什么
## 解决什么问题
## 什么时候用 / 不用
## 与相邻概念的关系
## 开发中的实际例子
## 常见错误
规则：
- 事实优先来自原文；超出原文的内容必须以「【AI 补充】」开头。
- 不要编造原文链接、章节编号或未出现的 API。
- 涉及代码时给出代码块并逐段解释。
- 语言具体、可执行，避免空话。`,
    user: `章节：${chapterTitle}
知识点：${sectionTitle}

该知识点原文：
${truncate(sectionText, 3600)}

章节背景：
${truncate(digest, 2200)}`,
  };
}

export function quickActionPrompt(action: string, title: string): string {  switch (action) {
    case "simplify":
      return `请用更容易理解的方式解释「${title}」，尽量用类比和一句话总结。`;
    case "example":
      return `请针对「${title}」举一个真实工作中的案例，说明输入、处理过程和输出。`;
    case "compare":
      return `「${title}」最容易和哪些概念混淆？请给出清晰的对比表和判断准则。`;
    case "code":
      return `请解释「${title}」相关的代码为什么要这样写，逐段说明关键行。`;
    case "usage":
      return `从开发者角度看，「${title}」在实际项目中怎么用？请给出典型使用场景和落地步骤。`;
    case "quiz":
      return `请针对「${title}」出一道小题考我，等我回答后再讲解。`;
    default:
      return action;
  }
}
