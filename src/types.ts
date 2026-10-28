export interface SourceInfo {
  repo: string;
  site: string;
  license: string;
  copyright: string;
}

export interface ChapterMeta {
  id: string;
  areaId: string;
  groupTitle: string | null;
  order: number;
  title: string;
  sourcePath: string;
  sourceUrl: string;
  onlineUrl: string;
  objectives: string[];
  advice: string;
  resources: string;
  estimateMinutes: number;
  chars: number;
  codeBlocks: number;
  imageCount: number;
  profile: "concept" | "mixed" | "code-heavy";
  contentHash: string;
  sections: { id: string; title: string; chars: number }[];
  terms: string[];
  quizCount: number;
}

export interface AreaMeta {
  id: string;
  order: number;
  code: string;
  title: string;
  fullTitle: string;
  groups: { title: string; chapterIds: string[] }[];
  chapterIds: string[];
}

export interface CourseData {
  schemaVersion: number;
  courseId: string;
  title: string;
  version: string;
  generatedAt: string;
  commit: string;
  source: SourceInfo;
  stats: { areas: number; chapters: number; chars: number; blocks: number };
  areas: AreaMeta[];
  chapters: ChapterMeta[];
}

export type BlockKind =
  | "paragraph"
  | "ul"
  | "ol"
  | "table"
  | "quote"
  | "html"
  | "heading"
  | "hr"
  | "h3"
  | "code"
  | "img";

export interface ContentBlock {
  k: BlockKind;
  html?: string;
  text?: string;
  lang?: string;
  code?: string;
  src?: string;
  alt?: string;
}

export interface ChapterSection {
  id: string;
  title: string;
  subheadings: { id: string; title: string }[];
  chars: number;
  blocks: ContentBlock[];
}

export interface ChapterContent {
  schemaVersion: number;
  id: string;
  contentHash: string;
  intro: ContentBlock[];
  sections: ChapterSection[];
}

export interface GlossaryTerm {
  term: string;
  summary: string;
  note: string;
  refs: { text: string; target: string }[];
  group: string;
}

export interface GlossaryContrast {
  id: string;
  title: string;
  detail: string;
  items?: { name: string; text: string }[];
}

export interface Glossary {
  terms: GlossaryTerm[];
  contrasts: GlossaryContrast[];
}

/* ---------------- 学习进度 ---------------- */

export interface CheckAnswer {
  answered: boolean;
  correct: boolean;
  answer?: string;
  at?: number;
}

export interface ChapterProgress {
  chapterId: string;
  guideAck: boolean;
  sectionsRead: string[];
  checks: Record<string, CheckAnswer>;
  summaryRead: boolean;
  summaryBookmarked?: boolean;
  /** 已勾选的自测清单条目（存条目文本，AI 重新生成后对不上的自动视为未勾选） */
  summaryChecklist?: string[];
  lastSectionId?: string;
  notes?: string;
  updatedAt: number;
}

export interface LastLocation {
  chapterId: string;
  sectionId?: string;
  tab: "guide" | "learn" | "summary" | "exam";
  updatedAt: number;
}

export type StarTier = "gold" | "silver" | "bronze" | "normal" | "failed";

/* ---------------- 考试 ---------------- */

export type QuestionType =
  | "choice"
  | "fill"
  | "contrast"
  | "application"
  | "code-read"
  | "code-fill"
  | "practice"
  | "design";

export interface RubricCriterion {
  point: string;
  keywords: string[];
  points: number;
}

export interface ExamQuestion {
  id: string;
  type: QuestionType;
  points: number;
  knowledgePointId?: string;
  knowledgePointTitle?: string;
  prompt: string;
  options?: { key: string; text: string }[];
  answer: string;
  answerAlternatives?: string[];
  rubric?: { criteria: RubricCriterion[]; notes?: string };
  explanation: string;
  sourceRef?: { sectionId?: string; sectionTitle?: string; quote?: string };
  difficulty: "easy" | "medium" | "hard";
  /** 代码题展示用的代码；代码补全题存放挖空后的代码，不存放原答案行 */
  code?: string;
  codeLang?: string;
}

export interface QuestionGrade {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  feedback: string;
  hits: string[];
  misses: string[];
  gradedBy: "auto" | "ai" | "local-rubric";
  error?: string;
}

export interface Paper {
  id: string;
  chapterId: string;
  generatedAt: number;
  source: "ai" | "local";
  sourceNote: string;
  templateId: string;
  questions: ExamQuestion[];
  contentHash: string;
}

export interface ExamAttempt {
  id: string;
  chapterId: string;
  paperId: string;
  paperSource: "ai" | "local";
  createdAt: number;
  durationMs: number;
  studyPoints: number;
  examScore: number;
  total: number;
  passed: boolean;
  star: StarTier;
  grades: QuestionGrade[];
  answers: Record<string, string>;
  questions: ExamQuestion[];
  gradedBy: "auto" | "ai" | "local-rubric";
}

export interface WrongEntry {
  id: string;
  chapterId: string;
  sectionId?: string;
  knowledgePointTitle?: string;
  question: ExamQuestion;
  userAnswer: string;
  feedback: string;
  lostPoints: number;
  createdAt: number;
  attemptId: string;
  resolved: boolean;
  gradedBy?: "auto" | "ai" | "local-rubric";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
  contextSectionId?: string;
}

export interface AiSettings {
  enabled: boolean;
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
  proxyUrl: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export type AppTheme = "dark" | "paper";

export interface AppSettings {
  ai: AiSettings;
  theme: AppTheme;
  reduceMotion: boolean;
  dailyGoalMinutes: number;
  displayName: string;
}

export interface StudyProgressState {
  chapterProgress: Record<string, ChapterProgress>;
  attempts: ExamAttempt[];
  wrong: WrongEntry[];
  lastLocation: LastLocation | null;
}

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: number;
  app: string;
  courseVersion: string;
  courseId: string;
  progress: StudyProgressState;
  settings?: Partial<AppSettings>;
  notes?: Record<string, string>;
  checksum?: string;
}
