import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  copied: boolean;
}

/**
 * 兜底错误边界：任何渲染异常都展示可读的错误信息，
 * 而不是让整页变成白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("页面渲染出错：", error, info.componentStack);
  }

  private copy = async () => {
    const { error } = this.state;
    const text = [
      `AI 星途页面异常：${error?.message ?? "未知错误"}`,
      error?.stack ?? "",
      `时间：${new Date().toISOString()}`,
      `地址：${window.location.href}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-2xl border border-danger/40 bg-panel p-6">
          <h1 className="text-lg font-semibold text-ink">页面出错了，但你的学习进度没有丢</h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            刚才这一步触发了界面异常。成绩、进度都保存在本地浏览器里，刷新页面即可继续；如果反复出现，请把下面的错误信息发给我。
          </p>
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line/60 bg-panel2/60 p-3 text-[11.5px] leading-relaxed text-danger">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-cyan/45 bg-cyan/15 px-3 py-1.5 text-[12px] text-cyan hover:bg-cyan/25"
            >
              刷新页面
            </button>
            <button
              type="button"
              onClick={() => void this.copy()}
              className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] text-ink hover:border-cyan/40 hover:text-cyan"
            >
              {this.state.copied ? "已复制" : "复制错误信息"}
            </button>
            <a
              href="#/map"
              className="rounded-lg border border-transparent px-3 py-1.5 text-[12px] text-muted hover:bg-white/5 hover:text-ink"
              onClick={() => this.setState({ error: null })}
            >
              返回星图
            </a>
          </div>
        </div>
      </div>
    );
  }
}
