"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Check, Link2, Link2Off, ListChecks, ReceiptText, Trash2, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import {
  applySuggestionsAction,
  bookStatementLineAction,
  deleteStatementAction,
  dismissStatementLineAction,
  matchStatementLineAction,
  restoreStatementLineAction,
  unmatchStatementLineAction,
} from "@/server/treasury/reconciliation-actions";
import { bookStatementLineSchema, dismissStatementLineSchema } from "@/server/treasury/schemas";

export type StatementLineView = {
  id: string;
  bookedOn: string;
  label: string;
  reference: string | null;
  amount: bigint;
  state: "matched" | "dismissed" | "open";
  suggestion: { entries: { key: string }[] } | null;
};

export type CandidateView = {
  key: string;
  on: string;
  label: string;
  reference: string | null;
  amount: bigint;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** Every suggestion of the period accepted at once. */
export function ApplySuggestionsButton(props: {
  accountId: string;
  from: string;
  to: string;
  count: number;
}) {
  const t = useTranslations("treasury.reconciliation");
  return (
    <ConfirmAction
      action={applySuggestionsAction}
      input={{ accountId: props.accountId, from: props.from, to: props.to }}
      label={t("applySuggestions", { count: props.count })}
      icon={<ListChecks data-icon="inline-start" />}
      title={t("applyTitle")}
      description={t("applyDescription", { count: props.count })}
      confirmLabel={t("apply")}
      successMessage={(data) => t("applied", { count: data.matched })}
      variant="default"
      size="sm"
    />
  );
}

/** A line's actions: accept its suggestion, match by hand, book, set aside; or undo. */
export function StatementLineActions({
  line,
  candidates,
}: {
  line: StatementLineView;
  candidates: CandidateView[];
}) {
  const t = useTranslations("treasury.reconciliation");
  if (line.state === "matched") {
    return (
      <ConfirmAction
        action={unmatchStatementLineAction}
        input={{ lineId: line.id }}
        label={t("unmatch")}
        icon={<Link2Off />}
        title={t("unmatchTitle")}
        description={t("unmatchDescription")}
        confirmLabel={t("unmatch")}
        successMessage={t("unmatched")}
        variant="ghost"
        size="icon"
      />
    );
  }
  if (line.state === "dismissed") {
    return (
      <ConfirmAction
        action={restoreStatementLineAction}
        input={{ lineId: line.id }}
        label={t("restore")}
        icon={<Undo2 />}
        title={t("restoreTitle")}
        description={t("restoreDescription")}
        confirmLabel={t("restore")}
        successMessage={t("restored")}
        variant="ghost"
        size="icon"
      />
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {line.suggestion ? (
        <AcceptSuggestion lineId={line.id} keys={line.suggestion.entries.map((e) => e.key)} />
      ) : null}
      <MatchDialog line={line} candidates={candidates} />
      <BookLineDialog line={line} />
      <DismissLineDialog lineId={line.id} />
    </div>
  );
}

function AcceptSuggestion({ lineId, keys }: { lineId: string; keys: string[] }) {
  const t = useTranslations("treasury.reconciliation");
  const match = useAction(matchStatementLineAction);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={match.pending}
      onClick={() =>
        void match.run(
          { lineId, entryKeys: keys },
          { onSuccess: () => toast.success(t("matched")) },
        )
      }
    >
      <Check data-icon="inline-start" />
      {t("accept")}
    </Button>
  );
}

/** Ledger entries ticked by hand until their total equals the line's amount. */
function MatchDialog({
  line,
  candidates,
}: {
  line: StatementLineView;
  candidates: CandidateView[];
}) {
  const t = useTranslations("treasury.reconciliation");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const match = useAction(matchStatementLineAction);
  // Same direction only, the closest amounts and days first.
  const offered = candidates
    .filter((c) => c.amount > 0n === line.amount > 0n)
    .map((c) => ({
      ...c,
      gap:
        (c.amount === line.amount ? 0 : 1) * 1_000 +
        Math.abs(dayNumber(c.on) - dayNumber(line.bookedOn)),
    }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 60);
  const total = candidates
    .filter((c) => picked.includes(c.key))
    .reduce((sum, c) => sum + c.amount, 0n);
  const money = (v: bigint) => formatDZD(v, locale);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicked([]);
      }}
      trigger={
        <Button size="sm" variant="ghost">
          <Link2 data-icon="inline-start" />
          {t("match")}
        </Button>
      }
      title={t("matchTitle")}
      description={t("matchDescription", {
        amount: money(line.amount),
        date: formatDate(line.bookedOn),
      })}
      submitLabel={t("match")}
      pending={match.pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (total !== line.amount) return void toast.error(t("totalMismatch"));
        void match.run(
          { lineId: line.id, entryKeys: picked },
          {
            onSuccess: () => {
              toast.success(t("matched"));
              setOpen(false);
              setPicked([]);
            },
          },
        );
      }}
    >
      {offered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noCandidate")}</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="match-candidates">
          {offered.map((c) => (
            <li key={c.key}>
              <label className="flex items-start gap-2 rounded-md p-1 text-sm hover:bg-muted/50">
                <Checkbox
                  checked={picked.includes(c.key)}
                  onCheckedChange={(checked) =>
                    setPicked((current) =>
                      checked ? [...current, c.key] : current.filter((k) => k !== c.key),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="tabular-nums" dir="ltr">
                    {formatDate(c.on)}
                  </span>{" "}
                  · {c.label}
                  {c.reference ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · <bdi dir="ltr">{c.reference}</bdi>
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums" dir="ltr">
                  {money(c.amount)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm" data-testid="match-total">
        {t("selected", { total: money(total), amount: money(line.amount) })}
      </p>
    </FormDialog>
  );
}

/** A line only the bank knows recorded as a movement (income, expense, bank fee). */
function BookLineDialog({ line }: { line: StatementLineView }) {
  const t = useTranslations("treasury");
  const [open, setOpen] = useState(false);
  const book = useAction(bookStatementLineAction);
  const credit = line.amount > 0n;
  const form = useForm<
    z.input<typeof bookStatementLineSchema>,
    unknown,
    z.output<typeof bookStatementLineSchema>
  >({
    resolver: zodResolver(bookStatementLineSchema),
    defaultValues: {
      lineId: line.id,
      kind: credit ? "income" : "bank_fee",
      label: line.label.slice(0, 160),
      category: "",
    },
  });
  const kinds = credit ? (["income"] as const) : (["bank_fee", "expense"] as const);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="ghost">
          <ReceiptText data-icon="inline-start" />
          {t("reconciliation.book")}
        </Button>
      }
      title={t("reconciliation.bookTitle")}
      description={t("reconciliation.bookDescription")}
      submitLabel={t("reconciliation.book")}
      pending={book.pending}
      onSubmit={form.handleSubmit(() =>
        book.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("reconciliation.booked"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="kind"
        label={t("fields.movementKind")}
        options={kinds.map((k) => ({ value: k, label: t(`movementKind.${k}`) }))}
      />
      <TextField control={form.control} name="label" label={t("fields.label")} />
      <TextField control={form.control} name="category" label={t("fields.category")} />
    </FormDialog>
  );
}

function DismissLineDialog({ lineId }: { lineId: string }) {
  const t = useTranslations("treasury");
  const [open, setOpen] = useState(false);
  const dismiss = useAction(dismissStatementLineAction);
  const form = useForm<
    z.input<typeof dismissStatementLineSchema>,
    unknown,
    z.output<typeof dismissStatementLineSchema>
  >({
    resolver: zodResolver(dismissStatementLineSchema),
    defaultValues: { lineId, reason: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t("reconciliation.dismiss")}
        >
          <Ban />
        </Button>
      }
      title={t("reconciliation.dismissTitle")}
      description={t("reconciliation.dismissDescription")}
      submitLabel={t("reconciliation.dismiss")}
      pending={dismiss.pending}
      onSubmit={form.handleSubmit(() =>
        dismiss.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("reconciliation.dismissed"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="reason" label={t("fields.reason")} rows={2} />
    </FormDialog>
  );
}

/** A statement nothing was matched on, withdrawn. */
export function DeleteStatementButton({ statementId }: { statementId: string }) {
  const t = useTranslations("treasury.reconciliation");
  return (
    <ConfirmAction
      action={deleteStatementAction}
      input={{ statementId }}
      label={t("deleteStatement")}
      icon={<Trash2 />}
      title={t("deleteStatementTitle")}
      description={t("deleteStatementDescription")}
      confirmLabel={t("deleteStatement")}
      successMessage={t("statementDeleted")}
      destructive
      variant="ghost"
      size="icon"
    />
  );
}
