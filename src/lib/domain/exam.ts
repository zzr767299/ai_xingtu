import type {
  ChapterMeta,
  ExamQuestion,
  QuestionGrade,
  QuestionType,
  StarTier,
} from "../../types";
import { clamp, isPass, starForScore, totalScore } from "./rules";

export interface ExamSlot {
  type: QuestionType;
  count: number;
  points: number;
}

export interface ExamTemplate {
  id: string;
  label: string;
  description: string;
  slots: ExamSlot[];
}

export const EXAM_TEMPLATES: ExamTemplate[] = [
  {
    id: "concept",
    label: "概念理解型",
    description: "选择、填空、概念辨析与应用分析，适合概念性章节。",
    slots: [
      { type: "choice", count: 6, points: 6 },
      { type: "fill", count: 4, points: 4 },
      { type: "contrast", count: 2, points: 8 },
      { type: "application", count: 1, points: 12 },
    ],
  },
  {
    id: "mixed",
    label: "综合型",
    description: "客观题 + 代码阅读 + 方案设计，适合框架与工具类章节。",
    slots: [
      { type: "choice", count: 5, points: 6 },
      { type: "fill", count: 3, points: 4 },
      { type: "contrast", count: 1, points: 8 },
      { type: "application", count: 1, points: 10 },
      { type: "code-read", count: 1, points: 10 },
      { type: "design", count: 1, points: 10 },
    ],
  },
  {
    id: "code-heavy",
    label: "工程实战型",
    description: "代码阅读、代码补全、实操与综合设计为主，适合项目实战章节。",
    slots: [
      { type: "choice", count: 4, points: 6 },
      { type: "fill", count: 2, points: 4 },
      { type: "code-read", count: 2, points: 8 },
      { type: "code-fill", count: 1, points: 10 },
      { type: "practice", count: 1, points: 12 },
      { type: "design", count: 1, points: 10 },
    ],
  },
];

export function selectTemplate(chapter: Pick<ChapterMeta, "profile">): ExamTemplate {
  return EXAM_TEMPLATES.find((template) => template.id === chapter.profile) ?? EXAM_TEMPLATES[1];
}

export function templateTotal(template: ExamTemplate): number {
  return template.slots.reduce((sum, slot) => sum + slot.count * slot.points, 0);
}

export function questionTypeLabel(type: QuestionType): string {
  switch (type) {
    case "choice":
      return "选择题";
    case "fill":
      return "填空题";
    case "contrast":
      return "概念辨析";
    case "application":
      return "应用分析";
    case "code-read":
      return "代码阅读";
    case "code-fill":
      return "代码补全";
    case "practice":
      return "编程实操";
    case "design":
      return "系统设计";
    default:
      return type;
  }
}

export interface PaperValidation {
  ok: boolean;
  total: number;
  errors: string[];
}

// 只靠查文档就能确认的字面量：网址、域名、端口、绝对路径。
const LITERAL_ANSWER = /(?:(?:https?|wss?):\/\/|\bwww\.|\b[\w-]+\.(?:com|cn|org|io|net|dev|ai)\b|\blocalhost(?::\d+)?\b|^\/[\w./-]{2,})/i;
// 题干明显在要一个可查的字面量，而不是概念理解。
const LITERAL_PROMPT = /base\s*url|域名|端口号?|文件路径|安装路径|版本号|密钥前缀|api[\s-]*key\s*(?:是|为)|包名是|价格|每百万?\s*tokens?/i;

function literalTriviaReason(question: ExamQuestion): string | null {
  if (question.type === "fill") {
    const answer = question.answer.trim();
    if (LITERAL_ANSWER.test(answer)) return "填空题答案只是网址/路径/端口等可查字面量";
    if (LITERAL_PROMPT.test(question.prompt) && answer.length <= 80) {
      return "填空题在考 URL/路径/版本号等可查字面量";
    }
  }
  if (question.type === "choice") {
    const optionText = (question.options ?? []).map((option) => option.text).join(" ");
    if (LITERAL_ANSWER.test(optionText)) return "选择题选项是网址/路径等可查字面量";
  }
  return null;
}

