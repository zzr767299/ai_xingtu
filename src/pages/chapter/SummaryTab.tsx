import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChapterContent, ChapterMeta } from "../../types";
import { useApp } from "../../state/AppContext";
import { Badge, Button, Card, cn } from "../../components/ui";
import { CodeBlock } from "../../components/Markdown";
import { buildLocalSummary, type ChapterSummary, type MindmapNode } from "../../lib/domain/localContent";
import { AiError } from "../../lib/ai/provider";
import { formatDate } from "../../lib/utils/format";

type Status = "local" | "loading" | "ai" | "error";

export function SummaryTab({ chapter, content }: { chapter: ChapterMeta; content: ChapterContent }) {
  const { ai, glossary, progress, updateChapterProgress, notify } = useApp();
  const localSummary = useMemo(() => buildLocalSummary(chapter, content, glossary), [chapter, content, glossary]);
  const [summary, setSummary] = useState<ChapterSummary>(localSummary);
  const [status, setStatus] = useState<Status>(ai.isAvailable() ? "loading" : "local");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [cached, setCached] = useState(false);
  const requested = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chapterProgress = progress.chapterProgress[chapter.id];
  const confirmed = Boolean(chapterProgress?.summaryRead);
  const bookmarked = Boolean(chapterProgress?.summaryBookmarked);

  const generate = useCallback(
    async (force: boolean) => {
      if (!ai.isAvailable()) {
        setStatus("local");
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");
      setError(null);
      try {
        const result = await ai.summary(chapter, content, glossary, { force, signal: controller.signal });
        if (controller.signal.aborted) return;
        setSummary(result.data);
        setStatus("ai");
        setCached(result.cached);
        setModel(result.model);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(
          caught instanceof AiError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : String(caught),
        );
      }
    },
    [ai, chapter, content, glossary],
  );

  useEffect(() => {
    if (!ai.isAvailable()) {
      setStatus("local");
      return;
    }
    if (requested.current === chapter.id) return;
    requested.current = chapter.id;
    void generate(false);
    return () => abortRef.current?.abort();
  }, [chapter.id, ai, generate]);

  const display = status === "error" ? localSummary : summary;

  const confirm = () => {
    updateChapterProgress(chapter.id, (current) => ({ ...current, summaryRead: true }));
  };

  const copyAll = async () => {
    const text = buildMarkdownSummary(chapter.title, display);
    try {
      await navigator.clipboard.writeText(text);
      notify("总结已复制到剪贴板", "success");
    } catch {
      notify("复制失败，请手动选择文本", "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 bg-panel2/40 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {status === "loading" ? (
              <Badge tone="cyan">
                <span className="pulse-dot">●</span> AI 整理中…
              </Badge>
            ) : status === "ai" ? (
              <Badge tone="cyan">AI 总结 · {model}</Badge>
            ) : status === "error" ? (
              <Badge tone="danger">AI 生成失败 · 已回退本地总结</Badge>
            ) : (
              <Badge tone="neutral">本地总结 · 未配置模型</Badge>
            )}
            {cached && <Badge tone="neutral">来自缓存</Badge>}
            <span className="text-[11px] text-dim">
              {display.source === "ai" ? `生成于 ${formatDate(display.generatedAt)}` : "由章节结构与原文句子生成"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={bookmarked ? "gold" : "ghost"}
              onClick={() =>
                updateChapterProgress(chapter.id, (current) => ({
                  ...current,
                  summaryBookmarked: !current.summaryBookmarked,
                }))
              }
            >
              {bookmarked ? "★ 已收藏" : "收藏总结"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyAll()}>
              复制
            </Button>
            {ai.isAvailable() && (
              <Button size="sm" variant="ghost" onClick={() => void generate(true)} disabled={status === "loading"}>
                {status === "loading" ? "生成中…" : "重新生成"}
              </Button>
            )}
          </div>
        </div>

        {status === "error" && error && (
          <div className="border-b border-danger/30 bg-danger/10 px-4 py-2.5 text-[12px] leading-relaxed text-danger">
            <div className="font-medium">AI 总结生成失败</div>
            <p className="mt-0.5">{error}</p>
            <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => void generate(true)}>
              重试
            </Button>
          </div>
        )}

        <div className="p-5">
          <p className="text-[11px] uppercase tracking-[0.25em] text-dim">CHAPTER DEBRIEF</p>
          <h2 className="mt-1.5 text-lg font-semibold text-ink">可反复查看的复习资料</h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            建议顺序：先看核心知识点与结构图 → 再过术语卡与易混对比 → 最后用自测清单检查盲区。
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle title="核心知识点" hint={`${display.corePoints.length} 条`} />
        <ol className="mt-3 space-y-2.5">
          {display.corePoints.map((point, index) => (
            <li key={`${point.title}-${index}`} className="rounded-xl border border-line/60 bg-panel2/35 p-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-[10px] text-cyan/70">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-[13px] font-medium text-ink">{point.title}</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{point.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="p-4">
        <SectionTitle title="知识结构图" hint="由章节层级生成" />
        <Mindmap node={display.mindmap} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <SectionTitle title="术语卡" hint={`${display.termCards.length} 张`} />
          {display.termCards.length === 0 ? (
            <p className="mt-3 text-[12px] text-muted">本章未匹配到术语表条目，可直接参考核心知识点。</p>
          ) : (
            <div className="mt-3 space-y-2">
              {display.termCards.map((card) => (
                <div key={card.term} className="rounded-lg border border-line/60 bg-panel2/35 p-2.5">
                  <div className="text-[12.5px] font-medium text-cyan">{card.term}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{card.summary}</div>
                  {card.note && <div className="mt-0.5 text-[11px] text-dim">易混点：{card.note}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <SectionTitle title="易混概念对比" hint="来自全书术语表与 AI 整理" />
          {display.contrasts.length === 0 ? (
            <p className="mt-3 text-[12px] text-muted">本章暂无匹配的概念对比。</p>
          ) : (
            <div className="mt-3 space-y-2">
              {display.contrasts.map((contrast) => (
                <div key={contrast.title} className="rounded-lg border border-line/60 bg-panel2/35 p-2.5">
                  <div className="text-[12.5px] font-medium text-ink">{contrast.title}</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{contrast.detail}</p>
                  {contrast.items && contrast.items.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[11.5px] text-muted">
                      {contrast.items.map((item) => (
                        <li key={item.name}>
                          <span className="text-cyan/80">{item.name}</span>：{item.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {display.codeHighlights.length > 0 && (
        <Card className="p-4">
          <SectionTitle title="关键代码" hint="摘自章节原文" />
          <div className="mt-2 space-y-2">
            {display.codeHighlights.map((highlight, index) => (
              <div key={`${highlight.title}-${index}`}>
                <div className="mb-1 text-[11.5px] text-muted">{highlight.title}</div>
                <CodeBlock code={highlight.code} lang={highlight.lang} />
                {highlight.note && <div className="text-[11px] text-dim">{highlight.note}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <SectionTitle title="实际应用场景" />
          <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
            {display.scenarios.map((scenario, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-cyan/70">▹</span>
                {scenario}
              </li>
            ))}
            {display.scenarios.length === 0 && <li className="text-dim">暂无</li>}
          </ul>
        </Card>

        <Card className="p-4">
          <SectionTitle title="常见错误与排查" />
          <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-muted">
            {display.pitfalls.map((pitfall, index) => (
              <li key={`${pitfall.title}-${index}`}>
                <span className="text-gold/90">{pitfall.title}</span>
                <p className="mt-0.5 text-[12px]">{pitfall.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <SectionTitle title="考试高频考点" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {display.examPoints.map((point) => (
              <span key={point} className="rounded-md border border-gold/25 bg-gold/[0.06] px-2 py-1 text-[11.5px] text-gold/90">
                {point}
              </span>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle title="自测清单" hint="能全部打勾再参加考试" />
          <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
            {display.checklist.map((item, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-dim">☐</span>
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className={cn("p-4", confirmed && "border-ok/30")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">总结阅读确认</span>
              <Badge tone={confirmed ? "ok" : "neutral"}>{confirmed ? "已完成 +4" : "待确认"}</Badge>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              确认你已复习完本章总结。该操作计入学习分 4 分；之后即可参加正式章节考试。
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={confirm} disabled={confirmed}>
              {confirmed ? "已确认复习" : "我已复习完"}
            </Button>
          </div>
        </div>
      </Card>

      <p className="px-1 text-[11px] leading-relaxed text-dim">
        {display.note ?? "总结内容以章节原文为准。"} 原文链接：{chapter.sourceUrl}
      </p>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint && <span className="text-[10px] text-dim">{hint}</span>}
    </div>
  );
}

function Mindmap({ node }: { node: MindmapNode }) {
  const layout = useMemo(() => {
    interface Box {
      label: string;
      level: number;
      y: number;
      parent?: Box;
    }
    const levelGap = 200;
    const rowGap = 30;
    const boxes: Box[] = [];
    let cursor = 0;

    const place = (current: MindmapNode, level: number, parent?: Box): Box => {
      const children = current.children ?? [];
      const box: Box = { label: current.label, level, y: 0, parent };
      if (children.length === 0) {
        box.y = cursor * rowGap + 24;
        cursor += 1;
      } else {
        const childBoxes = children.map((child) => place(child, level + 1, box));
        box.y = (childBoxes[0].y + childBoxes[childBoxes.length - 1].y) / 2;
      }
      boxes.push(box);
      return box;
    };

    place(node, 0);
    const height = Math.max(120, cursor * rowGap + 36);
    const width = 24 + (Math.max(0, ...boxes.map((item) => item.level)) + 1) * levelGap;
    return {
      boxes: boxes.map((box) => ({
        label: box.label,
        level: box.level,
        y: box.y,
        x: 24 + box.level * levelGap,
        parent: box.parent
          ? { x: 24 + box.parent.level * levelGap, y: box.parent.y }
          : undefined,
      })),
      width,
      height,
    };
  }, [node]);

  return (
    <div className="mt-2 overflow-x-auto">
      <svg width={Math.max(layout.width, 320)} height={layout.height} role="img" aria-label="章节知识结构图">
        <defs>
          <linearGradient id="mind-line" x1="0" x2="1">
            <stop offset="0%" stopColor="rgba(55,214,230,0.55)" />
            <stop offset="100%" stopColor="rgba(91,140,255,0.25)" />
          </linearGradient>
        </defs>
        {layout.boxes.map((item, index) => {
          if (!item.parent) return null;
          return (
            <path
              key={`edge-${index}`}
              d={`M ${item.parent.x + 168} ${item.parent.y} C ${item.parent.x + 184} ${item.parent.y}, ${item.x - 16} ${item.y}, ${item.x} ${item.y}`}
              fill="none"
              stroke="url(#mind-line)"
              strokeWidth={1.2}
            />
          );
        })}
        {layout.boxes.map((item, index) => {
          const isRoot = item.level === 0;
          const width = Math.min(160, Math.max(88, item.label.length * 12 + 18));
          return (
            <g key={`node-${index}`} transform={`translate(${item.x}, ${item.y})`}>
              <rect
                x={0}
                y={-13}
                width={width}
                height={26}
                rx={7}
                fill={isRoot ? "var(--color-panel2)" : item.level === 1 ? "var(--color-panel)" : "var(--color-panel2)"}
                stroke={isRoot ? "var(--color-cyan)" : "var(--color-line)"}
                strokeOpacity={isRoot ? 0.7 : 1}
              />
              <text
                x={width / 2}
                y={4}
                textAnchor="middle"
                fontSize={isRoot ? 11 : 10}
                fill={isRoot ? "var(--color-cyan)" : item.level === 1 ? "var(--color-prose-strong)" : "var(--color-muted)"}
              >
                {item.label.length > 13 ? `${item.label.slice(0, 12)}…` : item.label}
                <title>{item.label}</title>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function buildMarkdownSummary(title: string, summary: ChapterSummary): string {
  const lines: string[] = [`# ${title} · 复习总结`, ""];
  lines.push("## 核心知识点");
  for (const point of summary.corePoints) lines.push(`- **${point.title}**：${point.detail}`);
  lines.push("", "## 术语卡");
  for (const card of summary.termCards) lines.push(`- **${card.term}**：${card.summary}${card.note ? `（易混：${card.note}）` : ""}`);
  lines.push("", "## 易混概念");
  for (const contrast of summary.contrasts) lines.push(`- **${contrast.title}**：${contrast.detail}`);
  lines.push("", "## 高频考点");
  for (const point of summary.examPoints) lines.push(`- ${point}`);
  lines.push("", "## 自测清单");
  for (const item of summary.checklist) lines.push(`- [ ] ${item}`);
  return lines.join("\n");
}
