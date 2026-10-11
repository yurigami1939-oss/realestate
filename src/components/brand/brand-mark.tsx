import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The app's mark: a white house with an arched door on a blue rounded square — the same drawing
 * as the installed app's icons (scripts/generate-icons.ts) and the favicon (src/app/icon.svg).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id="brand-mark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b9bff" />
          <stop offset="1" stopColor="#0062e0" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22.5" fill="url(#brand-mark-fill)" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M50 23 78 47h-5v31H27V47h-5ZM43 78V63a7 7 0 0 1 14 0v15Z"
      />
    </svg>
  );
}

/** The mark and the name, as the app signs its own pages. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className="size-7" />
      <span className="text-[1.0625rem] font-semibold tracking-tight">{BRAND_NAME}</span>
    </span>
  );
}