/** 试卷结构校验：总分必须严格等于 80，主观题必须有可执行评分细则，代码题必须有代码。 */
export function validatePaper(questions: ExamQuestion[], expectedTotal = 80): PaperValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  const prompts = new Map<string, string>();
  let total = 0;

  if (questions.length === 0) errors.push("试卷没有题目");

  for (const question of questions) {
    total += question.points;
    if (!question.id) errors.push("存在缺少 id 的题目");
    else if (ids.has(question.id)) errors.push(`题目 id 重复：${question.id}`);
    else ids.add(question.id);

    if (!Number.isFinite(question.points) || question.points <= 0) {
      errors.push(`题目 ${question.id} 分值非法：${question.points}`);
    }
    if (question.points % 1 !== 0) {
      errors.push(`题目 ${question.id} 分值必须为整数`);
    }
    if (!question.prompt?.trim()) errors.push(`题目 ${question.id} 缺少题干`);
    if (!question.answer?.trim()) errors.push(`题目 ${question.id} 缺少参考答案`);
    if (question.prompt?.trim()) {
      const promptKey = normalizeAnswer(question.prompt);
      const duplicateOf = prompts.get(promptKey);
      if (duplicateOf) errors.push(`题目内容重复：${question.id} 与 ${duplicateOf}`);
      else prompts.set(promptKey, question.id);
    }

    const trivia = literalTriviaReason(question);
    if (trivia) errors.push(`题目 ${question.id} ${trivia}，请改为考查概念理解或实际应用`);

    const hasInlineCode = /```[\s\S]*?```/.test(question.prompt ?? "");
    if (
      (question.type === "code-read" || question.type === "code-fill") &&
      !question.code?.trim() &&
      !hasInlineCode
    ) {
      errors.push(`代码题 ${question.id} 缺少代码内容：请把代码放进 code 字段`);
    }

    if (question.type === "choice") {
      const options = question.options ?? [];
      if (options.length < 2) errors.push(`选择题 ${question.id} 选项不足`);
      const keys = new Set(options.map((option) => option.key));
      if (keys.size !== options.length) errors.push(`选择题 ${question.id} 选项 key 重复`);
      if (!keys.has(question.answer)) errors.push(`选择题 ${question.id} 正确答案不在选项中`);
    } else if (question.type !== "fill") {
      const criteria = question.rubric?.criteria ?? [];
      if (criteria.length === 0) {
        errors.push(`主观题 ${question.id} 缺少评分细则`);
      } else {
        const rubricTotal = criteria.reduce((sum, criterion) => sum + criterion.points, 0);
        if (rubricTotal !== question.points) {
          errors.push(
            `主观题 ${question.id} 评分细则分值和为 ${rubricTotal}，与题目分值 ${question.points} 不一致`,
          );
        }
        criteria.forEach((criterion, index) => {
          if (!criterion.keywords?.length) {
            errors.push(`主观题 ${question.id} 第 ${index + 1} 条细则缺少关键词`);
          }
        });
      }
    }
  }

  if (total !== expectedTotal) {
    errors.push(`试卷总分 ${total} 分，必须严格等于 ${expectedTotal} 分`);
  }

  return { ok: errors.length === 0, total, errors };
}

export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[\p{P}\p{S}]/gu, "");
}

function fillMatches(question: ExamQuestion, answer: string): boolean {
  const normalized = normalizeAnswer(answer);
  if (!normalized) return false;
  const candidates = [question.answer, ...(question.answerAlternatives ?? [])]
    .map(normalizeAnswer)
    .filter(Boolean);
  return candidates.some((candidate) => {
    if (candidate === normalized) return true;
    // 允许用户答案里包含标准答案（例如多写了修饰词），但不接受残缺答案
    return candidate.length >= 3 && normalized.includes(candidate) && normalized.length - candidate.length <= 8;
  });
}

