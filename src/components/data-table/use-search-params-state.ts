"use client";

import { useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Filters kept in the URL: `set({ stage: "new" })` replaces the query (empty values removed)
 * and goes back to page 1.
 */
export function useSearchParamsState() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const set = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  return { get: (key: string) => searchParams.get(key) ?? "", set, pending };
}
