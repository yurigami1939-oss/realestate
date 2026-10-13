import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The app's mark, after Sayroura's logo: a white tower and a lighter one beside a gold one, under
 * a white roof with a gold window, on a navy rounded square — the same drawing as the favicon
 * (src/app/icon.svg) and the installed app's icons (scripts/generate-icons.ts).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient
          id="sayroura-bg"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="100"
          y2="100"
        >
          <stop offset="0" stopColor="#253f80" />
          <stop offset="1" stopColor="#101c42" />
        </linearGradient>
        <linearGradient
          id="sayroura-gold"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="20"
          x2="0"
          y2="80"
        >
          <stop offset="0" stopColor="#ecc77f" />
          <stop offset="1" stopColor="#bd8729" />
        </linearGradient>
        <clipPath id="sayroura-clip">
          <rect width="100" height="100" rx="22.5" />
        </clipPath>
      </defs>
      <g clipPath="url(#sayroura-clip)">
        <rect width="100" height="100" fill="url(#sayroura-bg)" />
        <rect x="25" y="31" width="11" height="40" fill="url(#sayroura-gold)" />
        <rect x="39" y="18" width="17" height="53" fill="#ffffff" />
        <rect x="59" y="37" width="11" height="34" fill="#ffffff" fillOpacity="0.82" />
        <path d="M14 79 50 55 86 79V100H14Z" fill="url(#sayroura-bg)" />
        <path
          d="M18 78.5 50 57 82 78.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g fill="url(#sayroura-gold)">
          <rect x="46" y="66" width="3.6" height="3.6" rx="0.4" />
          <rect x="50.4" y="66" width="3.6" height="3.6" rx="0.4" />
          <rect x="46" y="70.4" width="3.6" height="3.6" rx="0.4" />
          <rect x="50.4" y="70.4" width="3.6" height="3.6" rx="0.4" />
        </g>
      </g>
    </svg>
  );
}

/**
 * The name as the logo sets it — SAYROURA in spaced capitals, IMMOBILIER in gold between two
 * rules — in both languages (a lockup, Latin only: Arabic is never letter-spaced). `tone`: navy
 * ink on light surfaces, white on the navy ones.
 */
export function BrandWordmark({
  className,
  tone = "ink",
}: {
  className?: string;
  tone?: "ink" | "light";
}) {
  return (
    <span className={cn("inline-flex flex-col items-center gap-1", className)}>
      <span
        className={cn(
          "text-[1.0625rem] leading-none font-semibold tracking-[0.2em] uppercase",
          tone === "light" ? "text-white" : "text-foreground",
        )}
      >
        {BRAND_NAME}
      </span>
      <span className="flex items-center gap-1.5 text-[0.5625rem] leading-none font-medium tracking-[0.32em] text-gold uppercase">
        <span aria-hidden className="h-px w-3 bg-gold-vivid" />
        {BRAND_TAGLINE}
        <span aria-hidden className="h-px w-3 bg-gold-vivid" />
      </span>
    </span>
  );
}
