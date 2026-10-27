import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppContext";
import type { ChapterMeta, StarTier } from "../types";
import { Badge, Button, Card, LinkButton, Modal, ProgressBar, cn } from "../components/ui";
import { StarShape } from "../components/StarIcon";
import { areaCompletion, starLabel } from "../lib/domain/rules";
import { formatRelative, truncate } from "../lib/utils/format";

type ViewMode = "map" | "list";
type FilterMode = "all" | "unlocked" | "passed" | "review";

const NODE_H = 104;
const MAP_WIDTH = 1000;
const MAX_COLS = 6;

interface Positioned {
  chapter: ChapterMeta;
  x: number;
  y: number;
  index: number;
}

interface Lane {
  areaId: string;
  code: string;
  title: string;
  y: number;
  height: number;
  nodes: Positioned[];
  chapterIds: string[];
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
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  const lanes = useMemo<Lane[]>(() => {
    let y = 20;
    return course.areas.map((area) => {
      const list = area.chapterIds
        .map((id) => chapterById(id))
        .filter((chapter): chapter is ChapterMeta => Boolean(chapter))
        .sort((a, b) => a.order - b.order);
      const cols = Math.max(1, Math.min(MAX_COLS, list.length));
      const rows = Math.max(1, Math.ceil(list.length / cols));
      const height = rows * NODE_H + 96;
      const colGap = cols > 1 ? (MAP_WIDTH - 128) / (cols - 1) : 0;
      const nodes = list.map((chapter, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const effectiveCol = row % 2 === 0 ? col : cols - 1 - col;
        return {
          chapter,
          index,
          x: 64 + effectiveCol * colGap,
          y: y + 78 + row * NODE_H,
        };
      });
      const lane: Lane = {
        areaId: area.id,
        code: area.code,
        title: area.title,
        y,
        height,
        nodes,
        chapterIds: area.chapterIds,
      };
      y += height;
      return lane;
    });
  }, [course.areas, chapterById]);

  const mapSize = useMemo(() => {
    return { width: MAP_WIDTH, height: lanes.reduce((sum, lane) => sum + lane.height, 0) + 40 };
  }, [lanes]);

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

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    setOffset({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const onPointerUp = () => {
    setTimeout(() => {
      dragRef.current = null;
    }, 0);
  };

  const zoomBy = (delta: number) => setZoom((value) => Math.min(1.8, Math.max(0.55, Number((value + delta).toFixed(2)))));

  const focusCurrent = () => {
    const lane = lanes.find((item) => item.chapterIds.includes(currentChapterId ?? ""));
    const node = lane?.nodes.find((item) => item.chapter.id === currentChapterId);
    if (!lane || !node) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      return;
    }
    setZoom(1);
    setOffset({ x: 0, y: -node.y + 140 });
  };

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-dim">Campaign Map</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">关卡星图</h1>
          <p className="mt-1 text-sm text-muted">
            5 个大关卡 · {course.stats.chapters} 颗星星。每个大关卡的首章默认开放，可自由选择领域；同一领域内通关一颗星才能点亮下一颗。
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
                {mode === "map" ? "星图" : "目录"}
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
          <Card className="relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <LegendItem icon="🔒" label="未解锁" />
                <LegendItem icon="◇" label="可开始" />
                <LegendItem icon="◈" label="学习中" />
                <LegendItem icon="⚑" label="待考试" />
                <LegendItem icon="★" label="已通关" />
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => zoomBy(-0.15)} aria-label="缩小">
                  −
                </Button>
                <span className="w-10 text-center text-[11px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
                <Button size="sm" variant="secondary" onClick={() => zoomBy(0.15)} aria-label="放大">
                  +
                </Button>
                <Button size="sm" variant="ghost" onClick={focusCurrent}>
                  定位当前
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                >
                  重置
                </Button>
              </div>
            </div>