export function gradeObjective(question: ExamQuestion, answer: string): QuestionGrade {
  if (question.type === "choice") {
    const correct = answer.trim().toUpperCase() === question.answer.trim().toUpperCase();
    return {
      questionId: question.id,
      score: correct ? question.points : 0,
      maxScore: question.points,
      correct,
      feedback: correct
        ? "答案正确。"
        : `答案不正确，正确答案是 ${question.answer}${
            question.options?.find((option) => option.key === question.answer)?.text
              ? `（${question.options.find((option) => option.key === question.answer)?.text}）`
              : ""
          }。`,
      hits: correct ? [answer] : [],
      misses: correct ? [] : [question.answer],
      gradedBy: "auto",
    };
  }

  if (!answer.trim()) {
    return {
      questionId: question.id,
      score: 0,
      maxScore: question.points,
      correct: false,
      feedback: "未作答。",
      hits: [],
      misses: [question.answer],
      gradedBy: "auto",
    };
  }

  const correct = fillMatches(question, answer);
  return {
    questionId: question.id,
    score: correct ? question.points : 0,
    maxScore: question.points,
    correct,
    feedback: correct
      ? "答案匹配成功。"
      : `答案未匹配到标准答案「${question.answer}」，注意术语的准确写法。`,
    hits: correct ? [answer] : [],
    misses: correct ? [] : [question.answer],
    gradedBy: "auto",
  };
}

const MIN_SUBJECTIVE_LENGTH = 12;

/** 本地关键词判分：按评分细则命中关键词，结果会明确标注为本地估分。 */
export function gradeSubjectiveLocal(question: ExamQuestion, answer: string): QuestionGrade {
  const criteria = question.rubric?.criteria ?? [];
  const normalized = normalizeAnswer(answer);

  if (normalized.length < MIN_SUBJECTIVE_LENGTH || criteria.length === 0) {
    return {
      questionId: question.id,
      score: 0,
      maxScore: question.points,
      correct: false,
      feedback:
        normalized.length === 0
          ? "未作答。"
          : "答案过短或缺少评分细则，本地判分无法给出有效分数。",
      hits: [],
      misses: criteria.flatMap((criterion) => criterion.keywords),
      gradedBy: "local-rubric",
    };
  }

  const hits: string[] = [];
  const misses: string[] = [];
  let score = 0;

  for (const criterion of criteria) {
    const matched = criterion.keywords.filter((keyword) => normalized.includes(normalizeAnswer(keyword)));
    const ratio = matched.length / Math.max(1, criterion.keywords.length);
    score += Math.round(criterion.points * ratio);
    for (const keyword of matched) hits.push(keyword);
    for (const keyword of criterion.keywords.filter((keyword) => !matched.includes(keyword))) {
      misses.push(keyword);
    }
  }

  score = clamp(score, 0, question.points);
  const correct = score >= question.points * 0.6;

  return {
    questionId: question.id,
    score,
    maxScore: question.points,
    correct,
    feedback: correct
      ? `命中 ${hits.length} 个关键得分点，本地关键词判分：${score}/${question.points}。`
      : `仅命中 ${hits.length} 个关键得分点，建议对照参考答案补全：${misses.slice(0, 5).join("、") || "作答过于简略"}。`,
    hits,
    misses,
    gradedBy: "local-rubric",
  };
}

export function gradePaperLocally(
  questions: ExamQuestion[],
  answers: Record<string, string>,
): QuestionGrade[] {
  return questions.map((question) => {
    const answer = answers[question.id] ?? "";
    return question.type === "choice" || question.type === "fill"
      ? gradeObjective(question, answer)
      : gradeSubjectiveLocal(question, answer);
  });
}

export interface AttemptScore {
  examScore: number;
  total: number;
  passed: boolean;
  star: StarTier;
}

export function summarizeAttempt(studyPoints: number, grades: QuestionGrade[]): AttemptScore {
  const rawExam = grades.reduce((sum, grade) => sum + grade.score, 0);
  const examScore = clamp(Math.round(rawExam), 0, 80);
  const total = totalScore(studyPoints, examScore);
  return {
    examScore,
    total,
    passed: isPass(total),
    star: starForScore(total),
  };
}

export function isObjectiveType(type: QuestionType): boolean {
  return type === "choice" || type === "fill";
}

export function starColor(star: StarTier): string {
  switch (star) {
    case "gold":
      return "#f6c453";
    case "silver":
      return "#c7d0dc";
    case "bronze":
      return "#c98b5a";
    case "normal":
      return "#63b3ed";
    default:
      return "#5b6472";
  }
}
