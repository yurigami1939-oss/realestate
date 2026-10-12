"use client";

import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";
import { Children, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A page's secondary actions behind « … » (CLAUDE.md §14 item 9): one primary action stays in
 * the header, the rest open as a menu. The actions are the pages' own buttons, links and dialog
 * triggers, shown as menu rows; the panel stays mounted while closed so a dialog opened from it
 * keeps living after the menu closes.
 */
export function MoreActions({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing the member may do here: no « … » at all.
  if (Children.toArray(children).length === 0) return null;
  return (
    <div ref={root} className="relative">
      <Button
        variant="outline"
        size="icon"
        aria-label={t("moreActions")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis />
      </Button>
      <div
        className={cn(
          "absolute end-0 top-full z-30 mt-2 w-max max-w-72 min-w-56 rounded-xl bg-popover p-1 text-popover-foreground shadow-raised",
          "flex flex-col",
          "[&_:is(button,a)]:h-9 [&_:is(button,a)]:w-full [&_:is(button,a)]:justify-start [&_:is(button,a)]:rounded-md [&_:is(button,a)]:border-0 [&_:is(button,a)]:bg-transparent [&_:is(button,a)]:px-2 [&_:is(button,a)]:font-normal [&_:is(button,a)]:shadow-none [&_:is(button,a):hover]:bg-muted",
          !open && "hidden",
        )}
        onClick={() => setOpen(false)}
      >
        {children}
      </div>
    </div>
  );
}
