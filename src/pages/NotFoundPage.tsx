import { LinkButton } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <div className="text-4xl text-cyan">✦</div>
      <h1 className="mt-4 text-xl font-semibold text-ink">这片星域还没有点亮</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        你访问的页面不存在。可能是链接过期，或课程版本更新后章节路径发生了变化。
      </p>
      <div className="mt-5 flex gap-2">
        <LinkButton to="/">回到控制台</LinkButton>
        <LinkButton to="/map" variant="secondary">
          打开星图
        </LinkButton>
      </div>
    </div>
  );
}
