import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useApp } from "../state/AppContext";
import { cn } from "./ui";
import { courseTotals } from "../lib/domain/rules";

const NAV = [
  { to: "/", label: "学习控制台", icon: "◎" },
  { to: "/map", label: "关卡星图", icon: "✦" },
  { to: "/review", label: "错题本", icon: "✎" },
  { to: "/glossary", label: "术语库", icon: "❖" },
  { to: "/settings", label: "设置", icon: "⚙" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { toast, dismissToast, statuses, progress, settings, updateSettings } = useApp();
  const location = useLocation();
  const totals = courseTotals(statuses);
  const unresolved = progress.wrong.filter((entry) => !entry.resolved).length;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 3600);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("s")) return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:text-cyan"
      >
        跳到主要内容
      </a>

      <header className="sticky top-0 z-40 border-b border-line/60 bg-void/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 lg:px-6">
          <NavLink to="/" className="flex items-center gap-2.5">
            <span className="relative flex h-8 w-8 items-center justify-center">
              <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-cyan/30 to-blue/30 blur-[6px]" />
              <span className="relative text-lg text-cyan">✦</span>
            </span>
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold tracking-wide text-ink">AI 星途</span>
              <span className="text-[10px] tracking-[0.2em] text-dim">GAMIFIED LEARNING</span>
            </span>
          </NavLink>

          <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="主导航">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "relative rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                    isActive
                      ? "bg-cyan/10 text-cyan"
                      : "text-muted hover:bg-white/5 hover:text-ink",
                  )
                }
              >
                <span className="mr-1.5 text-[11px] opacity-80" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
                {item.to === "/review" && unresolved > 0 && (
                  <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 py-0.5 text-[10px] text-gold">
                    {unresolved}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-line/70 bg-panel2/60 px-3 py-1.5 text-[11px] text-muted sm:flex">
              <span className="text-cyan">✦</span>
              <span className="tabular-nums">
                {totals.passed}/{totals.total}
              </span>
              <span className="text-dim">已通关</span>
            </div>
            <button
              type="button"
              onClick={() =>
                void updateSettings((current) => ({
                  ...current,
                  theme: current.theme === "paper" ? "dark" : "paper",
                }))
              }
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line/70 bg-panel2/60 px-2 text-[11px] text-muted transition-colors hover:border-cyan/40 hover:text-cyan"
              aria-label={settings.theme === "paper" ? "切换到深空皮肤" : "切换到纸质书页皮肤"}
              title={settings.theme === "paper" ? "切换到深空皮肤" : "切换到纸质书页皮肤"}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full border"
                style={{
                  background: settings.theme === "paper" ? "#f1e7d4" : "#0b111c",
                  borderColor: settings.theme === "paper" ? "#b7a17c" : "#37d6e6",
                }}
              />
              <span className="hidden lg:inline">{settings.theme === "paper" ? "深空" : "纸页"}</span>
            </button>
            <NavLink
              to="/settings"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line/70 bg-panel2/60 text-muted hover:text-cyan md:hidden"
              aria-label="设置"
            >
              ⚙
            </NavLink>
          </div>
        </div>
      </header>

      <main id="main-content" className="pb-24 md:pb-10">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-void/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="底部导航"
      >
        <div className="grid grid-cols-5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[11px]",
                  isActive ? "text-cyan" : "text-muted",
                )
              }
            >
              <span className="text-base leading-none" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {toast && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 md:bottom-8">
          <div
            role="status"
            className={cn(
              "float-in rounded-xl border px-4 py-2.5 text-sm shadow-xl",
              toast.tone === "error"
                ? "border-danger/50 bg-toast-error text-danger"
                : toast.tone === "success"
                  ? "border-ok/40 bg-toast-ok text-ok"
                  : "border-line bg-panel text-ink",
            )}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
