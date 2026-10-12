import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * What a page looks like while it loads (`loading.tsx`, CLAUDE.md §14 item 10): the shape of
 * its header and content in soft placeholders, announced once to screen readers.
 */
function Frame({ width, children }: { width: string; children: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <div className={cn("mx-auto space-y-6", width)} aria-busy="true" role="status">
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}

function Header({ actions = 2 }: { actions?: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function CardBlock({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-4 rounded-xl bg-card p-5 shadow-card", className)}>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="flex justify-between gap-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      ))}
    </div>
  );
}

/** A list: header, filters, a table of rows. */
export function ListSkeleton() {
  return (
    <Frame width="max-w-7xl">
      <Header />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-72 rounded-lg" />
        <Skeleton className="h-9 w-44 rounded-lg" />
        <Skeleton className="h-9 w-44 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-xl bg-card shadow-card">
        <div className="border-b px-3 py-3">
          <Skeleton className="h-3 w-1/2" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b px-3 py-3.5 last:border-0">
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="ms-auto h-4 w-1/6" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** A record: header, then its sections side by side. */
export function RecordSkeleton() {
  return (
    <Frame width="max-w-7xl">
      <Skeleton className="h-4 w-32" />
      <Header actions={3} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CardBlock lines={5} />
          <CardBlock lines={3} />
        </div>
        <CardBlock lines={6} />
      </div>
    </Frame>
  );
}

/** The dashboard: header, to-dos, figures. */
export function DashboardSkeleton() {
  return (
    <Frame width="max-w-7xl">
      <Header actions={0} />
      <CardBlock lines={4} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl bg-card p-5 shadow-card">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        ))}
      </div>
      <CardBlock lines={3} />
    </Frame>
  );
}

/** Any other page: header and a few sections. */
export function PageSkeleton() {
  return (
    <Frame width="max-w-5xl">
      <Header actions={1} />
      <CardBlock lines={4} />
      <CardBlock lines={3} />
    </Frame>
  );
}
