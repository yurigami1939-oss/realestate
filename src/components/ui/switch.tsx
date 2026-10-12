"use client";

import { cn } from "cn";
import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

/**
 * An on / off switch like iOS and macOS (CLAUDE.md §8 Look): green when on, a white thumb in
 * both themes, larger on touch screens.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.375rem] w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-apple outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-success-vivid data-[state=unchecked]:bg-foreground/15 pointer-coarse:h-[1.875rem] pointer-coarse:w-[3.25rem]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[1.125rem] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-apple data-[state=checked]:translate-x-3.5 rtl:data-[state=checked]:-translate-x-3.5 pointer-coarse:size-[1.625rem] pointer-coarse:data-[state=checked]:translate-x-[1.375rem] rtl:pointer-coarse:data-[state=checked]:-translate-x-[1.375rem]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
