"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

import { useSearchParamsState } from "./use-search-params-state";

/** Search box kept in the URL (`?q=`), applied once the user pauses typing. */
export function SearchInput({ label }: { label: string }) {
  const params = useSearchParamsState();
  const current = params.get("q");
  const [q, setQ] = useState(current);

  useEffect(() => {
    if (q === current) return;
    const timer = setTimeout(() => params.set({ q }), 350);
    return () => clearTimeout(timer);
  }, [q, current, params]);

  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="ps-8"
      />
    </div>
  );
}
