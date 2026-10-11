"use client";

import {
  Building2,
  Contact,
  CornerDownLeft,
  FileSignature,
  IdCard,
  type LucideIcon,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import type { Access } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { searchRecordsAction } from "@/server/search/actions";
import type { SearchHit } from "@/server/search/queries";

import { allNavItems, visibleItems } from "./nav-items";

const kindIcons: Record<SearchHit["kind"], LucideIcon> = {
  lead: Contact,
  buyer: IdCard,
  sale: FileSignature,
  unit: Building2,
};

/** Lower case, accents removed: « Réglages » matches « reglages ». */
function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** « ⌘ » on Apple devices, « Ctrl » elsewhere (read once in the browser). */
function useModifierLabel() {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

type Entry = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  detail?: string | null;
  position: number;
};

/**
 * The command palette (CLAUDE.md §14 item 8): ⌘K / Ctrl K, or the search field of the top bar,
 * opens it; it goes to any page the member may open and finds leads, buyers, sales and units
 * (`searchRecordsAction`, with their lists' visibility) by name, phone, number or code.
 */
export function CommandPalette({ access, group }: { access: Access; group: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const listId = useId();
  const modifier = useModifierLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Records: two characters at least, a short pause after typing, the latest answer only.
  useEffect(() => {
    const q = query.trim();
    const id = ++request.current;
    if (q.length < 2) return;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const result = await searchRecordsAction({ q });
      if (id !== request.current) return;
      setSearching(false);
      setHits(result.ok ? result.data : []);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const q = fold(query.trim());
  const pages = visibleItems(allNavItems, access, group)
    .map((item) => ({
      key: item.href,
      href: item.href,
      label: t(`nav.${item.key}`),
      icon: item.icon,
    }))
    .filter((entry) => !q || fold(entry.label).includes(q))
    .slice(0, q ? 6 : 8);
  const records = q.length >= 2 ? hits : [];
  const grouped = [
    { title: t("palette.pages"), entries: pages },
    ...(["lead", "buyer", "sale", "unit"] as const).map((kind) => ({
      title: t(`palette.kinds.${kind}`),
      entries: records
        .filter((hit) => hit.kind === kind)
        .map((hit) => ({
          key: `${kind}-${hit.id}`,
          href: hit.href,
          label: hit.title,
          icon: kindIcons[kind],
          // Leads and buyers show their phone, as everywhere else.
          detail: hit.detail && hit.detail.startsWith("+") ? formatPhone(hit.detail) : hit.detail,
        })),
    })),
  ].filter((section) => section.entries.length > 0);
  // Positions across the sections, for the arrow keys.
  const offsets = grouped.map((_, i) =>
    grouped.slice(0, i).reduce((sum, section) => sum + section.entries.length, 0),
  );
  const sections = grouped.map((section, i) => ({
    title: section.title,
    entries: section.entries.map((entry, j): Entry => ({
      ...entry,
      position: (offsets[i] ?? 0) + j,
    })),
  }));
  const flat = sections.flatMap((section) => section.entries);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  const close = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setQuery("");
      setHits([]);
      setActive(0);
    }
  };
  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    close(false);
    router.push(entry.href);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % Math.max(flat.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + flat.length) % Math.max(flat.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(flat[current]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 rounded-lg bg-muted px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/80 sm:w-64"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden flex-1 text-start sm:inline">{t("palette.open")}</span>
        <span className="sr-only sm:hidden">{t("palette.open")}</span>
        <kbd
          dir="ltr"
          className="hidden rounded-md border bg-card px-1.5 font-sans text-[0.6875rem] font-medium sm:inline"
        >
          {modifier} K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">{t("palette.label")}</DialogTitle>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={flat.length > 0 ? `${listId}-${current}` : undefined}
              aria-label={t("palette.label")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t("palette.placeholder")}
              className="h-14 min-w-0 flex-1 bg-transparent text-[1.0625rem] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div id={listId} role="listbox" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
            {sections.map((section) => (
              <div key={section.title} role="group" aria-label={section.title} className="py-1">
                <div className="px-2 pt-1 pb-1.5 text-[0.6875rem] font-semibold text-muted-foreground">
                  {section.title}
                </div>
                {section.entries.map((entry) => {
                  const selected = entry.position === current;
                  return (
                    <div
                      key={entry.key}
                      id={`${listId}-${entry.position}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(entry.position)}
                      onClick={() => go(entry)}
                      className={cn(
                        "flex cursor-default items-center gap-3 rounded-lg px-2 py-2",
                        selected && "bg-primary text-primary-foreground",
                      )}
                    >
                      <entry.icon
                        className={cn(
                          "size-4 shrink-0",
                          selected ? "text-primary-foreground" : "text-primary",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      {entry.detail ? (
                        <bdi
                          className={cn(
                            "max-w-[45%] truncate text-footnote",
                            selected ? "text-primary-foreground/80" : "text-muted-foreground",
                          )}
                        >
                          {entry.detail}
                        </bdi>
                      ) : null}
                      {selected ? (
                        <CornerDownLeft
                          className="size-3.5 shrink-0 rtl:-scale-x-100"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
            {flat.length === 0 ? (
              <p className="px-2 py-8 text-center text-muted-foreground">
                {searching ? t("palette.searching") : t("palette.empty")}
              </p>
            ) : null}
          </div>
          <div className="hidden border-t px-4 py-2 text-[0.6875rem] text-muted-foreground sm:block">
            {t("palette.hint")}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
