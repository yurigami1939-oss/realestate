"use client";

import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Client-side providers shared by every page. */
export function Providers({ dir, children }: { dir: "ltr" | "rtl"; children: React.ReactNode }) {
  return (
    // Light, dark or the system's (the default), stored per browser (CLAUDE.md §14 item 18).
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Direction.Provider dir={dir}>
        <TooltipProvider>
          {children}
          <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} dir={dir} />
        </TooltipProvider>
      </Direction.Provider>
    </ThemeProvider>
  );
}
