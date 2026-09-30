"use client";

import { Direction } from "radix-ui";

/** Client-side providers shared by every page. */
export function Providers({ dir, children }: { dir: "ltr" | "rtl"; children: React.ReactNode }) {
  return <Direction.Provider dir={dir}>{children}</Direction.Provider>;
}
