"use client";

import { Direction } from "radix-ui";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Client-side providers shared by every page. */
export function Providers({ dir, children }: { dir: "ltr" | "rtl"; children: React.ReactNode }) {
  return (
    <Direction.Provider dir={dir}>
      <TooltipProvider>
        {children}
        <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} />
      </TooltipProvider>
    </Direction.Provider>
  );
}
