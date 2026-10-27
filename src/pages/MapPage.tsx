import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import type { ChapterMeta, StarTier } from "../types";
import { Badge, Button, Card, LinkButton, Modal, ProgressBar, cn } from "../components/ui";
import { areaCompletion, starLabel } from "../lib/domain/rules";
import { formatRelative, truncate } from "../lib/utils/format";

type ViewMode = "map" | "list";
type FilterMode = "all" | "unlocked" | "passed" | "review";

const COLUMNS = 4;
const COL_X = [120, 360, 600, 840];
const MAP_WIDTH = 960;
const ROW_H = 138;
const REGION_HEADER = 92;
const REGION_GAP = 22;
const NODE_R = 24;

const AREA_ACCENTS = [
  "var(--color-cyan)",
  "var(--color-blue)",
  "var(--color-gold)",
  "var(--color-bronze)",
  "var(--color-violet)",
];

const LOCK_PATH =
  "M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm0 2a3 3 0 013 3v3H9V7a3 3 0 013-3z";

interface Positioned {
  chapter: ChapterMeta;
  x: number;
  y: number;
  index: number;
}

interface Region {
  areaId: string;
  code: string;
  title: string;
  y: number;
  height: number;
  accent: string;
  chapterIds: string[];
  nodes: Positioned[];
}

