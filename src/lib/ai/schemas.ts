import { z } from "zod";

export const questionTypes = [
  "choice",
  "fill",
  "contrast",
  "application",
  "code-read",
  "code-fill",
  "practice",
  "design",
] as const;

export const guideSchema = z.object({
  value: z.string().min(10),
  goals: z.array(z.string().min(4)).min(2).max(8),
  concepts: z.array(z.string().min(1)).min(2).max(12),
  prerequisites: z.array(z.string()).max(5).default([]),
  order: z.array(z.string()).min(1).max(20),
  minutes: z.number().int().min(3).max(600),
  examPlan: z.string().min(10),
});

export const mindmapSchema: z.ZodType<{
  label: string;
  children?: { label: string; children?: { label: string }[] }[];
}> = z.object({
  label: z.string(),
  children: z
    .array(
      z.object({
        label: z.string(),
        children: z.array(z.object({ label: z.string() })).optional(),
      }),
    )
    .optional(),
});

export const summarySchema = z.object({
  corePoints: z.array(z.object({ title: z.string(), detail: z.string() })).min(2).max(16),
  mindmap: mindmapSchema,
  termCards: z.array(z.object({ term: z.string(), summary: z.string(), note: z.string().default("") })).max(16).default([]),
  contrasts: z
    .array(z.object({ title: z.string(), detail: z.string(), items: z.array(z.object({ name: z.string(), text: z.string() })).optional() }))
    .max(8)
    .default([]),
  codeHighlights: z.array(z.object({ title: z.string(), lang: z.string(), code: z.string(), note: z.string().default("") })).max(6).default([]),
  scenarios: z.array(z.string()).max(6).default([]),
  pitfalls: z.array(z.object({ title: z.string(), detail: z.string() })).max(8).default([]),
  examPoints: z.array(z.string()).max(20).default([]),
  checklist: z.array(z.string()).max(12).default([]),
});

export const rubricCriterionSchema = z.object({
  point: z.string().min(2),
  keywords: z.array(z.string().min(1)).min(1).max(8),
  points: z.number().min(1),
});

export const aiQuestionSchema = z.object({
  type: z.enum(questionTypes),
  points: z.number().int().positive(),
  knowledgePointTitle: z.string().default(""),
  prompt: z.string().min(10),
  options: z.array(z.object({ key: z.string().min(1), text: z.string().min(1) })).optional(),
  answer: z.string().min(1),
  answerAlternatives: z.array(z.string()).optional(),
  rubric: z
    .object({ criteria: z.array(rubricCriterionSchema).min(1), notes: z.string().optional() })
    .optional(),
  explanation: z.string().min(4),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  code: z.string().optional(),
});

export const paperSchema = z.object({
  questions: z.array(aiQuestionSchema).min(1).max(30),
});

export const gradingSchema = z.object({
  grades: z.array(
    z.object({
      questionId: z.string(),
      score: z.number().min(0),
      feedback: z.string().min(2),
      hits: z.array(z.string()).default([]),
      misses: z.array(z.string()).default([]),
    }),
  ),
});

export const similarQuestionSchema = z.object({
  prompt: z.string().min(10),
  answer: z.string().min(2),
  explanation: z.string().min(4),
  rubric: z.object({ criteria: z.array(rubricCriterionSchema).min(1) }).optional(),
});

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const firstBracket = withoutFence.indexOf("[");
  const start = [firstBrace, firstBracket].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (typeof start === "number") {
    const lastBrace = withoutFence.lastIndexOf("}");
    const lastBracket = withoutFence.lastIndexOf("]");
    const end = Math.max(lastBrace, lastBracket);
    if (end > start) candidates.push(withoutFence.slice(start, end + 1));
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `模型输出不是合法 JSON：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
