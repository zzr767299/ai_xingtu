import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ChapterContent,
  ChapterMeta,
  ExamAttempt,
  ExamQuestion,
  Paper,
  QuestionGrade,
  WrongEntry,
} from "../../types";
import { useApp } from "../../state/AppContext";
import { Badge, Button, Card, LinkButton, Modal, cn } from "../../components/ui";
import { StarShape } from "../../components/StarIcon";
import { CodeBlock, MarkdownText } from "../../components/Markdown";
import {
  gradeObjective,
  gradeSubjectiveLocal,
  isObjectiveType,
  questionTypeLabel,
  selectTemplate,
  summarizeAttempt,
  validatePaper,
} from "../../lib/domain/exam";
import { generateLocalPaper } from "../../lib/domain/localContent";
import { starLabel } from "../../lib/domain/rules";
import { AiError } from "../../lib/ai/provider";
import { formatDuration, formatRelative } from "../../lib/utils/format";

type Phase = "intro" | "generating" | "generate-error" | "answering" | "grading" | "grading-error" | "result";

export function ExamTab({ chapter, content }: { chapter: ChapterMeta; content: ChapterContent }) {
  const {
    ai,
    glossary,
    progress,
    studyPointsFor,
    saveAttempt,
    repo,
    notify,
    course,
  } = useApp();

  const study = studyPointsFor(chapter.id);
  const template = selectTemplate(chapter);
  const attempts = useMemo(
    () =>
      progress.attempts
        .filter((attempt) => attempt.chapterId === chapter.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    [progress.attempts, chapter.id],
  );

  const [phase, setPhase] = useState<Phase>("intro");
  const [paper, setPaper] = useState<Paper | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [result, setResult] = useState<ExamAttempt | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [restoredDraft, setRestoredDraft] = useState(false);
  const restoredRef = useRef(false);

  const nextChapter = course.chapters.find((item) => item.order === chapter.order + 1);

  useEffect(() => {
    if (phase !== "answering") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void repo.getDraft(chapter.id).then((draft) => {
      if (!draft) return;
      const validation = validatePaper(draft.paper.questions, 80);
      if (!validation.ok) {
        void repo.clearDraft(chapter.id);
        return;
      }
      setPaper(draft.paper);
      setAnswers(draft.answers);
      setStartedAt(draft.startedAt);
      setPhase("answering");
      setRestoredDraft(true);
      notify("已恢复上次未提交的试卷", "info");
    });
  }, [chapter.id, notify, repo]);

  useEffect(() => {
    if (phase !== "answering" || !paper) return;
    const timer = setTimeout(() => {
      void repo.saveDraft({ chapterId: chapter.id, paper, answers, startedAt });
    }, 400);
    return () => clearTimeout(timer);
  }, [answers, paper, startedAt, phase, chapter.id, repo]);

  const resetExam = () => {
    setPaper(null);
    setAnswers({});
    setStartedAt(0);
    setResult(null);
    setGenerateError(null);
    setGradeError(null);
    setRestoredDraft(false);
    setPhase("intro");
    void repo.clearDraft(chapter.id);
  };

  const startExam = useCallback(
    async (mode: "ai" | "local") => {
      setPhase("generating");
      setGenerateError(null);
      const sequence = attempts.length + 1;

      if (mode === "ai") {
        try {
          const result = await ai.paper(chapter, content, glossary, template, sequence);
          const validation = validatePaper(result.data.questions, 80);
          if (!validation.ok) {
            throw new AiError(
              "invalid-response",
              `AI 试卷未通过校验：${validation.errors.slice(0, 3).join("；")}`,
            );
          }
          const nextPaper: Paper = {
            id: `${chapter.id}-${sequence}-ai`,
            chapterId: chapter.id,
            generatedAt: Date.now(),
            source: "ai",
            sourceNote: `AI 命题 · ${ai.ai.model}`,
            templateId: template.id,
            questions: result.data.questions,
            contentHash: chapter.contentHash,
          };
          setPaper(nextPaper);
          setAnswers({});
          setStartedAt(Date.now());
          setPhase("answering");
        } catch (caught) {
          setGenerateError(
            caught instanceof AiError
              ? caught.message
              : caught instanceof Error
                ? caught.message
                : String(caught),
          );
          setPhase("generate-error");
        }
        return;
      }

      const questions = generateLocalPaper(chapter, content, glossary);
      const validation = validatePaper(questions, 80);
      if (!validation.ok) {
        setGenerateError(`本地题库生成异常：${validation.errors.join("；")}`);
        setPhase("generate-error");
        return;
      }
      const nextPaper: Paper = {
        id: `${chapter.id}-${sequence}-local`,
        chapterId: chapter.id,
        generatedAt: Date.now(),
        source: "local",
        sourceNote: "本地题库 · 基于章节原文生成",
        templateId: template.id,
        questions,
        contentHash: chapter.contentHash,
      };
      setPaper(nextPaper);
      setAnswers({});
      setStartedAt(Date.now());
      setPhase("answering");
    },
    [ai, attempts.length, chapter, content, glossary, template],
  );

  const finalize = useCallback(
    async (paperValue: Paper, grades: QuestionGrade[]) => {
      const summary = summarizeAttempt(study.total, grades);
      const attempt: ExamAttempt = {
        id: `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        chapterId: chapter.id,
        paperId: paperValue.id,
        paperSource: paperValue.source,
        createdAt: Date.now(),
        durationMs: Math.max(0, Date.now() - startedAt),
        studyPoints: study.total,
        examScore: summary.examScore,
        total: summary.total,
        passed: summary.passed,
        star: summary.star,
        grades,
        answers,
        questions: paperValue.questions,
        gradedBy: grades.some((grade) => grade.gradedBy === "ai")
          ? "ai"
          : grades.some((grade) => grade.gradedBy === "local-rubric")
            ? "local-rubric"
            : "auto",
      };

      const gradeMap = new Map(grades.map((grade) => [grade.questionId, grade]));
      const wrongs: WrongEntry[] = paperValue.questions
        .map((question) => {
          const grade = gradeMap.get(question.id);
          if (!grade || grade.score >= question.points) return null;
          const entry: WrongEntry = {
            id: `${attempt.id}:${question.id}`,
            chapterId: chapter.id,
            sectionId: question.sourceRef?.sectionId ?? question.knowledgePointId,
            knowledgePointTitle: question.knowledgePointTitle ?? question.sourceRef?.sectionTitle,
            question,
            userAnswer: answers[question.id] ?? "",
            feedback: grade.feedback,
            lostPoints: question.points - grade.score,
            createdAt: Date.now(),
            attemptId: attempt.id,
            resolved: false,
            gradedBy: grade.gradedBy,
          };
          return entry;
        })
        .filter((entry): entry is WrongEntry => Boolean(entry));

      await saveAttempt(attempt, wrongs);
      await repo.clearDraft(chapter.id);
      setResult(attempt);
      setPhase("result");
    },
    [answers, chapter.id, repo, saveAttempt, startedAt, study.total],
  );

  const submit = useCallback(
    async (forceLocal = false) => {
      if (!paper) return;
      setConfirmSubmit(false);
      setPhase("grading");
      setGradeError(null);

      const objective = paper.questions.filter((question) => isObjectiveType(question.type));
      const subjective = paper.questions.filter((question) => !isObjectiveType(question.type));
      const objectiveGrades = objective.map((question) => gradeObjective(question, answers[question.id] ?? ""));

      let subjectiveGrades: QuestionGrade[] = [];
      if (subjective.length > 0) {
        if (forceLocal || !ai.isAvailable()) {
          subjectiveGrades = subjective.map((question) => gradeSubjectiveLocal(question, answers[question.id] ?? ""));
        } else {
          try {
            subjectiveGrades = await ai.gradeSubjective(subjective, answers);
          } catch (caught) {
            setGradeError(
              caught instanceof AiError
                ? caught.message
                : caught instanceof Error
                  ? caught.message
                  : String(caught),
            );
            setPhase("grading-error");
            return;
          }
        }
      }

      const gradeMap = new Map([...objectiveGrades, ...subjectiveGrades].map((grade) => [grade.questionId, grade]));
      const grades = paper.questions.map(
        (question) =>
          gradeMap.get(question.id) ?? {
            questionId: question.id,
            score: 0,
            maxScore: question.points,
            correct: false,
            feedback: "缺少评分结果。",
            hits: [],
            misses: [],
            gradedBy: "auto" as const,
          },
      );
      await finalize(paper, grades);
    },
    [ai, answers, finalize, paper],
  );

  if (study.total < 20) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            ⚑
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink">正式考试尚未解锁</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              考试满分 80 分，需要先完成全部必修学习任务（20 分）。当前 {study.total}/20。
            </p>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {(
            [
              ["guide", "完成 AI 导读与目标确认", 2, study.tasks.guide],
              ["learn", `完成全部知识点学习（${study.readCount}/${study.totalSections}）`, 8, study.tasks.sections],
              ["learn", `完成章节互动检查（${study.answeredChecks}/${study.totalChecks}）`, 6, study.tasks.checks],
              ["summary", "阅读并确认 AI 图文总结", 4, study.tasks.summary],
            ] as const
          ).map(([tab, label, points, done]) => (
            <li
              key={label}
              className="flex items-center gap-2 rounded-lg border border-line/60 bg-panel2/40 px-3 py-2 text-[12.5px]"
            >
              <span className={cn("text-xs", done ? "text-ok" : "text-dim")} aria-hidden="true">
                {done ? "✓" : "○"}
              </span>
              <span className={done ? "text-muted line-through" : "text-ink"}>{label}</span>
              <span className="ml-auto text-[11px] text-dim">+{points}</span>
              {!done && (
                <a href={`#/learn/${chapter.id}?tab=${tab}`} className="text-[11px] text-cyan hover:underline">
                  去完成
                </a>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-dim">
          学习检查的答对率只用于反馈，不直接计入考试分，也不会重复计分。
        </p>
      </Card>
    );
  }

  if (phase === "intro") {
    const totalQuestions = template.slots.reduce((sum, slot) => sum + slot.count, 0);
    return (
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-dim">CHAPTER EXAM</p>
              <h2 className="mt-1 text-lg font-semibold text-ink">章节考试 · {chapter.title}</h2>
            </div>
            <Badge tone={ai.isAvailable() ? "cyan" : "neutral"}>
              {ai.isAvailable() ? "AI 命题可用" : "AI 未配置 · 本地题库"}
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line/60 bg-panel2/40 p-3 text-center">
              <div className="text-[10px] text-dim">试卷满分</div>
              <div className="text-2xl font-semibold text-ink">80</div>
              <div className="text-[10px] text-dim">{totalQuestions} 道题</div>
            </div>
            <div className="rounded-xl border border-line/60 bg-panel2/40 p-3 text-center">
              <div className="text-[10px] text-dim">学习分</div>
              <div className="text-2xl font-semibold text-gold">{study.total}</div>
              <div className="text-[10px] text-dim">满分 20</div>
            </div>
            <div className="rounded-xl border border-line/60 bg-panel2/40 p-3 text-center">
              <div className="text-[10px] text-dim">通关线</div>
              <div className="text-2xl font-semibold text-cyan">60</div>
              <div className="text-[10px] text-dim">总分 = 学习 + 考试</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line/60 bg-panel2/30 p-3">
            <div className="text-xs font-medium text-ink">题型与分值分配（{template.label}）</div>
            <ul className="mt-1.5 grid gap-1 text-[12px] text-muted sm:grid-cols-2">
              {template.slots.map((slot) => (
                <li key={slot.type} className="flex justify-between gap-2">
                  <span>{questionTypeLabel(slot.type)}</span>
                  <span className="tabular-nums">
                    {slot.count} × {slot.points} = {slot.count * slot.points} 分
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              选择题与填空题自动判分；主观题优先使用 AI 按评分细则阅卷。未配置 AI 时使用本地关键词估分，并明确标注。
              评分细则分值和严格等于题目分值，试卷总分严格等于 80 分。
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {ai.isAvailable() ? (
              <>
                <Button onClick={() => void startExam("ai")}>让 AI 出卷并开始</Button>
                <Button variant="secondary" onClick={() => void startExam("local")}>
                  使用本地题库
                </Button>
              </>
            ) : (
              <Button onClick={() => void startExam("local")}>使用本地题库开始考试</Button>
            )}
            <span className="text-[11px] text-dim">进入考试后可刷新页面，未提交试卷会自动恢复。</span>
          </div>
        </Card>

        {attempts.length > 0 && <AttemptHistory attempts={attempts} />}
      </div>
    );
  }

  if (phase === "generating") {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-cyan" />
        <p className="mt-4 text-sm text-ink">正在生成 80 分试卷…</p>
        <p className="mt-1 text-[11px] text-muted">AI 需要依据章节原文命题并校验分值，请稍候。</p>
      </Card>
    );
  }

  if (phase === "generate-error") {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">试卷生成失败</h2>
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-danger/40 bg-danger/10 p-3 text-[12px] leading-relaxed text-danger">
          {generateError}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          系统不会用不合法试卷开始考试。你可以重试 AI 命题，或明确切换到本地题库（基于原文生成，主观题使用关键词估分）。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ai.isAvailable() && (
            <Button size="sm" onClick={() => void startExam("ai")}>
              重试 AI 出卷
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => void startExam("local")}>
            使用本地题库
          </Button>
          <Button size="sm" variant="ghost" onClick={resetExam}>
            返回考试说明
          </Button>
        </div>
      </Card>
    );
  }

  if (phase === "grading") {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-cyan" />
        <p className="mt-4 text-sm text-ink">正在阅卷…</p>
        <p className="mt-1 text-[11px] text-muted">客观题自动判分，主观题按评分细则评分。</p>
      </Card>
    );
  }

  if (phase === "grading-error") {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">AI 阅卷失败</h2>
        <p className="mt-2 whitespace-pre-wrap rounded-lg border border-danger/40 bg-danger/10 p-3 text-[12px] leading-relaxed text-danger">
          {gradeError}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          本次成绩尚未保存，不会被记为零分。你可以重试 AI 阅卷，或明确改用本地关键词判分（结果会标注为本地估分）。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void submit(false)}>
            重试 AI 阅卷
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void submit(true)}>
            改用本地关键词判分
          </Button>
        </div>
      </Card>
    );
  }

  if (phase === "result" && result) {
    return (
      <ExamResult
        attempt={result}
        chapter={chapter}
        nextChapterTitle={result.passed ? nextChapter?.title : undefined}
        onRetake={() => {
          resetExam();
          void startExam(ai.isAvailable() ? "ai" : "local");
        }}
      />
    );
  }

  if (!paper) return null;

  const elapsed = startedAt ? now - startedAt : 0;
  const answeredCount = paper.questions.filter((question) => (answers[question.id] ?? "").trim()).length;
  const unanswered = paper.questions.length - answeredCount;

  return (
    <div className="space-y-4">
      <Card className="sticky top-16 z-20 border-cyan/20 bg-panel/95 p-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <Badge tone={paper.source === "ai" ? "cyan" : "neutral"}>{paper.sourceNote}</Badge>
            <span>
              已答 {answeredCount}/{paper.questions.length}
            </span>
            <span>用时 {formatDuration(elapsed)}</span>
            <span>满分 80 · 学习分 {study.total}</span>
          </div>
          <Button size="sm" onClick={() => setConfirmSubmit(true)}>
            提交试卷
          </Button>
        </div>
        {restoredDraft && (
          <p className="mt-1.5 text-[11px] text-cyan">已从本地恢复未提交的试卷与答案。</p>
        )}
        {paper.source === "local" && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
            当前为本地题库：题目与参考答案取自章节原文；主观题按关键词估分，不等同于 AI 阅卷。
          </p>
        )}
      </Card>

      {paper.questions.map((question, index) => (
        <ExamQuestionCard
          key={question.id}
          index={index}
          question={question}
          value={answers[question.id] ?? ""}
          onChange={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <span className="text-[11px] text-dim">
          {unanswered > 0 ? `还有 ${unanswered} 题未作答` : "所有题目均已作答，可提交"}
        </span>
        <Button onClick={() => setConfirmSubmit(true)}>提交试卷</Button>
      </div>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title="确认提交试卷"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmSubmit(false)}>
              继续作答
            </Button>
            <Button size="sm" onClick={() => void submit(false)}>
              确认提交
            </Button>
          </>
        }
      >
        <p>
          共 {paper.questions.length} 题，已作答 {answeredCount} 题
          {unanswered > 0 ? `，未作答 ${unanswered} 题（按 0 分计）` : ""}。
        </p>
        <p className="mt-2">提交后本题成绩会保存到历史记录，错题进入错题本；你可以随时重新考试，不会删除历史记录。</p>
        {ai.isAvailable() ? (
          <p className="mt-2 text-[12px] text-cyan">主观题将由 AI 按评分细则阅卷，失败时可重试或改用本地判分。</p>
        ) : (
          <p className="mt-2 text-[12px] text-gold">未配置 AI：主观题将使用本地关键词估分，结果会明确标注。</p>
        )}
      </Modal>
    </div>
  );
}