export function MapPage() {
  const { course, chapters, statuses, progress, chapterById } = useApp();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 900 ? "list" : "map",
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<ChapterMeta | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const regions = useMemo<Region[]>(() => {
    let y = 20;
    return course.areas.map((area, areaIndex) => {
      const list = area.chapterIds
        .map((id) => chapterById(id))
        .filter((chapter): chapter is ChapterMeta => Boolean(chapter))
        .sort((a, b) => a.order - b.order);
      const rows = Math.max(1, Math.ceil(list.length / COLUMNS));
      const height = REGION_HEADER + rows * ROW_H;
      const nodes = list.map((chapter, index) => {
        const row = Math.floor(index / COLUMNS);
        const col = index % COLUMNS;
        const effective = row % 2 === 0 ? col : COLUMNS - 1 - col;
        // 同排节点轻微上下错位，让路线呈现起伏，而不是一条直线
        const wave = index % 2 === 0 ? -10 : 10;
        return {
          chapter,
          index,
          x: COL_X[effective],
          y: y + REGION_HEADER + 42 + row * ROW_H + wave,
        };
      });
      const region: Region = {
        areaId: area.id,
        code: area.code,
        title: area.title,
        y,
        height,
        accent: AREA_ACCENTS[areaIndex % AREA_ACCENTS.length],
        chapterIds: area.chapterIds,
        nodes,
      };
      y += height + REGION_GAP;
      return region;
    });
  }, [course.areas, chapterById]);

  const mapHeight = useMemo(
    () => regions.reduce((sum, region) => sum + region.height + REGION_GAP, 20) + 30,
    [regions],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return chapters.filter((chapter) => {
      const status = statuses[chapter.id];
      if (filter === "unlocked" && !status?.unlocked) return false;
      if (filter === "passed" && !status?.passed) return false;
      if (filter === "review" && !status?.started) return false;
      if (!keyword) return true;
      const haystack = `${chapter.title} ${chapter.sections.map((section) => section.title).join(" ")} ${chapter.terms.join(" ")}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [chapters, statuses, filter, query]);

  const currentChapterId = progress.lastLocation?.chapterId;
  const currentNode = regions
    .flatMap((region) => region.nodes)
    .find((node) => node.chapter.id === currentChapterId);

  const scrollToCurrent = () => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: currentNode ? Math.max(0, currentNode.y - 160) : 0, behavior: "smooth" });
  };

  const scrollToRegion = (region: Region) => {
    scrollRef.current?.scrollTo({ top: Math.max(0, region.y - 12), behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-dim">Campaign Map</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">关卡星图</h1>
          <p className="mt-1 text-sm text-muted">
            5 个知识地区 · 78 个关卡。每个地区首关默认开放，可自由选择领域；同一地区内按路线依次闯关。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-panel2/60 p-1">
            {(["map", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs transition-colors",
                  view === mode ? "bg-cyan/15 text-cyan" : "text-muted hover:text-ink",
                )}
              >
                {mode === "map" ? "路线图" : "目录"}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索章节 / 知识点 / 术语"
            className="w-52 rounded-xl border border-line bg-panel2/60 px-3 py-2 text-xs text-ink outline-none placeholder:text-dim focus:border-cyan/50"
          />
        </div>
      </div>

      {view === "map" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <LegendItem kind="locked" label="未解锁" />
                <LegendItem kind="available" label="可开始" />
                <LegendItem kind="current" label="学习中" />
                <LegendItem kind="exam" label="待考试" />
                <LegendItem kind="passed" label="已通关" />
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10.5px] text-dim sm:inline">滚轮 / 拖动右侧滚动条浏览</span>
                <Button size="sm" variant="secondary" onClick={scrollToCurrent}>
                  定位当前
                </Button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="map-scroll h-[calc(100vh-292px)] min-h-[440px] overflow-y-auto overflow-x-hidden"
            >
              <svg
                viewBox={`0 0 ${MAP_WIDTH} ${mapHeight}`}
                style={{ width: "100%", height: "auto", display: "block" }}
                role="group"
                aria-label="课程关卡路线图"
                className="select-none"
              >
                <defs>
                  <radialGradient id="map-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {regions.map((region, regionIndex) => {
                  const completion = areaCompletion(region.chapterIds, statuses);
                  return (
                    <g key={region.areaId}>
                      <rect
                        x={20}
                        y={region.y}
                        width={MAP_WIDTH - 40}
                        height={region.height - 10}
                        rx={26}
                        fill="var(--map-region-bg)"
                        stroke="var(--map-region-border)"
                      />

                      <circle
                        cx={regionIndex % 2 === 0 ? 190 : 780}
                        cy={region.y + region.height * 0.58}
                        r={Math.min(150, region.height * 0.3)}
                        fill={region.accent}
                        opacity={0.045}
                      />
                      <circle
                        cx={regionIndex % 2 === 0 ? 790 : 170}
                        cy={region.y + REGION_HEADER + 70}
                        r={64}
                        fill={region.accent}
                        opacity={0.06}
                      />

                      <g>
                        <rect
                          x={42}
                          y={region.y + 26}
                          width={58}
                          height={22}
                          rx={11}
                          fill={region.accent}
                          opacity={0.14}
                        />
                        <text
                          x={71}
                          y={region.y + 41}
                          textAnchor="middle"
                          fontSize={10}
                          fontFamily="monospace"
                          letterSpacing="1.5"
                          fill={region.accent}
                        >
                          {region.code}
                        </text>
                        <text
                          x={113}
                          y={region.y + 43}
                          fontSize={15}
                          fontWeight={650}
                          fill="var(--color-prose-strong)"
                        >
                          {region.title}
                        </text>
                        <text
                          x={MAP_WIDTH - 44}
                          y={region.y + 42}
                          textAnchor="end"
                          fontSize={11}
                          fill="var(--color-muted)"
                        >
                          {completion.passed}/{region.chapterIds.length} 关 · 平均 {completion.average || "—"} 分
                        </text>
                        <rect
                          x={42}
                          y={region.y + 62}
                          width={MAP_WIDTH - 84}
                          height={5}
                          rx={2.5}
                          fill="var(--color-line-soft)"
                        />
                        <rect
                          x={42}
                          y={region.y + 62}
                          width={(MAP_WIDTH - 84) * (completion.percent / 100)}
                          height={5}
                          rx={2.5}
                          fill={region.accent}
                          opacity={0.8}
                        />
                      </g>

                      {region.nodes.map((node, index) => {
                        if (index === 0) return null;
                        const previous = region.nodes[index - 1];
                        return <Road key={`road-${node.chapter.id}`} from={previous} to={node} />;
                      })}

                      {region.nodes.map((node) => (
                        <LevelNode
                          key={node.chapter.id}
                          node={node}
                          accent={region.accent}
                          status={statuses[node.chapter.id]}
                          current={node.chapter.id === currentChapterId}
                          passed={Boolean(statuses[node.chapter.id]?.passed)}
                          onSelect={() => setSelected(node.chapter)}
                        />
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>
          </Card>

          <Card className="h-fit p-4">
            <h2 className="text-sm font-semibold text-ink">地区总览</h2>
            <p className="mt-0.5 text-[11px] text-muted">点击地区可跳到对应路线。</p>
            <div className="mt-3 space-y-3">
              {regions.map((region) => {
                const completion = areaCompletion(region.chapterIds, statuses);
                const started = region.chapterIds.some((id) => statuses[id]?.started);
                return (
                  <button
                    key={region.areaId}
                    type="button"
                    onClick={() => scrollToRegion(region)}
                    className="w-full rounded-xl border border-line/60 bg-panel2/40 p-3 text-left transition-colors hover:border-cyan/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
                        <span className="h-2 w-2 rounded-full" style={{ background: region.accent }} />
                        {region.code}
                      </span>
                      <Badge tone={completion.complete ? "ok" : completion.passed || started ? "cyan" : "neutral"}>
                        {completion.complete ? "已通关" : `${completion.passed}/${region.chapterIds.length}`}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[13px] text-ink">{region.title}</div>
                    <ProgressBar value={completion.passed} max={region.chapterIds.length} className="mt-2" />
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-dim">
              地区完成 = 该领域全部必修关卡通关；单个关卡高分不会提前点亮整个地区。
            </p>
          </Card>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-4 py-3">
            {(
              [
                ["all", "全部"],
                ["unlocked", "已解锁"],
                ["passed", "已通关"],
                ["review", "学习中"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
                  filter === value
                    ? "border-cyan/50 bg-cyan/10 text-cyan"
                    : "border-line bg-transparent text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-dim">
              {filtered.length} / {chapters.length} 章
            </span>
          </div>

          <ul className="divide-y divide-line/50">
            {filtered.map((chapter) => {
              const status = statuses[chapter.id];
              const areaIndex = course.areas.findIndex((area) => area.id === chapter.areaId);
              const accent = AREA_ACCENTS[Math.max(0, areaIndex) % AREA_ACCENTS.length];
              return (
                <li
                  key={chapter.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]"
                >
                  <LevelDot
                    order={chapter.order}
                    accent={accent}
                    locked={!status?.unlocked}
                    passed={Boolean(status?.passed)}
                    current={chapter.id === currentChapterId}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="truncate text-left text-[13px] text-ink hover:text-cyan"
                        onClick={() => setSelected(chapter)}
                      >
                        {chapter.title}
                      </button>
                      {status?.passed ? (
                        <Badge tone="ok">{status.bestTotal} 分</Badge>
                      ) : !status?.unlocked ? (
                        <Badge tone="neutral">未解锁</Badge>
                      ) : status.studyPoints === 20 ? (
                        <Badge tone="gold">待考试</Badge>
                      ) : status.started ? (
                        <Badge tone="cyan">学习中</Badge>
                      ) : (
                        <Badge tone="neutral">可开始</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-dim">
                      {chapter.sections.slice(0, 3).map((section) => section.title).join(" · ")}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-dim">
                    <div>{chapter.estimateMinutes} 分钟</div>
                    <div>{chapter.sections.length} 个知识点</div>
                  </div>
                  {status?.unlocked ? (
                    <Link
                      to={`/learn/${chapter.id}`}
                      className="rounded-lg border border-cyan/40 bg-cyan/10 px-3 py-1.5 text-[11px] text-cyan hover:bg-cyan/20"
                    >
                      进入
                    </Link>
                  ) : (
                    <span className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-dim">
                      锁定
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-muted">没有匹配的章节，试试其他关键词。</div>
          )}
        </Card>
      )}

      <ChapterDetailModal
        chapter={selected}
        onClose={() => setSelected(null)}
        onStart={() => {
          if (!selected) return;
          navigate(`/learn/${selected.id}`);
        }}
      />
    </div>
  );
}

function Road({ from, to }: { from: Positioned; to: Positioned }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const path =
    Math.abs(dx) < 1
      ? `M ${from.x} ${from.y} C ${from.x + 70} ${from.y + 44}, ${to.x + 70} ${to.y - 44}, ${to.x} ${to.y}`
      : `M ${from.x} ${from.y} C ${from.x + dx * 0.42} ${from.y + dy * 0.18}, ${to.x - dx * 0.42} ${to.y - dy * 0.18}, ${to.x} ${to.y}`;

  return (
    <g fill="none" strokeLinecap="round">
      <path d={path} stroke="var(--map-road-edge)" strokeWidth={18} />
      <path d={path} stroke="var(--map-road)" strokeWidth={13} />
      <path d={path} stroke="var(--map-road-dash)" strokeWidth={2.6} strokeDasharray="1 11" opacity={0.9} />
    </g>
  );
}

function starCountFor(star: StarTier, passed: boolean): number {
  if (!passed) return 0;
  if (star === "gold") return 3;
  if (star === "silver") return 2;
  return 1;
}

function nodeStatusText(status: ReturnType<typeof useApp>["statuses"][string] | undefined): string {
  if (!status?.unlocked) return "未解锁";
  if (status.passed) return `${status.bestTotal} 分`;
  if (status.lastAttempt) return "需复习";
  if (status.studyPoints === 20) return "待考试";
  if (status.started) return "学习中";
  return "可开始";
}

function LevelNode({
  node,
  accent,
  status,
  current,
  passed,
  onSelect,
}: {
  node: Positioned;
  accent: string;
  status: ReturnType<typeof useApp>["statuses"][string] | undefined;
  current: boolean;
  passed: boolean;
  onSelect: () => void;
}) {
  const locked = !status?.unlocked;
  const started = Boolean(status?.started);
  const statusText = nodeStatusText(status);
  const shortTitle = node.chapter.title.replace(/^第\s*[\d-]+\s*章\s*/, "");
  const stars = starCountFor(status?.star ?? "failed", passed);

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      className="map-level"
      role="button"
      tabIndex={0}
      aria-label={`第 ${node.chapter.order} 关 ${node.chapter.title}，${statusText}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{`第 ${node.chapter.order} 关 · ${node.chapter.title} · ${statusText}`}</title>

      {current && (
        <>
          <circle r={NODE_R + 12} fill="url(#map-glow)" />
          <circle
            r={NODE_R + 10}
            fill="none"
            stroke={accent}
            strokeWidth={1.6}
            className="pulse-dot"
            opacity={0.7}
          />
          <text y={-NODE_R - 20} textAnchor="middle" fontSize={8.5} fill={accent} letterSpacing={1}>
            当前
          </text>
        </>
      )}

      <circle r={NODE_R + 3} cy={3} fill="var(--map-node-shadow)" opacity={0.5} />
      <circle
        r={NODE_R}
        fill={locked ? "var(--map-node-locked)" : "var(--map-node-bg)"}
        stroke={locked ? "var(--color-line)" : accent}
        strokeWidth={passed || current ? 2.4 : 1.6}
        opacity={locked ? 0.85 : 1}
      />
      {!locked && (
        <circle r={NODE_R - 2.5} fill={accent} opacity={passed ? 0.22 : started ? 0.16 : 0.1} />
      )}
      <circle
        r={NODE_R - 8}
        fill="none"
        stroke={locked ? "var(--color-line)" : accent}
        strokeWidth={0.8}
        opacity={0.35}
      />
      {!locked && <ellipse cx={-7} cy={-9} rx={9} ry={5} fill="#ffffff" opacity={0.22} />}

      <text
        y={5}
        textAnchor="middle"
        fontSize={13.5}
        fontWeight={700}
        fontFamily="monospace"
        fill={locked ? "var(--color-dim)" : accent}
      >
        {String(node.chapter.order).padStart(2, "0")}
      </text>

      {locked && (
        <g transform="translate(14,-17) scale(0.42)" fill="var(--color-dim)">
          <path d={LOCK_PATH} />
        </g>
      )}

      {passed && (
        <g transform="translate(0, 38)">
          {[0, 1, 2].map((index) => (
            <text
              key={index}
              x={(index - 1) * 11}
              y={0}
              textAnchor="middle"
              fontSize={8.5}
              fill={index < stars ? "var(--color-gold)" : "var(--color-line)"}
            >
              ★
            </text>
          ))}
        </g>
      )}

      <text
        y={passed ? 59 : 43}
        textAnchor="middle"
        fontSize={9.5}
        fill={locked ? "var(--color-dim)" : "var(--color-prose-strong)"}
      >
        {truncate(shortTitle, 9)}
      </text>
      <text
        y={passed ? 73 : 57}
        textAnchor="middle"
        fontSize={9}
        fill={locked ? "var(--color-dim)" : passed ? accent : "var(--color-muted)"}
      >
        {statusText}
      </text>
    </g>
  );
}

function LevelDot({
  order,
  accent,
  locked,
  passed,
  current,
}: {
  order: number;
  accent: string;
  locked: boolean;
  passed: boolean;
  current: boolean;
}) {
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      {current && (
        <circle cx={14} cy={14} r={13} fill="none" stroke={accent} strokeWidth={1} className="pulse-dot" />
      )}
      <circle
        cx={14}
        cy={14}
        r={12}
        fill={locked ? "var(--map-node-locked)" : "var(--map-node-bg)"}
        stroke={locked ? "var(--color-line)" : accent}
        strokeWidth={1.4}
      />
      {!locked && <circle cx={14} cy={14} r={10} fill={accent} opacity={passed ? 0.22 : 0.12} />}
      <text
        x={14}
        y={18}
        textAnchor="middle"
        fontSize={9.5}
        fontWeight={700}
        fontFamily="monospace"
        fill={locked ? "var(--color-dim)" : accent}
      >
        {String(order).padStart(2, "0")}
      </text>
      {locked && (
        <g transform="translate(17.5,4.5) scale(0.36)" fill="var(--color-dim)">
          <path d={LOCK_PATH} />
        </g>
      )}
    </svg>
  );
}

function LegendItem({
  kind,
  label,
}: {
  kind: "locked" | "available" | "current" | "exam" | "passed";
  label: string;
}) {
  const accent =
    kind === "passed" ? "var(--color-gold)" : kind === "locked" ? "var(--color-line)" : "var(--color-cyan)";

  return (
    <span className="inline-flex items-center gap-1">
      <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
        <circle
          cx={8}
          cy={8}
          r={6.5}
          fill={kind === "locked" ? "var(--map-node-locked)" : "var(--map-node-bg)"}
          stroke={accent}
          strokeWidth={1.2}
        />
        {kind === "locked" ? (
          <g transform="translate(5.1,3.4) scale(0.25)" fill="var(--color-dim)">
            <path d={LOCK_PATH} />
          </g>
        ) : kind === "passed" ? (
          <text x={8} y={10.5} textAnchor="middle" fontSize={7} fill="var(--color-gold)">
            ★
          </text>
        ) : kind === "exam" ? (
          <text x={8} y={10.8} textAnchor="middle" fontSize={7.5} fill={accent}>
            考
          </text>
        ) : (
          <text x={8} y={10.6} textAnchor="middle" fontSize={7.5} fontFamily="monospace" fill={accent}>
            1
          </text>
        )}
      </svg>
      {label}
    </span>
  );
}

function ChapterDetailModal({
  chapter,
  onClose,
  onStart,
}: {
  chapter: ChapterMeta | null;
  onClose: () => void;
  onStart: () => void;
}) {
  const { statuses, course, chapterById, progress } = useApp();
  if (!chapter) return null;
  const status = statuses[chapter.id];
  const area = course.areas.find((item) => item.id === chapter.areaId);
  const previous = course.chapters
    .filter((item) => item.areaId === chapter.areaId && item.order < chapter.order)
    .sort((a, b) => b.order - a.order)[0];
  const attempts = progress.attempts
    .filter((attempt) => attempt.chapterId === chapter.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const last = attempts[0];

  return (
    <Modal open onClose={onClose} title={chapter.title} width="max-w-xl">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">地区 {area?.code}</Badge>
        <Badge tone="neutral">{area?.title}</Badge>
        {chapter.groupTitle && <Badge tone="neutral">{chapter.groupTitle}</Badge>}
        <Badge tone={status?.passed ? "ok" : "cyan"}>
          {status?.passed
            ? `已通关 · ${status.bestTotal} 分 · ${starLabel(status.star)}`
            : status?.unlocked
              ? "已解锁"
              : "未解锁"}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line/60 bg-panel2/50 px-2 py-2">
          <div className="text-[10px] text-dim">预计用时</div>
          <div className="text-sm text-ink">{chapter.estimateMinutes} 分钟</div>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel2/50 px-2 py-2">
          <div className="text-[10px] text-dim">知识点</div>
          <div className="text-sm text-ink">{chapter.sections.length} 个</div>
        </div>
        <div className="rounded-lg border border-line/60 bg-panel2/50 px-2 py-2">
          <div className="text-[10px] text-dim">学习分</div>
          <div className="text-sm text-ink">{status?.studyPoints ?? 0}/20</div>
        </div>
      </div>

      {chapter.objectives.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium text-ink">学习目标</div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed">
            {chapter.objectives.slice(0, 5).map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs font-medium text-ink">知识点目录</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chapter.sections.map((section) => (
            <span
              key={section.id}
              className="rounded-md border border-line/70 bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted"
            >
              {section.title}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-line/60 bg-panel2/40 p-3 text-[12px] leading-relaxed">
        <div className="text-xs font-medium text-ink">解锁条件</div>
        {chapter.order === 1 ? (
          <p className="mt-1 text-muted">起始章节，默认解锁。</p>
        ) : previous ? (
          <p className="mt-1 text-muted">
            {status?.unlocked
              ? `已满足：前置关卡「${previous.title}」已通关。`
              : `需要先通关「${chapterById(previous.id)?.title ?? previous.title}」。`}
          </p>
        ) : (
          <p className="mt-1 text-muted">按课程顺序解锁。</p>
        )}
        {last && (
          <p className="mt-1 text-muted">
            最近一次：{formatRelative(last.createdAt)} · 总分 {last.total}（学习 {last.studyPoints} + 考试 {last.examScore}）
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {!status?.unlocked && previous && (
          <LinkButton to={`/learn/${previous.id}`} variant="secondary" size="sm">
            先去前置关卡
          </LinkButton>
        )}
        {status?.passed && (
          <LinkButton to={`/learn/${chapter.id}?tab=exam`} variant="gold" size="sm">
            重新考试
          </LinkButton>
        )}
        <Button size="sm" onClick={onStart} disabled={!status?.unlocked}>
          {status?.unlocked ? "进入章节" : "尚未解锁"}
        </Button>
      </div>
    </Modal>
  );
}
