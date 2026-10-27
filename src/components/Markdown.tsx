import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ContentBlock } from "../types";
import { upstreamImageUrl } from "../lib/course/assets";
import { cn } from "./ui";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
  if (node.tagName === "IMG") {
    node.setAttribute("loading", "lazy");
  }
});

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "style", "iframe", "form", "input"],
    ADD_ATTR: ["target", "rel", "id", "colspan", "rowspan", "align"],
  });
}

export function CourseBlocks({
  blocks,
  className,
  onSectionVisible,
}: {
  blocks: ContentBlock[];
  className?: string;
  onSectionVisible?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 正文 HTML 中可能内嵌 <img>（非独立图片块）。本地素材缺失时自动回源到上游仓库，
  // 让从 GitHub 克隆的版本无需 500MB 图片也能正常显示。
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const images = [...root.querySelectorAll<HTMLImageElement>('img[src^="/course-assets/"]')];
    const cleanups: (() => void)[] = [];

    for (const image of images) {
      const useUpstream = () => {
        if (image.dataset.upstreamFallback === "1") return;
        const upstream = upstreamImageUrl(image.getAttribute("src"));
        if (!upstream) return;
        image.dataset.upstreamFallback = "1";
        image.src = upstream;
      };
      if (image.complete && image.naturalWidth === 0) useUpstream();
      image.addEventListener("error", useUpstream);
      cleanups.push(() => image.removeEventListener("error", useUpstream));
    }

    return () => cleanups.forEach((fn) => fn());
  }, [blocks]);

  return (
    <div ref={containerRef} className={cn("course-prose", className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} onSectionVisible={onSectionVisible} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  onSectionVisible,
}: {
  block: ContentBlock;
  onSectionVisible?: () => void;
}) {
  const html = useMemo(() => (block.html ? sanitize(block.html) : ""), [block.html]);

  if (block.k === "code") {
    return <CodeBlock code={block.code ?? ""} lang={block.lang ?? "text"} />;
  }

  if (block.k === "img") {
    return <CourseImage src={block.src ?? ""} alt={block.alt ?? ""} />;
  }

  if (block.k === "table") {
    return (
      <div className="my-4 overflow-x-auto">
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  if (block.k === "h3") {
    return <div onClick={onSectionVisible} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-line/80 bg-code">
      <div className="flex items-center justify-between border-b border-line/60 bg-white/[0.02] px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-dim">
          {lang || "text"} · {lines} 行
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-white/5 hover:text-cyan"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-[12.5px] leading-relaxed">
        <code className="font-mono text-code-ink">{code}</code>
      </pre>
    </div>
  );
}

export function CourseImage({ src, alt }: { src: string; alt: string }) {
  const [current, setCurrent] = useState(src);
  const [stage, setStage] = useState<"local" | "upstream" | "failed">("local");

  useEffect(() => {
    setCurrent(src);
    setStage("local");
  }, [src]);

  if (stage === "failed") {
    return (
      <div className="my-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-panel2/50 px-4 py-8 text-center">
        <span className="text-xl" aria-hidden="true">
          ▧
        </span>
        <span className="text-xs text-muted">图片加载失败：{alt || src}</span>
        <span className="text-[11px] leading-relaxed text-dim">
          本地素材与上游 raw 地址均不可用。若能访问课程仓库，可运行
          <code className="mx-1">npm run course:assets</code>
          复制图片素材；离线环境下图片会显示占位。
        </span>
      </div>
    );
  }

  return (
    <figure className="my-4">
      <img
        src={current}
        alt={alt}
        loading="lazy"
        onError={() => {
          if (stage === "local") {
            const upstream = upstreamImageUrl(src);
            if (upstream) {
              setCurrent(upstream);
              setStage("upstream");
              return;
            }
          }
          setStage("failed");
        }}
        className="mx-auto max-h-[560px] rounded-xl border border-line/60 bg-code object-contain"
      />
      {alt && <figcaption className="mt-2 text-center text-[11px] text-dim">{alt}</figcaption>}
      {stage === "upstream" && (
        <div className="mt-1 text-center text-[10.5px] text-dim">本地图片缺失，已从上游课程仓库加载</div>
      )}
    </figure>
  );
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => sanitize(marked.parse(text) as string), [text]);
  return <div className={cn("course-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
