"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { WILAYA_OPTIONS, WilayaOptions } from "@/components/forms/wilaya-options";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldDescription, FieldGroup, FieldSeparator } from "@/components/ui/field";
import { updateCompanySettingsAction } from "@/server/organizations/actions";
import { companySettingsSchema } from "@/server/organizations/schemas";

export type CompanyFormValues = z.input<typeof companySettingsSchema>;

export function CompanyForm({ defaultValues }: { defaultValues: CompanyFormValues }) {
  const t = useTranslations("company");
  const tc = useTranslations("common");
  const save = useAction(updateCompanySettingsAction);
  const form = useForm<CompanyFormValues, unknown, z.output<typeof companySettingsSchema>>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues,
  });
  const f = (key: keyof CompanyFormValues) => t(`fields.${key}`);
  const text = (name: keyof CompanyFormValues, ltr = false) => (
    <TextField control={form.control} name={name} label={f(name)} dir={ltr ? "ltr" : undefined} />
  );
  const number = (name: keyof CompanyFormValues) => (
    <TextField control={form.control} name={name} label={f(name)} inputMode="decimal" dir="ltr" />
  );

  return (
    <Card>
      <CardContent>
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
            <FieldSeparator>{t("identity")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-2">
              {text("name")}
              {text("legalName")}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">{text("address")}</div>
              <TextField
                control={form.control}
                name="wilaya"
                label={f("wilaya")}
                list={WILAYA_OPTIONS}
              />
              <WilayaOptions />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {text("phone", true)}
              {text("rcNumber", true)}
              {text("nif", true)}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {text("nis", true)}
              {text("aiNumber", true)}
            </div>

            <FieldSeparator>{t("sales")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-3">
              {number("quotationValidityDays")}
              {number("optionHours")}
              {number("withdrawalRetention")}
            </div>

            <FieldSeparator>{t("collections")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-2">
              {number("paymentCallDelayDays")}
              {number("defaultCommissionRate")}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {number("penaltyMonthlyRate")}
              {number("penaltyGraceDays")}
              {number("penaltyCap")}
            </div>
            <FieldDescription>{t("penaltyHint")}</FieldDescription>

            <FieldSeparator>{t("obligations")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-3">
              {number("deliveryPenaltyMonthlyRate")}
              {number("deliveryPenaltyCap")}
              {text("fgcmpiNumber", true)}
            </div>
            <FieldDescription>{t("obligationsHint")}</FieldDescription>

            <FieldSeparator>{t("termination")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-3">
              {number("formalNoticesRequired")}
              {number("formalNoticeDays")}
              {number("terminationRetention")}
            </div>
            <FieldDescription>{t("terminationHint")}</FieldDescription>

            <FieldSeparator>{t("clients")}</FieldSeparator>
            <CheckboxField
              control={form.control}
              name="emailDocuments"
              label={f("emailDocuments")}
            />
            <FieldDescription>{t("clientsHint")}</FieldDescription>

            <FieldSeparator>{t("vspLimits")}</FieldSeparator>
            <FieldDescription>{t("vspLimitsHint")}</FieldDescription>
            <div className="grid gap-4 sm:grid-cols-4">
              {number("vspLimitSigning")}
              {number("vspLimitFoundations")}
              {number("vspLimitStructure")}
              {number("vspLimitCompletion")}
            </div>
            <div>
              <Button type="submit" disabled={save.pending}>
                {tc("save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
