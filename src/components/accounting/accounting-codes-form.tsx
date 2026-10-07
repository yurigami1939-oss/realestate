"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import {
  type AccountingCodes,
  accountingKeys,
  defaultAccountingCodes,
  revenueEvents,
  type TaxSettings,
} from "@/lib/accounting";
import { formatPercentInput } from "@/lib/money";
import { saveAccountingCodesAction } from "@/server/accounting/actions";
import { accountingCodesSchema } from "@/server/accounting/schemas";

type Values = z.input<typeof accountingCodesSchema>;

/**
 * The chart's codes by flow nature, the tax settings of the revenue entries, and each treasury
 * account's own code and journal.
 */
export function AccountingCodesForm({
  codes,
  tax,
  accounts,
}: {
  codes: AccountingCodes;
  tax: TaxSettings;
  accounts: {
    id: string;
    name: string;
    accountingCode: string | null;
    journalCode: string | null;
    code: string;
    journal: string;
  }[];
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const save = useAction(saveAccountingCodesAction);
  const percent = (bp: number) => (bp === 0 ? "" : formatPercentInput(bp));
  const form = useForm<Values, unknown, z.output<typeof accountingCodesSchema>>({
    resolver: zodResolver(accountingCodesSchema),
    defaultValues: {
      tax: {
        revenueEvent: tax.revenueEvent,
        vatSales: percent(tax.vatSalesBp),
        vatRentCommercial: percent(tax.vatRentCommercialBp),
        vatRentResidential: percent(tax.vatRentResidentialBp),
        stampDuty: percent(tax.stampDutyBp),
      },
      codes: Object.fromEntries(
        accountingKeys.map((key) => [
          key,
          codes[key] === defaultAccountingCodes[key] ? "" : codes[key],
        ]),
      ) as Values["codes"],
      accounts: accounts.map((a) => ({
        accountId: a.id,
        code: a.accountingCode ?? "",
        journal: a.journalCode ?? "",
      })),
    },
  });
  return (
    <form
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => toast.success(t("saved")),
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
      noValidate
    >
      <FieldGroup>
        <FieldSeparator>{t("counterparts")}</FieldSeparator>
        <div className="grid gap-4 sm:grid-cols-3">
          {accountingKeys.map((key) => (
            <TextField
              key={key}
              control={form.control}
              name={`codes.${key}`}
              label={t(`key.${key}`)}
              placeholder={defaultAccountingCodes[key]}
              dir="ltr"
            />
          ))}
        </div>
        <FieldSeparator>{t("tax.title")}</FieldSeparator>
        <p className="text-sm text-muted-foreground">{t("tax.help")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            control={form.control}
            name="tax.revenueEvent"
            label={t("tax.revenueEvent")}
            options={revenueEvents.map((e) => ({ value: e, label: t(`tax.event.${e}`) }))}
          />
          {(["vatSales", "vatRentCommercial", "vatRentResidential", "stampDuty"] as const).map(
            (key) => (
              <TextField
                key={key}
                control={form.control}
                name={`tax.${key}`}
                label={t(`tax.${key}`)}
                placeholder="0"
                inputMode="decimal"
                dir="ltr"
              />
            ),
          )}
        </div>
        <FieldSeparator>{t("accounts")}</FieldSeparator>
        {accounts.map((a, index) => (
          <div key={a.id} className="grid items-end gap-4 sm:grid-cols-3">
            <p className="text-sm font-medium sm:pb-2">{a.name}</p>
            <TextField
              control={form.control}
              name={`accounts.${index}.code`}
              label={t("accountCode")}
              placeholder={a.code}
              dir="ltr"
            />
            <TextField
              control={form.control}
              name={`accounts.${index}.journal`}
              label={t("journalCode")}
              placeholder={a.journal}
              dir="ltr"
            />
          </div>
        ))}
        <div>
          <Button type="submit" disabled={save.pending}>
            {tc("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
