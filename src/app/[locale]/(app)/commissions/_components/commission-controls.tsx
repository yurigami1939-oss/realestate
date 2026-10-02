"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { HandCoins } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatShare } from "@/lib/payment-plans";
import { commissionStatuses } from "@/lib/sales";
import { payCommissionAction, saveCommissionRatesAction } from "@/server/commissions/actions";
import type { CommissionRates } from "@/server/commissions/queries";
import { payCommissionSchema } from "@/server/commissions/schemas";

const ALL = "__all__";

/** Status and (for managers) commercial filters, kept in the URL. */
export function CommissionFilters({
  earners,
}: {
  earners: { userId: string; name: string }[] | null;
}) {
  const t = useTranslations("commissions");
  const ts = useTranslations("sales.commission.status");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.get("status") || ALL}
        onValueChange={(value) => params.set({ status: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("columns.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
          {commissionStatuses.map((status) => (
            <SelectItem key={status} value={status}>
              {ts(status)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {earners ? (
        <Select
          value={params.get("userId") || ALL}
          onValueChange={(value) => params.set({ userId: value === ALL ? null : value })}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label={t("columns.commercial")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allCommercials")}</SelectItem>
            {earners.map((e) => (
              <SelectItem key={e.userId} value={e.userId}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

type PayValues = z.input<typeof payCommissionSchema>;

/** Accountant: an earned commission was paid to the commercial. */
export function PayCommissionDialog({
  commissionId,
  label,
  today,
}: {
  commissionId: string;
  label: string;
  today: string;
}) {
  const t = useTranslations("commissions");
  const [open, setOpen] = useState(false);
  const pay = useAction(payCommissionAction);
  const form = useForm<PayValues, unknown, z.output<typeof payCommissionSchema>>({
    resolver: zodResolver(payCommissionSchema),
    defaultValues: { commissionId, paidOn: today },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <HandCoins data-icon="inline-start" />
          {t("pay")}
        </Button>
      }
      title={t("payTitle")}
      description={label}
      submitLabel={t("pay")}
      pending={pay.pending}
      onSubmit={form.handleSubmit(() =>
        pay.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("paid"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="paidOn"
        label={t("paidOn")}
        type="date"
        dir="ltr"
        max={today}
      />
    </FormDialog>
  );
}

/** Gérant: rate per commercial; empty = the company default. */
export function CommissionRatesEditor({ rates }: { rates: CommissionRates }) {
  const t = useTranslations("commissions.rates");
  const translate = useTranslateKey();
  const save = useAction(saveCommissionRatesAction);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rates.rows.map((r) => [
        r.userId,
        r.rateBp === null ? "" : formatShare(r.rateBp).slice(0, -2),
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const defaultLabel = formatShare(rates.defaultRateBp);

  return (
    <div className="space-y-3">
      <Table data-testid="commission-rates">
        <TableHeader>
          <TableRow>
            <TableHead>{t("commercial")}</TableHead>
            <TableHead className="w-40">{t("rate")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.rows.map((r, index) => (
            <TableRow key={r.userId}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>
                <Input
                  value={values[r.userId] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [r.userId]: e.target.value }))}
                  placeholder={defaultLabel}
                  aria-label={`${t("rate")} · ${r.name}`}
                  aria-invalid={errors[`rates.${index}.rate`] !== undefined}
                  inputMode="decimal"
                  dir="ltr"
                  className="h-8 w-28"
                />
                {errors[`rates.${index}.rate`] ? (
                  <p className="text-xs text-destructive">
                    {translate(errors[`rates.${index}.rate`] ?? "")}
                  </p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">{t("hint", { rate: defaultLabel })}</p>
      <Button
        disabled={save.pending}
        onClick={() =>
          void save.run(
            { rates: rates.rows.map((r) => ({ userId: r.userId, rate: values[r.userId] ?? "" })) },
            {
              onSuccess: () => {
                setErrors({});
                toast.success(t("saved"));
              },
              onError: (error) => {
                const fieldErrors = Object.fromEntries(
                  Object.entries(error.fieldErrors ?? {}).map(([key, messages]) => [
                    key,
                    messages[0] ?? "",
                  ]),
                );
                setErrors(fieldErrors);
                return Object.keys(fieldErrors).length > 0;
              },
            },
          )
        }
      >
        {t("save")}
      </Button>
    </div>
  );
}