            <div
              className="relative h-[calc(100vh-260px)] min-h-[460px] cursor-grab overflow-hidden active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ touchAction: "none" }}
              onWheel={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  event.preventDefault();
                  zoomBy(event.deltaY > 0 ? -0.1 : 0.1);
                }
              }}
            >
              <div
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                  transformOrigin: "top left",
                  transition: dragRef.current ? "none" : "transform 180ms ease-out",
                }}
              >
                <svg
                  viewBox={`0 0 ${mapSize.width} ${mapSize.height}`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                  role="group"
                  aria-label="课程关卡星图"
                  className="map-grid select-none"
                >
                  <defs>
                    <linearGradient id="lane-band" x1="0" x2="1">
                      <stop offset="0%" stopColor="var(--map-band-1)" />
                      <stop offset="100%" stopColor="var(--map-band-2)" />
                    </linearGradient>
                    <linearGradient id="path-line" x1="0" x2="1">
                      <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="var(--color-blue)" stopOpacity="0.45" />
                    </linearGradient>
                  </defs>

                  {lanes.map((lane, laneIndex) => {
                    const completion = areaCompletion(lane.chapterIds, statuses);
                    return (
                      <g key={lane.areaId}>
                        <rect
                          x={16}
                          y={lane.y}
                          width={mapSize.width - 32}
                          height={lane.height - 12}
                          rx={18}
                          fill="url(#lane-band)"
                          stroke="var(--color-line)" strokeOpacity={0.75}
                        />
                        <text x={32} y={lane.y + 26} fill="var(--color-cyan)" fontSize={11} fontFamily="monospace" letterSpacing="2">
                          AREA {lane.code}
                        </text>
                        <text x={104} y={lane.y + 26} fill="var(--color-prose-strong)" fontSize={13} fontWeight={600}>
                          {lane.title}
                        </text>
                        <text x={mapSize.width - 36} y={lane.y + 26} textAnchor="end" fill="var(--color-muted)" fontSize={11}>
                          {completion.passed}/{lane.chapterIds.length} 章 · 平均 {completion.average || "—"} 分
                        </text>

                        {lane.nodes.map((node, index) => {
                          if (index === 0) return null;
                          const previous = lane.nodes[index - 1];
                          return (
                            <path
                              key={`path-${node.chapter.id}`}
                              d={`M ${previous.x} ${previous.y} C ${previous.x + (node.x - previous.x) * 0.45} ${previous.y + 34}, ${node.x - (node.x - previous.x) * 0.45} ${node.y - 34}, ${node.x} ${node.y}`}
                              fill="none"
                              stroke="url(#path-line)"
                              strokeWidth={2}
                              strokeDasharray={statuses[node.chapter.id]?.unlocked ? undefined : "4 6"}
                              opacity={0.85}
                            />
                          );
                        })}

                        {laneIndex > 0 && lane.nodes[0] && (
                          <path
                            d={`M ${lanes[laneIndex - 1].nodes.at(-1)!.x} ${lanes[laneIndex - 1].nodes.at(-1)!.y} C ${mapSize.width - 100} ${lanes[laneIndex - 1].nodes.at(-1)!.y + 30}, 90 ${lane.nodes[0].y - 30}, ${lane.nodes[0].x} ${lane.nodes[0].y}`}
                            fill="none"
                            stroke="var(--color-cyan)" strokeOpacity={0.28}
                            strokeWidth={1.5}
                            strokeDasharray="3 7"
                          />
                        )}

                        {lane.nodes.map((node) => (
                          <MapNode
                            key={node.chapter.id}
                            node={node}
                            star={statuses[node.chapter.id]?.star ?? "failed"}
                            locked={!statuses[node.chapter.id]?.unlocked}
                            passed={Boolean(statuses[node.chapter.id]?.passed)}
                            started={Boolean(statuses[node.chapter.id]?.started)}
                            studyDone={statuses[node.chapter.id]?.studyPoints === 20}
                            score={statuses[node.chapter.id]?.bestTotal ?? 0}
                            current={node.chapter.id === currentChapterId}
                            onSelect={() => {
                              if (dragRef.current?.moved) return;
                              setSelected(node.chapter);
                            }}
                          />
                        ))}
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-dim">
                拖动平移 · Ctrl/⌘ + 滚轮缩放 · 点击星星查看详情
              </div>
            </div>
          </Card>

          <Card className="h-fit p-4">
            <h2 className="text-sm font-semibold text-ink">大关卡总览</h2>
            <div className="mt-3 space-y-3">
              {lanes.map((lane) => {
                const completion = areaCompletion(lane.chapterIds, statuses);
                return (
                  <button
                    key={lane.areaId}
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setOffset({ x: 0, y: -lane.y + 60 });
                    }}
                    className="w-full rounded-xl border border-line/60 bg-panel2/40 p-3 text-left transition-colors hover:border-cyan/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-dim">{lane.code}</span>
                      <Badge tone={completion.complete ? "ok" : completion.passed || lane.chapterIds.some((id) => statuses[id]?.started) ? "cyan" : "neutral"}>
                        {completion.complete ? "已通关" : `${completion.passed}/${lane.chapterIds.length}`}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[13px] text-ink">{lane.title}</div>
                    <ProgressBar value={completion.passed} max={lane.chapterIds.length} className="mt-2" />
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-dim">
              大关卡完成 = 该领域所有必修章节都已通关；单章高分不会提前点亮整个大关卡。
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
              return (
                <li
                  key={chapter.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]"
                >
                  <span className="w-8 text-center font-mono text-[11px] text-dim">{chapter.order}</span>
                  <StarShape
                    tier={status?.star ?? "failed"}
                    locked={!status?.unlocked}
                    size={26}
                    glow={status?.star === "gold"}
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

function LegendItem({ icon, label }: { icon: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

function MapNode({
  node,
  star,
  locked,
  passed,
  started,
  studyDone,
  score,
  current,
  onSelect,
}: {
  node: Positioned;
  star: StarTier;
  locked: boolean;
  passed: boolean;
  started: boolean;
  studyDone: boolean;
  score: number;
  current: boolean;
  onSelect: () => void;
}) {
  const statusText = locked
    ? "未解锁"
    : passed
      ? `${score} 分`
      : studyDone
        ? "待考试"
        : started
          ? "学习中"
          : "可开始";

  const shortTitle = node.chapter.title.replace(/^第\s*[\d-]+\s*章\s*/, "").replace(/^前言/, "前言");

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      className="star-node"
      role="button"
      tabIndex={0}
      aria-label={`${node.chapter.title}，${statusText}${passed ? `，${starLabel(star)}` : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <title>{`${node.chapter.title} · ${statusText}`}</title>
      {current && (
        <>
          <circle r={24} cy={-4} fill="none" stroke="var(--color-cyan)" strokeWidth={1.5} className="pulse-dot" opacity={0.6} />
          <text y={-30} textAnchor="middle" fontSize={8.5} fill="var(--color-cyan)" letterSpacing="1">
            当前
          </text>
        </>
      )}
      <g transform="translate(-16, -20)">
        <StarShape tier={star} locked={locked} size={32} glow={star === "gold" || (passed && !locked)} />
      </g>
      <text y={24} textAnchor="middle" fontSize={9.5} fill={locked ? "var(--color-dim)" : "var(--color-muted)"} className="star-label">
        {truncate(shortTitle, 8)}
      </text>
      <text y={38} textAnchor="middle" fontSize={9} fill={locked ? "var(--color-dim)" : passed ? "var(--color-cyan)" : "var(--color-muted)"}>
        {statusText}
      </text>
    </g>
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
        <Badge tone="neutral">AREA {area?.code}</Badge>
        <Badge tone="neutral">{area?.title}</Badge>
        {chapter.groupTitle && <Badge tone="neutral">{chapter.groupTitle}</Badge>}
        <Badge tone={status?.passed ? "ok" : "cyan"}>
          {status?.passed ? `已通关 · ${status.bestTotal} 分 · ${starLabel(status.star)}` : status?.unlocked ? "已解锁" : "未解锁"}
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
            <span key={section.id} className="rounded-md border border-line/70 bg-white/[0.03] px-2 py-0.5 text-[11px] text-muted">
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
              ? `已满足：前置章节「${previous.title}」已通关。`
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
            先去前置章节
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
