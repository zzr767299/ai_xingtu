import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { WrongEntry } from "../types";
import { useApp } from "../state/AppContext";
import { Badge, Button, Card, EmptyState, LinkButton, cn } from "../components/ui";
import { CodeBlock, MarkdownText } from "../components/Markdown";
import { questionTypeLabel } from "../lib/domain/exam";
import { gradeObjective, gradeSubjectiveLocal } from "../lib/domain/exam";
import { buildStudyCheck } from "../lib/domain/localContent";
import { formatRelative } from "../lib/utils/format";
import { AiError } from "../lib/ai/provider";

type StatusFilter = "unresolved" | "resolved" | "all";

export function ReviewPage() {
  const { progress, chapters, chapterById, statuses } = useApp();
  const [status, setStatus] = useState<StatusFilter>("unresolved");
  const [chapterFilter, setChapterFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pointFilter, setPointFilter] = useState("all");
  const [query, setQuery] = useState("");

  const chapterOptions = useMemo(() => {
    const ids = new Set(progress.wrong.map((entry) => entry.chapterId));
    return chapters.filter((chapter) => ids.has(chapter.id));
  }, [chapters, progress.wrong]);

  const typeOptions = useMemo(
    () => [...new Set(progress.wrong.map((entry) => entry.question.type))],
    [progress.wrong],
  );

  const pointOptions = useMemo(
    () =>
      [...new Set(progress.wrong.map((entry) => entry.knowledgePointTitle).filter((item): item is string => Boolean(item)))].slice(0, 80),
    [progress.wrong],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return progress.wrong
      .filter((entry) => {
        if (status === "unresolved" && entry.resolved) return false;
        if (status === "resolved" && !entry.resolved) return false;
        if (chapterFilter !== "all" && entry.chapterId !== chapterFilter) return false;
        if (typeFilter !== "all" && entry.question.type !== typeFilter) return false;
        if (pointFilter !== "all" && entry.knowledgePointTitle !== pointFilter) return false;
        if (!keyword) return true;
        const haystack = `${entry.question.prompt} ${entry.feedback} ${entry.knowledgePointTitle ?? ""} ${entry.userAnswer}`.toLowerCase();
        return haystack.includes(keyword);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [progress.wrong, status, chapterFilter, typeFilter, pointFilter, query]);

  const unresolved = progress.wrong.filter((entry) => !entry.resolved).length;
  const mastered = progress.wrong.length - unresolved;
  const lostTotal = progress.wrong.reduce((sum, entry) => sum + entry.lostPoints, 0);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-6">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.28em] text-dim">Review Vault</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">错题本与复习</h1>
        <p className="mt-1 text-sm text-muted">
          失分题按知识点归档。重新作答或做同类新题，确认掌握后标记「已掌握」。
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-dim">待复习</div>
          <div className="mt-1 text-2xl font-semibold text-gold">{unresolved}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-dim">已掌握</div>
          <div className="mt-1 text-2xl font-semibold text-ok">{mastered}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-dim">累计失分</div>
          <div className="mt-1 text-2xl font-semibold text-ink">{lostTotal}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-dim">覆盖章节</div>
          <div className="mt-1 text-2xl font-semibold text-cyan">{new Set(progress.wrong.map((entry) => entry.chapterId)).size}</div>
        </Card>
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-panel2/60 p-0.5">
            {(
              [
                ["unresolved", "待复习"],
                ["resolved", "已掌握"],
                ["all", "全部"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px]",
                  status === value ? "bg-cyan/15 text-cyan" : "text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={chapterFilter}
            onChange={(event) => setChapterFilter(event.target.value)}
            className="max-w-[220px] rounded-lg border border-line bg-panel2/60 px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-cyan/50"
            aria-label="按章节筛选"
          >
            <option value="all">全部章节</option>
            {chapterOptions.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="rounded-lg border border-line bg-panel2/60 px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-cyan/50"
            aria-label="按题型筛选"
          >
            <option value="all">全部题型</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {questionTypeLabel(type)}
              </option>
            ))}
          </select>
          <select
            value={pointFilter}
            onChange={(event) => setPointFilter(event.target.value)}
            className="max-w-[200px] rounded-lg border border-line bg-panel2/60 px-2.5 py-1.5 text-[11px] text-ink outline-none focus:border-cyan/50"
            aria-label="按知识点筛选"
          >
            <option value="all">全部知识点</option>
            {pointOptions.map((point) => (
              <option key={point} value={point}>
                {point}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索题目 / 知识点 / 反馈"
            className="ml-auto w-56 rounded-lg border border-line bg-panel2/60 px-3 py-1.5 text-[11px] text-ink outline-none placeholder:text-dim focus:border-cyan/50"
          />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          title={progress.wrong.length === 0 ? "还没有错题" : "没有符合条件的错题"}
          description={
            progress.wrong.length === 0
              ? "完成章节考试后，所有失分题会自动进入错题本，并附上你的答案、参考答案与评分反馈。"
              : "调整筛选条件，或切换「全部」查看所有记录。"
          }
          action={<LinkButton to="/map" size="sm">去星图挑战</LinkButton>}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <WrongCard
              key={entry.id}
              entry={entry}
              chapterTitle={chapterById(entry.chapterId)?.title ?? entry.chapterId}
              unlocked={Boolean(statuses[entry.chapterId]?.unlocked)}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-dim">
        错题记录保存在本地 IndexedDB，可随时在设置中导出备份。重新考试不会删除历史错题记录。
      </p>
    </div>
  );
}

function WrongCard({
  entry,
  chapterTitle,
  unlocked,
}: {
  entry: WrongEntry;
  chapterTitle: string;
  unlocked: boolean;
}) {
  const { chapterById, glossary, loadChapterContent, setWrongResolved, notify, ai } = useApp();
  const [open, setOpen] = useState(false);
  const [retryAnswer, setRetryAnswer] = useState("");
  const [retryResult, setRetryResult] = useState<{ score: number; max: number; feedback: string } | null>(null);
  const [similar, setSimilar] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    prompt?: string;
    answer?: string;
    explanation?: string;
    source?: "ai" | "local";
    error?: string;
    check?: { prompt: string; options: { key: string; text: string }[]; answer: string; explanation: string };
    chosen?: string;
  }>({ status: "idle" });

  const chapter = chapterById(entry.chapterId);

  const gradeRetry = () => {
    if (!retryAnswer.trim()) return;
    const grade =
      entry.question.type === "choice" || entry.question.type === "fill"
        ? gradeObjective(entry.question, retryAnswer)
        : gradeSubjectiveLocal(entry.question, retryAnswer);
    setRetryResult({ score: grade.score, max: entry.question.points, feedback: grade.feedback });
    if (grade.score >= entry.question.points) {
      setWrongResolved(entry.id, true);
      notify("已达到满分，已标记为掌握", "success");
    }
  };

  const generateSimilar = async () => {
    if (!chapter) return;
    setSimilar({ status: "loading" });
    const content = await loadChapterContent(chapter.id);
    if (!content) {
      setSimilar({ status: "error", error: "章节内容加载失败，无法生成同类题。" });
      return;
    }
    if (ai.isAvailable()) {
      try {
        const result = await ai.similarQuestion(chapter, content, glossary, entry);
        setSimilar({
          status: "ready",
          source: "ai",
          prompt: result.prompt,
          answer: result.answer,
          explanation: result.explanation,
        });
        return;
      } catch (caught) {
        setSimilar({
          status: "error",
          error:
            caught instanceof AiError
              ? caught.message
              : caught instanceof Error
                ? caught.message
                : String(caught),
        });
        return;
      }
    }

    const section =
      content.sections.find((item) => item.id === entry.sectionId) ??
      content.sections.find((item) => item.title === entry.knowledgePointTitle) ??
      content.sections[0];
    const check = buildStudyCheck(chapter, section, glossary, content.sections);
    setSimilar({
      status: "ready",
      source: "local",
      prompt: check.prompt,
      answer: check.options.find((option) => option.key === check.answer)?.text ?? "",
      explanation: check.explanation,
      check: { ...check, answer: check.answer },
    });
  };

  return (
    <Card className={cn("overflow-hidden", entry.resolved && "opacity-75")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
      >
        <span className="mt-1 text-sm" aria-hidden="true">
          {entry.resolved ? "✓" : "✎"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={entry.resolved ? "ok" : "gold"}>{entry.resolved ? "已掌握" : "待复习"}</Badge>
            <Badge tone="neutral">{questionTypeLabel(entry.question.type)}</Badge>
            <span className="text-[11px] text-dim">失分 {entry.lostPoints}</span>
            <span className="text-[11px] text-dim">{formatRelative(entry.createdAt)}</span>
          </span>
          <span className="mt-1 block truncate text-[12.5px] text-ink">
            {entry.question.prompt.replace(/```[\s\S]*?```/g, "[代码]").replace(/\n+/g, " ").slice(0, 110)}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-dim">
            {chapterTitle}
            {entry.knowledgePointTitle ? ` · ${entry.knowledgePointTitle}` : ""}
          </span>
        </span>
        <span className="text-[10px] text-dim">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-line/50 px-4 py-3">
          <MarkdownText text={entry.question.prompt} className="text-[13px]" />
          {entry.question.code && !entry.question.prompt.includes("```") && (
            <CodeBlock code={entry.question.code} lang={entry.question.codeLang ?? "text"} />
          )}

          <div className="mt-3 grid gap-2 text-[12px] leading-relaxed sm:grid-cols-2">
            <div className="rounded-lg border border-danger/25 bg-danger/[0.06] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-danger/80">你的答案</div>
              <div className="mt-1 whitespace-pre-wrap text-prose">{entry.userAnswer || "（未作答）"}</div>
            </div>
            <div className="rounded-lg border border-ok/25 bg-ok/[0.05] p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-ok/80">参考答案</div>
              <div className="mt-1 whitespace-pre-wrap text-prose">{entry.question.answer}</div>
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-line/60 bg-panel2/40 p-2.5 text-[12px] leading-relaxed text-muted">
            <span className="text-dim">评分反馈：</span>
            {entry.feedback}
            <span className="ml-2 text-[10px] text-dim">
              {entry.gradedBy === "ai" ? "（AI 阅卷）" : entry.gradedBy === "local-rubric" ? "（本地关键词判分）" : "（自动判分）"}
            </span>
          </div>

          {entry.question.rubric && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-muted">
              {entry.question.rubric.criteria.map((criterion) => (
                <li key={criterion.point}>
                  · {criterion.point}（{criterion.points} 分｜关键词：{criterion.keywords.join("、")}）
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3">
            <div className="text-[11px] font-medium text-cyan">重新作答</div>
            <div className="mt-2">
              {entry.question.type === "choice" && entry.question.options ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {entry.question.options.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setRetryAnswer(option.key)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-left text-[12px]",
                        retryAnswer === option.key
                          ? "border-cyan/60 bg-cyan/10 text-ink"
                          : "border-line bg-panel2/40 text-muted hover:border-cyan/30",
                      )}
                    >
                      <span className="mr-1.5 font-mono text-[10px] text-dim">{option.key}</span>
                      {option.text}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  value={retryAnswer}
                  onChange={(event) => setRetryAnswer(event.target.value)}
                  rows={3}
                  placeholder="写下你的新答案…"
                  className="w-full resize-y rounded-lg border border-line bg-panel2/50 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-dim focus:border-cyan/50"
                />
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={gradeRetry} disabled={!retryAnswer.trim()}>
                提交重答
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void generateSimilar()} disabled={similar.status === "loading"}>
                {similar.status === "loading" ? "生成中…" : "生成同类新题"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setWrongResolved(entry.id, !entry.resolved)}
              >
                {entry.resolved ? "标记为待复习" : "标记已掌握"}
              </Button>
              {unlocked && chapter && (
                <Link to={`/learn/${chapter.id}?tab=summary`} className="ml-auto text-[11px] text-cyan hover:underline">
                  回看本章总结 →
                </Link>
              )}
            </div>
            {retryResult && (
              <div className="mt-2 rounded-lg border border-line/60 bg-panel2/50 px-3 py-2 text-[12px] text-muted">
                重答得分 <span className="font-semibold text-ink">{retryResult.score}/{retryResult.max}</span> · {retryResult.feedback}
              </div>
            )}
          </div>

          {similar.status === "error" && (
            <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
              同类题生成失败：{similar.error}
            </div>
          )}

          {similar.status === "ready" && similar.prompt && (
            <div className="mt-3 rounded-xl border border-gold/25 bg-gold/[0.04] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-gold">同类新题</span>
                <span className="text-[10px] text-dim">
                  {similar.source === "ai" ? "AI 生成" : "本地生成（未配置 AI）"}
                </span>
              </div>
              <MarkdownText text={similar.prompt} className="mt-1.5 text-[12.5px]" />
              {similar.check && (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {similar.check.options.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setSimilar((previous) => ({ ...previous, chosen: option.key }))}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-left text-[12px]",
                        similar.chosen === option.key
                          ? "border-gold/50 bg-gold/10 text-ink"
                          : "border-line bg-panel2/40 text-muted hover:border-gold/30",
                      )}
                    >
                      <span className="mr-1.5 font-mono text-[10px] text-dim">{option.key}</span>
                      {option.text}
                    </button>
                  ))}
                </div>
              )}
              {similar.check && similar.chosen && (
                <div className="mt-1.5 text-[11.5px] text-muted">
                  {similar.chosen === similar.check.answer ? "✓ 回答正确" : "✗ 回答错误"} — {similar.check.explanation}
                </div>
              )}
              {!similar.check && similar.answer && (
                <details className="mt-2 rounded-lg border border-line/60 bg-panel2/40 p-2 text-[11.5px] text-muted">
                  <summary className="cursor-pointer text-[11px] text-cyan">查看参考答案</summary>
                  <div className="mt-1.5">{similar.answer}</div>
                  {similar.explanation && <div className="mt-1 text-[11px] text-dim">{similar.explanation}</div>}
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
