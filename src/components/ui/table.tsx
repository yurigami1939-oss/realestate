"use client";

import * as React from "react";
import { cn } from "cn";

/**
 * `stack`: on phones the rows become stacked blocks (CLAUDE.md §14 item 20) — each cell is
 * labelled with its column's header (`data-label`, copied from the header row after each
 * render) and shown under the row's first cell; same markup, so nothing renders twice.
 */
function Table({
  className,
  stack = false,
  ...props
}: React.ComponentProps<"table"> & { stack?: boolean }) {
  const ref = React.useRef<HTMLTableElement>(null);
  React.useEffect(() => {
    const table = ref.current;
    if (!stack || !table) return;
    const labels = Array.from(table.querySelectorAll("thead th")).map(
      (th) => th.textContent?.trim() ?? "",
    );
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      Array.from(row.children).forEach((cell, i) => {
        if (cell instanceof HTMLElement) cell.dataset.label = labels[i] ?? "";
      });
    }
  });
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        ref={ref}
        data-slot="table"
        data-stack={stack ? "" : undefined}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/40 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        // A row whose record link carries `data-row-link` opens it from anywhere in the row; its
        // other buttons and links stay clickable above (CLAUDE.md §14 item 15).
        "has-[a[data-row-link]]:relative has-[a[data-row-link]]:cursor-pointer [&_:is(button,input,select,textarea,label,a:not([data-row-link]))]:relative [&_:is(button,input,select,textarea,label,a:not([data-row-link]))]:z-10 [&_a[data-row-link]]:after:absolute [&_a[data-row-link]]:after:inset-0 [&_a[data-row-link]]:after:content-['']",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-start align-middle text-xs font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pe-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap tabular-nums [&:has([role=checkbox])]:pe-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
