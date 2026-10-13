"use client";

import { Headset } from "lucide-react";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { stopSupportSessionAction } from "@/server/console/actions";

/**
 * An operator's support session above every page (CLAUDE.console.md §12): read-only, with
 * « Terminer », which gives the operator their own session back in the console.
 */
export function SupportBanner({ text, endLabel }: { text: string; endLabel: string }) {
  const router = useRouter();
  const stop = useAction(stopSupportSessionAction);
  return (
    <div
      role="status"
      data-testid="support-banner"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-purple-soft px-4 py-2 text-center text-footnote font-medium text-purple"
    >
      <Headset className="size-3.5 shrink-0" aria-hidden />
      <span>{text}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-7"
        disabled={stop.pending}
        onClick={() =>
          stop.run(undefined, {
            onSuccess: () => {
              router.replace("/console");
              router.refresh();
            },
          })
        }
      >
        {endLabel}
      </Button>
    </div>
  );
}
