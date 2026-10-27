import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-line/80 bg-panel/75 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};

export function Button({
  children,
  className,
  variant = "primary",
  size = "md",
  icon,
  ...rest
}: ButtonProps) {
  const variants = {
    primary:
      "bg-cyan/15 text-cyan border border-cyan/45 hover:bg-cyan/25 hover:border-cyan/70 shadow-[0_0_22px_-10px_rgba(55,214,230,0.9)]",
    secondary:
      "bg-panel2 text-ink border border-line hover:border-cyan/40 hover:text-cyan",
    ghost: "bg-transparent text-muted border border-transparent hover:text-ink hover:bg-white/5",
    danger:
      "bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20",
    gold: "bg-gold/15 text-gold border border-gold/40 hover:bg-gold/25",
  } as const;

  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
    md: "px-4 py-2 text-sm rounded-xl gap-2",
    lg: "px-6 py-3 text-[15px] rounded-xl gap-2",
  } as const;

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  children,
  variant = "primary",
  size = "md",
  className,
  icon,
}: {
  to: LinkProps["to"];
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "gold";
  size?: "sm" | "md" | "lg";
  className?: string;
  icon?: ReactNode;
}) {
  const variants = {
    primary:
      "bg-cyan/15 text-cyan border border-cyan/45 hover:bg-cyan/25 hover:border-cyan/70 shadow-[0_0_22px_-10px_rgba(55,214,230,0.9)]",
    secondary: "bg-panel2 text-ink border border-line hover:border-cyan/40 hover:text-cyan",
    ghost: "bg-transparent text-muted border border-transparent hover:text-ink hover:bg-white/5",
    gold: "bg-gold/15 text-gold border border-gold/40 hover:bg-gold/25",
  } as const;
  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
    md: "px-4 py-2 text-sm rounded-xl gap-2",
    lg: "px-6 py-3 text-[15px] rounded-xl gap-2",
  } as const;

  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "cyan" | "gold" | "ok" | "danger" | "silver" | "bronze";
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-white/5 text-muted",
    cyan: "border-cyan/40 bg-cyan/10 text-cyan",
    gold: "border-gold/40 bg-gold/10 text-gold",
    silver: "border-silver/40 bg-silver/10 text-silver",
    bronze: "border-bronze/40 bg-bronze/10 text-bronze",
    ok: "border-ok/40 bg-ok/10 text-ok",
    danger: "border-danger/40 bg-danger/10 text-danger",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone = "cyan",
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: "cyan" | "gold" | "ok";
  label?: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tones = {
    cyan: "bg-gradient-to-r from-cyan/70 to-blue/80",
    gold: "bg-gradient-to-r from-gold/80 to-bronze/90",
    ok: "bg-gradient-to-r from-ok/70 to-cyan/70",
  } as const;

  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(percent)}%</span>
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "进度"}
      >
        <div className={cn("h-full rounded-full transition-all duration-500", tones[tone])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function ProgressRing({
  percent,
  size = 132,
  stroke = 10,
  children,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-cyan)" />
            <stop offset="100%" stopColor="var(--color-blue)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--color-line-soft)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#ring-gradient)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 700ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "cyan" | "gold";
}) {
  const tones = {
    default: "text-ink",
    cyan: "text-cyan",
    gold: "text-gold",
  } as const;
  return (
    <div className="rounded-xl border border-line/70 bg-panel2/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-dim">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-12 text-center">
      <div className="text-3xl" aria-hidden="true">
        ✦
      </div>
      <div className="text-base font-medium text-ink">{title}</div>
      {description && <p className="max-w-md text-sm leading-relaxed text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={cn("w-full rounded-2xl border border-line bg-panel p-5 shadow-2xl", width)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-muted hover:bg-white/5 hover:text-ink"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto pr-1 text-sm leading-relaxed text-muted">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line/70 bg-panel2/50 px-4 py-3">
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        <span className="text-[10px] tabular-nums text-dim">{checked ? "开" : "关"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
            checked ? "border-cyan/70 bg-cyan/35" : "border-line bg-line-soft",
          )}
        >
          <span
            className="absolute rounded-full transition-[left] duration-200"
            style={{
              width: 18,
              height: 18,
              top: 2,
              left: checked ? 23 : 2,
              background: "var(--color-knob)",
              boxShadow: "0 0 0 1px var(--color-line), 0 1px 3px rgba(0,0,0,0.28)",
            }}
          />
        </button>
      </span>
    </label>
  );
}
