import type { StarTier } from "../types";
import { cn } from "./ui";

const STAR_PATH =
  "M12 2.6l2.86 5.86 6.44.93-4.65 4.55 1.1 6.42L12 17.32 6.25 20.36l1.1-6.42L2.7 9.39l6.44-.93L12 2.6z";

const TIER_FILL: Record<StarTier, string> = {
  gold: "#f6c453",
  silver: "#c7d0dc",
  bronze: "#c98b5a",
  normal: "#5fa8e8",
  failed: "var(--star-failed-fill)",
};

const TIER_STROKE: Record<StarTier, string> = {
  gold: "#ffe6a3",
  silver: "#eef3f9",
  bronze: "#e8b892",
  normal: "#8fd0ff",
  failed: "var(--star-failed-stroke)",
};

export function StarShape({
  tier = "normal",
  locked = false,
  size = 28,
  glow = false,
  className,
}: {
  tier?: StarTier;
  locked?: boolean;
  size?: number;
  glow?: boolean;
  className?: string;
}) {
  const fill = locked ? "var(--star-locked-fill)" : TIER_FILL[tier];
  const stroke = locked ? "var(--star-locked-stroke)" : TIER_STROKE[tier];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("star-shape shrink-0", className)}
      aria-hidden="true"
      style={glow ? { filter: `drop-shadow(0 0 6px ${fill}aa)` } : undefined}
    >
      <path
        d={STAR_PATH}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
        opacity={locked ? 0.75 : 1}
      />
      {locked && (
        <g transform="translate(9.2 9.2) scale(0.24)" fill="var(--star-lock-ink)">
          <path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm0 2a3 3 0 013 3v3H9V7a3 3 0 013-3z" />
        </g>
      )}
    </svg>
  );
}

export function StarRating({ star, size = 18 }: { star: StarTier; size?: number }) {
  const filled = star === "failed" ? 0 : star === "normal" ? 1 : star === "bronze" ? 2 : star === "silver" ? 3 : 4;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${star} 评价`}>
      {[1, 2, 3, 4].map((index) => (
        <StarShape
          key={index}
          tier={index <= filled ? star : "failed"}
          size={size}
          className={index <= filled ? "" : "opacity-30"}
        />
      ))}
    </span>
  );
}

export function TierBadgeText({ star }: { star: StarTier }) {
  const labels: Record<StarTier, string> = {
    gold: "金",
    silver: "银",
    bronze: "铜",
    normal: "普通",
    failed: "未通关",
  };
  return <span className="text-[11px]">{labels[star]}</span>;
}