function ExamQuestionCard({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: ExamQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Card className="p-5" as="section">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-cyan/70">Q{String(index + 1).padStart(2, "0")}</span>
        <Badge tone="neutral">{questionTypeLabel(question.type)}</Badge>
        <Badge tone="gold">{question.points} 分</Badge>
        {question.knowledgePointTitle && (
          <span className="text-[11px] text-dim">知识点：{question.knowledgePointTitle}</span>
        )}
        <span className="ml-auto text-[10px] text-dim">
          {question.difficulty === "easy" ? "基础" : question.difficulty === "medium" ? "进阶" : "挑战"}
        </span>
      </div>

      <div className="mt-2">
        <MarkdownText text={question.prompt} />
      </div>

      {question.code && !question.prompt.includes("```") && (
        <CodeBlock code={question.code} lang={question.codeLang ?? "text"} />
      )}

      {question.type === "choice" && question.options ? (
        <div className="mt-2 grid gap-1.5">
          {question.options.map((option) => (
            <label
              key={option.key}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed transition-colors",
                value === option.key
                  ? "border-cyan/60 bg-cyan/10 text-ink"
                  : "border-line/70 bg-panel2/40 text-muted hover:border-cyan/30",
              )}
            >
              <input
                type="radio"
                name={question.id}
                value={option.key}
                checked={value === option.key}
                onChange={() => onChange(option.key)}
                className="mt-1 accent-cyan"
              />
              <span>
                <span className="mr-1.5 font-mono text-[10px] text-dim">{option.key}</span>
                {option.text}
              </span>
            </label>
          ))}
        </div>
      ) : question.type === "fill" ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="填写术语或答案"
          className="mt-2 w-full rounded-lg border border-line bg-panel2/50 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-cyan/50"
        />
      ) : (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={question.type === "code-fill" ? 3 : 5}
          placeholder={
            question.type === "code-fill"
              ? "只填写缺失的那一行代码…"
              : "请分点作答：结论 + 依据 + 实际做法/风险…"
          }
          className="mt-2 w-full resize-y rounded-lg border border-line bg-panel2/50 px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-dim focus:border-cyan/50"
        />
      )}

      {(question.type === "code-read" || question.type === "code-fill" || question.type === "practice") && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">
          本题不会实际运行你的代码：评分依据关键代码要素与评分细则，结果会标注自动判分或估分。
        </p>
      )}

      {question.sourceRef?.sectionTitle && (
        <div className="mt-2 text-[10.5px] text-dim">原文知识点：{question.sourceRef.sectionTitle}</div>
      )}
    </Card>
  );
}

