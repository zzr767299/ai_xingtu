import { z } from "zod";
import type {
  AiSettings,
  AppSettings,
  ChapterProgress,
  ChatMessage,
  ExamAttempt,
  ExportBundle,
  Paper,
  StudyProgressState,
  WrongEntry,
} from "../../types";
import type { KeyValueStore } from "./memoryStore";

export const KEYS = {
  progress: "state:progress",
  settings: "state:settings",
  courseMeta: "meta:course",
  cache: "cache:ai:",
  chat: "chat:",
  draft: "draft:",
};

export const PROVIDER_PRESETS: { id: string; label: string; baseUrl: string; model: string; hint: string }[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    hint: "OpenAI 兼容接口，价格低，中文效果好。",
  },
  {
    id: "qwen",
    label: "阿里云百炼 / 通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    hint: "DashScope 的 OpenAI 兼容模式。",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "需要可访问 OpenAI 的网络环境。",
  },
  {
    id: "ollama",
    label: "本地 Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    hint: "本地模型，需要先 ollama pull；浏览器直连需配置 OLLAMA_ORIGINS=*。",
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容服务",
    baseUrl: "",
    model: "",
    hint: "任何兼容 /chat/completions 的服务。",
  },
];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  preset: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-chat",
  useProxy: false,
  proxyUrl: "http://localhost:8787/api/ai/chat",
  temperature: 0.4,
  maxTokens: 2200,
  timeoutMs: 60000,
};

export const DEFAULT_SETTINGS: AppSettings = {
  ai: DEFAULT_AI_SETTINGS,
  theme: "dark",
  reduceMotion: false,
  dailyGoalMinutes: 30,
  displayName: "",
};

export const EMPTY_STATE: StudyProgressState = {
  chapterProgress: {},
  attempts: [],
  wrong: [],
  lastLocation: null,
};

export function createEmptyState(): StudyProgressState {
  return { chapterProgress: {}, attempts: [], wrong: [], lastLocation: null };
}

export class ProgressRepository {
  constructor(private store: KeyValueStore) {}

  async loadState(): Promise<StudyProgressState> {
    const stored = await this.store.get<StudyProgressState>(KEYS.progress);
    return {
      chapterProgress: stored?.chapterProgress ?? {},
      attempts: stored?.attempts ?? [],
      wrong: stored?.wrong ?? [],
      lastLocation: stored?.lastLocation ?? null,
    };
  }

  async saveState(state: StudyProgressState): Promise<void> {
    await this.store.set(KEYS.progress, state);
  }

  async loadSettings(): Promise<AppSettings> {
    const stored = await this.store.get<AppSettings>(KEYS.settings);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      ai: { ...DEFAULT_AI_SETTINGS, ...(stored?.ai ?? {}) },
    };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.store.set(KEYS.settings, settings);
  }

  async loadChapterProgress(chapterId: string): Promise<ChapterProgress | undefined> {
    const state = await this.loadState();
    return state.chapterProgress[chapterId];
  }

  async getCache<T>(key: string): Promise<{ value: T; createdAt: number } | undefined> {
    return this.store.get<{ value: T; createdAt: number }>(KEYS.cache + key);
  }

  async setCache<T>(key: string, value: T): Promise<void> {
    await this.store.set(KEYS.cache + key, { value, createdAt: Date.now() });
  }

  async clearCache(prefix = ""): Promise<number> {
    const entries = await this.store.entries(KEYS.cache + prefix);
    await Promise.all(entries.map((entry) => this.store.delete(entry.key)));
    return entries.length;
  }

  async getChat(chapterId: string): Promise<ChatMessage[]> {
    return (await this.store.get<ChatMessage[]>(KEYS.chat + chapterId)) ?? [];
  }

  async saveChat(chapterId: string, messages: ChatMessage[]): Promise<void> {
    await this.store.set(KEYS.chat + chapterId, messages.slice(-60));
  }

  async saveDraft(draft: { chapterId: string; paper: Paper; answers: Record<string, string>; startedAt: number }) {
    await this.store.set(KEYS.draft + draft.chapterId, draft);
  }

  async getDraft(chapterId: string) {
    return this.store.get<{
      chapterId: string;
      paper: Paper;
      answers: Record<string, string>;
      startedAt: number;
    }>(KEYS.draft + chapterId);
  }

  async clearDraft(chapterId: string): Promise<void> {
    await this.store.delete(KEYS.draft + chapterId);
  }

  async getCourseMeta<T>(): Promise<T | undefined> {
    return this.store.get<T>(KEYS.courseMeta);
  }

  async saveCourseMeta<T>(meta: T): Promise<void> {
    await this.store.set(KEYS.courseMeta, meta);
  }

  async clearAll(): Promise<void> {
    await this.store.clear();
  }

  async buildExport(
    state: StudyProgressState,
    courseVersion: string,
    courseId: string,
    settings?: AppSettings,
    includeApiKey = false,
  ): Promise<ExportBundle> {
    const clonedSettings = settings
      ? {
          ...settings,
          ai: { ...settings.ai, apiKey: includeApiKey ? settings.ai.apiKey : "" },
        }
      : undefined;

    return {
      schemaVersion: 1,
      exportedAt: Date.now(),
      app: "ai-xingtu",
      courseVersion,
      courseId,
      progress: state,
      settings: clonedSettings,
    };
  }
}

