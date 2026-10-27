import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ContentBlock } from "../types";
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
  return (
    <div className={cn("course-prose", className)}>
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
    return <div className="my-4 overflow-x-auto">{<div dangerouslySetInnerHTML={{ __html: html }} />}</div>;
  }

  if (block.k === "h3") {
    return (
      <div
        onClick={onSectionVisible}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {  const [copied, setCopied] = useState(false);
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

export function CourseImage({ src, alt }: { src: string; alt: string }) {  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="my-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-panel2/50 px-4 py-8 text-center">
        <span className="text-xl" aria-hidden="true">
          ▧
        </span>
        <span className="text-xs text-muted">图片未导入：{alt || src}</span>
        <span className="text-[11px] text-dim">
          开发环境会自动读取课程仓库图片；生产部署请运行 <code>npm run course:assets</code>
        </span>
      </div>
    );
  }

  return (
    <figure className="my-4">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="mx-auto max-h-[560px] rounded-xl border border-line/60 bg-code object-contain"
      />
      {alt && <figcaption className="mt-2 text-center text-[11px] text-dim">{alt}</figcaption>}
    </figure>
  );
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => sanitize(marked.parse(text) as string), [text]);
  return <div className={cn("course-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
