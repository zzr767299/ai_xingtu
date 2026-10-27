import type {
  AppSettings,
  ChapterContent,
  ChapterMeta,
  ExamQuestion,
  Glossary,
  QuestionGrade,
  WrongEntry,
} from "../../types";
import type { ProgressRepository } from "../storage/repo";
import { validatePaper, type ExamTemplate } from "../domain/exam";
import type { ChapterGuide, ChapterSummary } from "../domain/localContent";
import { AiError, isAiConfigured, requestChat, type ChatMessageInput } from "./provider";
import {
  chatSystemPrompt,
  chapterDigest,
  explainPrompt,
  gradingPrompt,
  guidePrompt,
  paperPrompt,
  PROMPT_VERSION,
  repairPrompt,
  similarPrompt,
  summaryPrompt,
} from "./prompts";
import {
  gradingSchema,
  guideSchema,
  paperSchema,
  parseJsonLoose,
  similarQuestionSchema,
  summarySchema,
} from "./schemas";

export class AiValidationError extends AiError {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super("invalid-response", message, { retryable: false });
    this.name = "AiValidationError";
    this.details = details;
  }
}

export interface AiResult<T> {
  data: T;
  cached: boolean;
  model: string;
  generatedAt: number;
}

export class AiService {
  constructor(
    private repo: ProgressRepository,
    private settings: () => AppSettings,
  ) {}

  get ai() {
    return this.settings().ai;
  }

  isAvailable(): boolean {
    return isAiConfigured(this.ai);
  }

  private cacheKey(feature: string, chapter: ChapterMeta, extra: string) {
    return `${feature}:${chapter.id}:${chapter.contentHash}:${this.ai.model}:${PROMPT_VERSION}:${extra}`;
  }

  private async cached<T>(
    key: string,
    force: boolean,
    factory: () => Promise<T>,
  ): Promise<AiResult<T>> {
    if (!force) {
      const hit = await this.repo.getCache<T>(key);
      if (hit) {
        return { data: hit.value, cached: true, model: this.ai.model, generatedAt: hit.createdAt };
      }
    }
    const data = await factory();
    await this.repo.setCache(key, data);
    return { data, cached: false, model: this.ai.model, generatedAt: Date.now() };
  }

  private async callJson<T>(
    messages: ChatMessageInput[],
    schema: { parse: (value: unknown) => T },
    label: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const raw = await requestChat(this.ai, messages, { signal: options.signal });
    try {
      return schema.parse(parseJsonLoose(raw));
    } catch (error) {
      const firstErrors = [describeParseError(error)];
      const repair = repairPrompt(firstErrors, raw);
      const second = await requestChat(
        this.ai,
        [
          { role: "system", content: repair.system },
          { role: "user", content: repair.user },
        ],
        { signal: options.signal },
      );
      try {
        return schema.parse(parseJsonLoose(second));
      } catch (secondError) {
        throw new AiValidationError(
          `${label}生成结果未通过结构校验，已自动修复一次仍失败。`,
          [...firstErrors, describeParseError(secondError)],
        );
      }
    }
  }

