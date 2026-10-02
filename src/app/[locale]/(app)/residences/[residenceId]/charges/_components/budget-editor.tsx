"use client";

import { CheckCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { annualReserve, periodPart } from "@/lib/charges";
import { formatDate } from "@/lib/dates";
import { formatAmountInput, formatDZD, parseDZD, sumCentimes } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { callsPerYear } from "@/lib/residences";
import { approveBudgetAction, saveBudgetAction } from "@/server/charges/actions";
import type { ChargesSetup } from "@/server/charges/queries";

/**
 * Budget of one year: annual amount per category (editable while draft), reserve fund and what
 * each call will ask for. Saved as a whole, then approved.
 */
export function BudgetEditor({
  setup,
  year,
  editable,
}: {
  setup: ChargesSetup;
  year: number;
  editable: boolean;
}) {
  const t = useTranslations("charges.budget");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const translate = useTranslateKey();
  const save = useAction(saveBudgetAction);
  const { budget, categories, residence } = setup;
  const approved = budget?.status === "approved";
  const canEdit = editable && !approved && categories.length > 0;

  const initial = Object.fromEntries(
    categories.map((c) => {
      const line = setup.lines.find((l) => l.categoryId === c.id);
      return [c.id, line ? formatAmountInput(line.amount) : ""];
    }),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [notes, setNotes] = useState(budget?.notes ?? "");
  const dirty =
    !budget ||
    notes !== (budget.notes ?? "") ||
    categories.some((c) => (values[c.id] ?? "") !== (initial[c.id] ?? ""));

  const frequency = budget?.frequency ?? residence.chargeFrequency;
  const reserveBp = budget?.reserveFundBp ?? residence.reserveFundBp;
  const amountOf = (categoryId: string) => {
    const raw = (values[categoryId] ?? "").trim();
    return raw === "" ? 0n : parseDZD(raw);
  };
  const amounts = categories.map((c) => amountOf(c.id) ?? 0n);
  const invalid = categories.some((c) => amountOf(c.id) === null);
  const total = sumCentimes(amounts);
  const reserve = annualReserve(total, reserveBp);
  const perCall = (annual: bigint) => periodPart(annual, frequency, 1);
  const money = (v: bigint) => formatDZD(v, locale);

  function submit() {
    void save.run(
      {
        residenceId: residence.id,
        year: String(year),
        lines: categories.map((c) => ({ categoryId: c.id, amount: values[c.id] ?? "" })),
        notes,
      },
      {
        onSuccess: () => toast.success(t("saved")),
        onError: (error) => {
          const key = Object.values(error.fieldErrors ?? {})[0]?.[0];
          toast.error(translate(key ?? error.messageKey));
          return true;
        },
      },
    );
  }

  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noCategories")}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {budget ? (
          <Badge variant={approved ? "default" : "secondary"}>{t(`status.${budget.status}`)}</Badge>
        ) : (
          <span className="text-muted-foreground">{t("none", { year })}</span>
        )}
        {approved && budget.approvedAt ? (
          <span className="text-muted-foreground">
            {t("approvedOn", { date: formatDate(budget.approvedAt) })}
          </span>
        ) : null}
        {!budget && setup.amountsFrom !== null ? (
          <span className="text-muted-foreground">
            {t("fromYear", { year: setup.amountsFrom })}
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="budget-lines">
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.category")}</TableHead>
              <TableHead className="w-48 text-end">{t("columns.annual")}</TableHead>
              <TableHead className="text-end">{t("columns.perCall")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c, index) => (
              <TableRow key={c.id} data-category={c.name}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-end">
                  {canEdit ? (
                    <Input
                      value={values[c.id] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      inputMode="decimal"
                      dir="ltr"
                      className="ms-auto h-8 w-40 text-end"
                      aria-invalid={amountOf(c.id) === null}
                      aria-label={t("amountOf", { name: c.name })}
                    />
                  ) : (
                    <span className="tabular-nums" dir="ltr">
                      {money(amounts[index] ?? 0n)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {money(perCall(amounts[index] ?? 0n))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>{t("total")}</TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr" data-testid="budget-total">
                {money(total)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(sumCentimes(amounts.map(perCall)))}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-normal">
                {t("reserve", { rate: formatShare(reserveBp) })}
              </TableCell>
              <TableCell className="text-end font-normal tabular-nums" dir="ltr">
                {money(reserve)}
              </TableCell>
              <TableCell className="text-end font-normal tabular-nums" dir="ltr">
                {money(perCall(reserve))}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                {t("called")}
                <div className="text-xs font-normal text-muted-foreground">
                  {t("callsHint", { count: callsPerYear[frequency] })}
                </div>
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr">
                {money(total + reserve)}
              </TableCell>
              <TableCell className="text-end tabular-nums" dir="ltr" data-testid="budget-per-call">
                {money(sumCentimes(amounts.map(perCall)) + perCall(reserve))}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {canEdit ? (
        <>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            aria-label={t("notes")}
            placeholder={t("notes")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={save.pending || invalid} onClick={submit}>
              {t("save")}
            </Button>
            {budget && !dirty ? (
              <ConfirmAction
                action={approveBudgetAction}
                input={{ budgetId: budget.id }}
                label={t("approve")}
                icon={<CheckCheck data-icon="inline-start" />}
                title={t("approveTitle", { year })}
                description={t("approveDescription")}
                confirmLabel={t("approve")}
                successMessage={t("approved")}
              />
            ) : budget ? (
              <span className="text-sm text-muted-foreground">{t("saveBeforeApprove")}</span>
            ) : null}
          </div>
        </>
      ) : budget?.notes ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{budget.notes}</p>
      ) : null}
    </div>
  );
}
