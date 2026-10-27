import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApp } from "../state/AppContext";
import { Badge, Card, cn } from "../components/ui";

export function GlossaryPage() {
  const { glossary, course } = useApp();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const chapterByPath = useMemo(
    () => new Map(course.chapters.map((chapter) => [chapter.sourcePath, chapter])),
    [course.chapters],
  );

  const keyword = query.trim().toLowerCase();
  const terms = useMemo(
    () =>
      glossary.terms.filter((term) => {
        if (!keyword) return true;
        return `${term.term} ${term.summary} ${term.note} ${term.group}`.toLowerCase().includes(keyword);
      }),
    [glossary.terms, keyword],
  );

  const contrasts = useMemo(
    () =>
      glossary.contrasts.filter((contrast) => {
        if (!keyword) return true;
        const text = `${contrast.title} ${contrast.detail} ${(contrast.items ?? []).map((item) => `${item.name} ${item.text}`).join(" ")}`;
        return text.toLowerCase().includes(keyword);
      }),
    [glossary.contrasts, keyword],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof terms>();
    for (const term of terms) {
      const list = map.get(term.group) ?? [];
      list.push(term);
      map.set(term.group, list);
    }
    return [...map.entries()];
  }, [terms]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-dim">Codex</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">全书术语库</h1>
          <p className="mt-1 text-sm text-muted">
            来自课程《全书术语表》，{glossary.terms.length} 条术语 · {glossary.contrasts.length} 组易混对照。
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            const next = new URLSearchParams(params);
            if (event.target.value) next.set("q", event.target.value);
            else next.delete("q");
            setParams(next, { replace: true });
          }}
          placeholder="搜索术语 / 解释 / 易混点"
          className="w-64 rounded-xl border border-line bg-panel2/60 px-3 py-2 text-xs text-ink outline-none placeholder:text-dim focus:border-cyan/50"
        />
      </div>

      <Card className="mb-5 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">高频易混对照</h2>
          <Badge tone="neutral">{contrasts.length} 组</Badge>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {contrasts.map((contrast) => (
            <div key={contrast.id} className="rounded-xl border border-line/60 bg-panel2/35 p-3">
              <div className="text-[12.5px] font-medium text-ink">{contrast.title}</div>
              <div className="mt-1 text-[12px] leading-relaxed text-muted">{contrast.detail}</div>
              {contrast.items && contrast.items.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-muted">
                  {contrast.items.map((item) => (
                    <li key={item.name}>
                      <span className="text-cyan/80">{item.name}</span>：{item.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {contrasts.length === 0 && <p className="text-[12px] text-muted">没有匹配的概念对照。</p>}
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">没有匹配的术语，试试其他关键词。</Card>
      ) : (
        <div className="space-y-5">
          {groups.map(([group, list]) => (
            <section key={group}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">{group}</h2>
                <span className="text-[11px] text-dim">{list.length} 条</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {list.map((term) => (
                  <Card key={`${term.group}-${term.term}`} className={cn("p-3")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[13px] font-semibold text-cyan">{term.term}</div>
                      <div className="flex flex-wrap justify-end gap-1">
                        {term.refs.slice(0, 3).map((ref) => {
                          const chapter = chapterByPath.get(ref.target);
                          return chapter ? (
                            <Link
                              key={ref.target}
                              to={`/learn/${chapter.id}`}
                              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-dim hover:border-cyan/40 hover:text-cyan"
                            >
                              {ref.text || chapter.title.slice(0, 8)}
                            </Link>
                          ) : null;
                        })}
                      </div>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">{term.summary}</p>
                    {term.note && (
                      <p className="mt-1 text-[11px] leading-relaxed text-dim">易混 / 解决：{term.note}</p>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
