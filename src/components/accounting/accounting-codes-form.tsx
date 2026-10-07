"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { type AccountingCodes, accountingKeys, defaultAccountingCodes } from "@/lib/accounting";
import { saveAccountingCodesAction } from "@/server/accounting/actions";
import { accountingCodesSchema } from "@/server/accounting/schemas";

type Values = z.input<typeof accountingCodesSchema>;

/** The chart's codes by flow nature, and each treasury account's own code and journal. */
export function AccountingCodesForm({
  codes,
  accounts,
}: {
  codes: AccountingCodes;
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
  const form = useForm<Values, unknown, z.output<typeof accountingCodesSchema>>({
    resolver: zodResolver(accountingCodesSchema),
    defaultValues: {
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