function ExamResult({
  attempt,
  chapter,
  nextChapterTitle,
  onRetake,
}: {
  attempt: ExamAttempt;
  chapter: ChapterMeta;
  nextChapterTitle?: string;
  onRetake: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const gradeMap = useMemo(
    () => new Map(attempt.grades.map((grade) => [grade.questionId, grade])),
    [attempt.grades],
  );

  const reviewPoints = useMemo(
    () =>
      [...new Set(
        attempt.questions
          .filter((question) => (gradeMap.get(question.id)?.score ?? 0) < question.points)
          .map((question) => question.knowledgePointTitle)
          .filter((item): item is string => Boolean(item)),
      )].slice(0, 6),
    [attempt.questions, gradeMap],
  );

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          "overflow-hidden p-6",
          attempt.passed ? "border-ok/30" : "border-danger/30",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <StarShape tier={attempt.star} size={52} glow={attempt.star === "gold"} />
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-dim">
                {attempt.passed ? "MISSION CLEARED" : "MISSION FAILED"}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums text-ink">{attempt.total}</span>
                <span className="text-sm text-muted">/ 100</span>
              </div>
              <div className="mt-0.5 text-[12px] text-muted">
                {starLabel(attempt.star)} · 学习 {attempt.studyPoints} + 考试 {attempt.examScore}
              </div>
            </div>
          </div>
          <div className="text-right text-[11px] text-muted">
            <div>用时 {formatDuration(attempt.durationMs)}</div>
            <div>{new Date(attempt.createdAt).toLocaleString("zh-CN")}</div>
            <div className="mt-0.5">
              {attempt.gradedBy === "ai" ? "AI 阅卷" : attempt.gradedBy === "local-rubric" ? "本地关键词判分" : "自动判分"}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line/60 bg-panel2/40 p-3 text-[12.5px] leading-relaxed">
          {attempt.passed ? (
            <p className="text-ok">
              已通关！{nextChapterTitle ? `下一颗星「${nextChapterTitle}」已解锁。` : "你已完成最后一个关卡，可以去错题本冲击更高星级。"}
            </p>
          ) : (
            <p className="text-danger">
              未达到 60 分通关线，后续关卡保持锁定。请先对照下方逐题反馈复习，再重新挑战；历史成绩与已解锁关卡不会因本次低分失效。
            </p>
          )}
          {attempt.paperSource === "local" && (
            <p className="mt-1 text-[11px] text-dim">
              本次使用本地题库，主观题分数为关键词估分，建议对照参考答案自评。
            </p>
          )}
        </div>

        {reviewPoints.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="text-dim">建议复习：</span>
            {reviewPoints.map((point) => (
              <Link
                key={point}
                to={`/learn/${chapter.id}?tab=summary`}
                className="rounded-md border border-gold/25 bg-gold/[0.06] px-2 py-0.5 text-gold/90 hover:border-gold/50"
              >
                {point}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetake}>
            再考一次
          </Button>
          <LinkButton to={`/learn/${chapter.id}?tab=summary`} variant="secondary" size="sm">
            回看总结
          </LinkButton>
          <LinkButton to="/review" variant="secondary" size="sm">
            去错题本
          </LinkButton>
          <LinkButton to="/map" variant="ghost" size="sm">
            返回星图
          </LinkButton>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink">逐题反馈</h2>
        <p className="mt-0.5 text-[11px] text-muted">点击题目查看参考答案、评分依据与命中/遗漏点。</p>
        <div className="mt-3 space-y-2">
          {attempt.questions.map((question, index) => {
            const grade = gradeMap.get(question.id);
            const open = expanded === question.id;
            return (
              <div key={question.id} className="overflow-hidden rounded-xl border border-line/60 bg-panel2/30">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : question.id)}
                  className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                >
                  <span className="font-mono text-[10px] text-dim">Q{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[12.5px] text-ink">
                      {question.prompt.replace(/```[\s\S]*?```/g, "[代码]").replace(/\n+/g, " ").slice(0, 90)}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-dim">
                      {questionTypeLabel(question.type)} · {grade?.gradedBy === "ai" ? "AI 阅卷" : grade?.gradedBy === "local-rubric" ? "本地估分" : "自动判分"}
                      {grade?.feedback ? ` · ${grade.feedback.slice(0, 40)}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 text-sm font-semibold tabular-nums",
                      (grade?.score ?? 0) >= question.points
                        ? "text-ok"
                        : (grade?.score ?? 0) > 0
                          ? "text-gold"
                          : "text-danger",
                    )}
                  >
                    {grade?.score ?? 0}/{question.points}
                  </span>
                  <span className="text-[10px] text-dim">{open ? "▲" : "▼"}</span>
                </button>

                {open && grade && (
                  <div className="border-t border-line/50 px-3 py-3 text-[12px] leading-relaxed text-muted">
                    {question.code && !question.prompt.includes("```") && (
                      <CodeBlock code={question.code} lang={question.codeLang ?? "text"} />
                    )}
                    <div>
                      <span className="text-dim">你的答案：</span>
                      <span className="whitespace-pre-wrap text-ink">{attempt.answers[question.id] || "（未作答）"}</span>
                    </div>
                    <div className="mt-1.5">
                      <span className="text-dim">参考答案：</span>
                      <span className="whitespace-pre-wrap text-prose">{question.answer}</span>
                    </div>
                    <div className="mt-1.5">
                      <span className="text-dim">评分反馈：</span>
                      {grade.feedback}
                    </div>
                    {question.rubric && (
                      <ul className="mt-1.5 space-y-0.5 text-[11.5px]">
                        {question.rubric.criteria.map((criterion) => (
                          <li key={criterion.point} className="flex gap-1.5">
                            <span className="text-dim">·</span>
                            <span>
                              {criterion.point}（{criterion.points} 分，关键词：{criterion.keywords.join("、")}）
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(grade.hits.length > 0 || grade.misses.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {grade.hits.map((hit) => (
                          <span key={`hit-${hit}`} className="rounded border border-ok/30 bg-ok/10 px-1.5 py-0.5 text-[10.5px] text-ok">
                            ✓ {hit}
                          </span>
                        ))}
                        {grade.misses.map((miss) => (
                          <span key={`miss-${miss}`} className="rounded border border-line bg-white/[0.03] px-1.5 py-0.5 text-[10.5px] text-dim">
                            ✗ {miss}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 text-[11px] text-dim">{question.explanation}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AttemptHistory({ attempts }: { attempts: ExamAttempt[] }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink">历次成绩</h2>
      <ul className="mt-2 divide-y divide-line/50">
        {attempts.map((attempt) => (
          <li key={attempt.id} className="flex items-center gap-3 py-2 text-[12px]">
            <StarShape tier={attempt.star} size={18} />
            <span className="text-muted">{formatRelative(attempt.createdAt)}</span>
            <span className={attempt.passed ? "text-ok" : "text-danger"}>
              {attempt.passed ? "通关" : "未通关"}
            </span>
            <span className="ml-auto tabular-nums text-ink">{attempt.total} 分</span>
            <span className="text-[10.5px] text-dim">
              {attempt.studyPoints} + {attempt.examScore} · {attempt.paperSource === "ai" ? "AI 卷" : "本地卷"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