const questionSchema = z.object({
  id: z.string(),
  type: z.string(),
  points: z.number(),
  prompt: z.string(),
  answer: z.string(),
  answerAlternatives: z.array(z.string()).optional(),
  knowledgePointId: z.string().optional(),
  knowledgePointTitle: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  code: z.string().optional(),
  sourceRef: z
    .object({
      sectionId: z.string().optional(),
      sectionTitle: z.string().optional(),
      quote: z.string().optional(),
    })
    .optional(),
  options: z.array(z.object({ key: z.string(), text: z.string() })).optional(),
  rubric: z
    .object({
      criteria: z.array(
        z.object({ point: z.string(), keywords: z.array(z.string()), points: z.number() }),
      ),
      notes: z.string().optional(),
    })
    .optional(),
  explanation: z.string().optional(),
});

const attemptSchema = z.object({
  id: z.string(),
  chapterId: z.string(),
  paperId: z.string(),
  paperSource: z.enum(["ai", "local"]),
  createdAt: z.number(),
  durationMs: z.number(),
  studyPoints: z.number(),
  examScore: z.number(),
  total: z.number(),
  passed: z.boolean(),
  star: z.enum(["gold", "silver", "bronze", "normal", "failed"]),
  grades: z.array(z.any()),
  answers: z.record(z.string(), z.string()),
  questions: z.array(questionSchema),
  gradedBy: z.enum(["auto", "ai", "local-rubric"]),
});

const progressSchema = z.object({
  chapterProgress: z.record(
    z.string(),
    z.object({
      chapterId: z.string(),
      guideAck: z.boolean(),
      sectionsRead: z.array(z.string()),
      checks: z.record(
        z.string(),
        z.object({ answered: z.boolean(), correct: z.boolean(), answer: z.string().optional(), at: z.number().optional() }),
      ),
      summaryRead: z.boolean(),
      summaryBookmarked: z.boolean().optional(),
      summaryChecklist: z.array(z.string()).optional(),
      lastSectionId: z.string().optional(),
      notes: z.string().optional(),
      updatedAt: z.number(),
    }),
  ),
  attempts: z.array(attemptSchema),
  wrong: z.array(z.any()),
  lastLocation: z
    .object({
      chapterId: z.string(),
      sectionId: z.string().optional(),
      tab: z.enum(["guide", "learn", "summary", "exam"]),
      updatedAt: z.number(),
    })
    .nullable(),
});

const exportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.number(),
  app: z.literal("ai-xingtu"),
  courseVersion: z.string(),
  courseId: z.string(),
  progress: progressSchema,
  settings: z.any().optional(),
});

export type ImportResult =
  | { ok: true; bundle: ExportBundle; warnings: string[] }
  | { ok: false; errors: string[] };

export function parseExportBundle(raw: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["文件不是合法的 JSON"] };
  }

  const parsed = exportSchema.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".") || "根节点"}：${issue.message}`);
    return { ok: false, errors };
  }

  const bundle = parsed.data as ExportBundle;
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const attempt of bundle.progress.attempts) {
    if (ids.has(attempt.id)) warnings.push(`考试记录 id 重复：${attempt.id}`);
    ids.add(attempt.id);
    if (attempt.total !== attempt.studyPoints + attempt.examScore) {
      warnings.push(`记录 ${attempt.id} 的总分与学习分/考试分之和不一致，将按导入值保留`);
    }
  }

  return { ok: true, bundle, warnings };
}

export function mergeStateLists(
  current: StudyProgressState,
  incoming: StudyProgressState,
): StudyProgressState {
  const attempts = new Map<string, ExamAttempt>();
  for (const attempt of [...current.attempts, ...incoming.attempts]) attempts.set(attempt.id, attempt);
  const wrong = new Map<string, WrongEntry>();
  for (const entry of [...current.wrong, ...incoming.wrong]) wrong.set(entry.id, entry);
  return {
    chapterProgress: { ...current.chapterProgress, ...incoming.chapterProgress },
    attempts: [...attempts.values()].sort((a, b) => b.createdAt - a.createdAt),
    wrong: [...wrong.values()].sort((a, b) => b.createdAt - a.createdAt),
    lastLocation: (incoming.lastLocation?.updatedAt ?? 0) > (current.lastLocation?.updatedAt ?? 0)
      ? incoming.lastLocation
      : current.lastLocation,
  };
}