  async guide(
    chapter: ChapterMeta,
    content: ChapterContent | undefined,
    glossary: Glossary | undefined,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<AiResult<ChapterGuide>> {
    const key = this.cacheKey("guide", chapter, "default");
    const digest = chapterDigest(chapter, content, glossary, { maxChars: 4800 });
    return this.cached(key, Boolean(options.force), async () => {
      const { system, user } = guidePrompt(chapter, digest);
      const parsed = await this.callJson(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        guideSchema,
        "导读",
        { signal: options.signal },
      );
      const result: ChapterGuide = {
        ...parsed,
        source: "ai",
        generatedAt: Date.now(),
        note: `由 ${this.ai.model} 生成，依据章节原文与课程目标`,
      };
      return result;
    });
  }

  async summary(
    chapter: ChapterMeta,
    content: ChapterContent | undefined,
    glossary: Glossary | undefined,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<AiResult<ChapterSummary>> {
    const key = this.cacheKey("summary", chapter, "default");
    const digest = chapterDigest(chapter, content, glossary, { maxChars: 6400, includeCode: true });
    return this.cached(key, Boolean(options.force), async () => {
      const { system, user } = summaryPrompt(chapter, digest);
      const parsed = await this.callJson(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        summarySchema,
        "总结",
        { signal: options.signal },
      );
      const result: ChapterSummary = {
        ...parsed,
        source: "ai",
        generatedAt: Date.now(),
        note: `由 ${this.ai.model} 生成，事实以章节原文为准，扩展知识标注为【AI 补充】`,
      };
      return result;
    });
  }

  async paper(
    chapter: ChapterMeta,
    content: ChapterContent | undefined,
    glossary: Glossary | undefined,
    template: ExamTemplate,
    sequence: number,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<AiResult<{ questions: ExamQuestion[]; adjusted: boolean }>> {
    const key = this.cacheKey("paper", chapter, `${template.id}:${sequence}`);
    const digest = chapterDigest(chapter, content, glossary, { maxChars: 6200, includeCode: true });

    return this.cached(key, Boolean(options.force), async () => {
      const { system, user } = paperPrompt(digest, template);
      const raw = await requestChat(
        this.ai,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { signal: options.signal },
      );

      let questions = this.mapQuestions(raw, chapter, content);
      let validation = validatePaper(questions, 80);

      if (!validation.ok) {
        const repaired = await requestChat(
          this.ai,
          [
            { role: "system", content: repairPrompt(validation.errors, raw).system },
            { role: "user", content: repairPrompt(validation.errors, raw).user },
          ],
          { signal: options.signal },
        );
        questions = this.mapQuestions(repaired, chapter, content);
        validation = validatePaper(questions, 80);
      }

      if (!validation.ok) {
        throw new AiValidationError("AI 生成的试卷未通过 80 分与评分细则校验。", validation.errors);
      }

      return { questions, adjusted: false };
    });
  }

  private mapQuestions(raw: string, chapter: ChapterMeta, content: ChapterContent | undefined): ExamQuestion[] {
    const parsed = paperSchema.parse(parseJsonLoose(raw));
    return parsed.questions.map((question, index) => {
      const section = chapter.sections.find((item) => item.title === question.knowledgePointTitle);
      const contentSection = content?.sections.find((item) => item.title === question.knowledgePointTitle);
      return {
        ...question,
        id: `q${index + 1}`,
        knowledgePointId: section?.id ?? contentSection?.id,
        sourceRef: section
          ? { sectionId: section.id, sectionTitle: section.title }
          : undefined,
        rubric: question.rubric
          ? { criteria: question.rubric.criteria, notes: question.rubric.notes }
          : undefined,
      } as ExamQuestion;
    });
  }

  async gradeSubjective(
    questions: ExamQuestion[],
    answers: Record<string, string>,
    options: { signal?: AbortSignal } = {},
  ): Promise<QuestionGrade[]> {
    if (questions.length === 0) return [];
    const { system, user } = gradingPrompt(questions, answers);
    const parsed = await this.callJson(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      gradingSchema,
      "阅卷",
      { signal: options.signal },
    );

    const byId = new Map(parsed.grades.map((grade) => [grade.questionId, grade]));
    const missing = questions.filter((question) => !byId.has(question.id));
    if (missing.length > 0) {
      throw new AiValidationError("阅卷结果缺少部分题目。", missing.map((question) => `缺少 ${question.id}`));
    }

    return questions.map((question) => {
      const grade = byId.get(question.id)!;
      const score = Math.min(question.points, Math.max(0, Math.round(grade.score)));
      return {
        questionId: question.id,
        score,
        maxScore: question.points,
        correct: score >= question.points * 0.6,
        feedback: grade.feedback,
        hits: grade.hits,
        misses: grade.misses,
        gradedBy: "ai",
      };
    });
  }

  async chat(
    chapter: ChapterMeta,
    content: ChapterContent | undefined,
    glossary: Glossary | undefined,
    history: { role: "user" | "assistant"; content: string }[],
    sectionTitle: string | undefined,
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    const digest = chapterDigest(chapter, content, glossary, { maxChars: 4200 });
    const messages: ChatMessageInput[] = [
      { role: "system", content: chatSystemPrompt(chapter, sectionTitle, digest) },
      ...history.slice(-8).map((message) => ({ role: message.role, content: message.content })),
    ];
    return requestChat(this.ai, messages, { signal: options.signal });
  }

  async explainSection(
    chapter: ChapterMeta,
    content: ChapterContent | undefined,
    glossary: Glossary | undefined,
    sectionId: string,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<AiResult<string>> {
    const section = content?.sections.find((item) => item.id === sectionId);
    if (!section) throw new AiError("invalid-response", "找不到该知识点的正文内容。");
    const key = this.cacheKey("explain", chapter, sectionId);
    const text = section.blocks
      .filter((block) => block.k !== "img")
      .map((block) => (block.k === "code" ? `\`\`\`${block.lang}
${block.code}
\`\`\`` : block.text ?? ""))
      .join("\n")
    const digest = chapterDigest(chapter, content, glossary, { maxChars: 2400 });
    return this.cached(key, Boolean(options.force), async () => {
      const { system, user } = explainPrompt(chapter.title, section.title, text, digest);
      return requestChat(
        this.ai,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { signal: options.signal },
      );
    });
  }

  async clearCache(prefix = ""): Promise<number> {
    return this.repo.clearCache(prefix);
  }

  async similarQuestion(
    chapter: ChapterMeta,
    content: ChapterContent | undefined,
    glossary: Glossary | undefined,
    wrong: WrongEntry,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ prompt: string; answer: string; explanation: string; rubric?: { criteria: { point: string; keywords: string[]; points: number }[] } }> {
    const digest = chapterDigest(chapter, content, glossary, { maxChars: 3200 });
    const { system, user } = similarPrompt(
      {
        prompt: wrong.question.prompt,
        answer: wrong.question.answer,
        knowledgePointTitle: wrong.knowledgePointTitle,
        type: wrong.question.type,
      },
      digest,
    );
    return this.callJson(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      similarQuestionSchema,
      "同类题",
      { signal: options.signal },
    );
  }
}

function describeParseError(error: unknown): string {
  if (error instanceof AiValidationError) return error.details.join("；");
  if (error instanceof Error) {
    const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues;
    if (issues?.length) {
      return issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "根节点"}：${issue.message}`)
        .join("；");
    }
    return error.message;
  }
  return String(error);
}
