"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileSignature } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { formatDZD, parseDZD } from "@/lib/money";
import {
  buildRentPeriods,
  leaseEndOn,
  leaseKinds,
  MAX_LEASE_MONTHS,
  rentFrequencies,
} from "@/lib/rentals";
import { createLeaseAction, updateLeaseAction } from "@/server/rentals/actions";
import type { LeasableUnit } from "@/server/rentals/queries";
import { createLeaseSchema } from "@/server/rentals/schemas";

type Values = z.input<typeof createLeaseSchema>;

/** End of the term and rent periods, previewed from the typed terms (null while incomplete). */
function usePreview(values: Partial<Values>) {
  const months = Number(values.durationMonths);
  const rent = parseDZD(values.monthlyRent ?? "");
  const charges = values.monthlyCharges ? parseDZD(values.monthlyCharges) : 0n;
  const start = values.startOn ?? "";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > MAX_LEASE_MONTHS ||
    rent === null ||
    rent <= 0n ||
    charges === null ||
    !values.frequency
  ) {
    return null;
  }
  const periods = buildRentPeriods({
    startOn: start,
    durationMonths: months,
    frequency: values.frequency,
    monthlyRent: rent,
    monthlyCharges: charges,
  });
  return { endOn: leaseEndOn(start, months), periods };
}

/**
 * Lease form: the unit (new leases), the tenant and the terms; the term's last day and the rent
 * periods are previewed as the terms change. Editing an existing lease keeps its unit.
 */
export function LeaseForm({
  units,
  today,
  unitId = "",
  lease,
}: {
  units: LeasableUnit[];
  today: string;
  /** Unit preselected (new lease from a unit's sheet). */
  unitId?: string;
  /** The lease being edited, as form values (its unit cannot change). */
  lease?: { id: string } & Values;
}) {
  const t = useTranslations("rentals");
  const tc = useTranslations("common");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const router = useRouter();
  const create = useAction(createLeaseAction);
  const update = useAction(updateLeaseAction);
  const form = useForm<Values, unknown, z.output<typeof createLeaseSchema>>({
    resolver: zodResolver(createLeaseSchema),
    defaultValues: lease ?? {
      unitId,
      kind: "residential",
      tenantName: "",
      tenantNameAr: "",
      tenantIdNumber: "",
      tenantPhone: "",
      tenantWhatsappOptIn: false,
      tenantEmail: "",
      tenantAddress: "",
      activity: "",
      signedOn: today,
      startOn: today,
      durationMonths: "12",
      monthlyRent: "",
      monthlyCharges: "",
      frequency: "monthly",
      deposit: "",
      notes: "",
    },
  });
  const watched = useWatch({ control: form.control });
  const preview = usePreview(watched);
  const money = (v: bigint) => formatDZD(v, locale);

  function submit() {
    const values = form.getValues();
    if (lease) {
      const { unitId: _u, ...fields } = values;
      return update.run(
        { ...fields, leaseId: lease.id },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            router.push(`/rentals/${lease.id}`);
          },
          onError: (error) => applyFieldErrors(form, error),
        },
      );
    }
    return create.run(values, {
      onSuccess: ({ id, number }) => {
        toast.success(t("created", { number }));
        router.push(`/rentals/${id}`);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <form onSubmit={form.handleSubmit(submit)} noValidate className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("form.unitAndTenant")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {lease ? null : (
                <SelectField
                  control={form.control}
                  name="unitId"
                  label={t("fields.unit")}
                  emptyLabel={t("form.chooseUnit")}
                  options={units.map((u) => ({
                    value: u.id,
                    label: `${u.code} · ${u.projectName}${u.status === "blocked" ? ` · ${t("form.kept")}` : ""}`,
                  }))}
                />
              )}
              <SelectField
                control={form.control}
                name="kind"
                label={t("fields.kind")}
                options={leaseKinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="tenantName"
                  label={t("fields.tenantName")}
                />
                <TextField
                  control={form.control}
                  name="tenantNameAr"
                  label={t("fields.tenantNameAr")}
                  dir="rtl"
                />
                <TextField
                  control={form.control}
                  name="tenantIdNumber"
                  label={t("fields.tenantIdNumber")}
                  dir="ltr"
                />
                <TextField
                  control={form.control}
                  name="tenantPhone"
                  label={t("fields.tenantPhone")}
                  type="tel"
                  dir="ltr"
                />
                <TextField
                  control={form.control}
                  name="tenantEmail"
                  label={t("fields.tenantEmail")}
                  type="email"
                  dir="ltr"
                />
                <TextField control={form.control} name="activity" label={t("fields.activity")} />
              </div>
              <TextField
                control={form.control}
                name="tenantAddress"
                label={t("fields.tenantAddress")}
              />
              <CheckboxField
                control={form.control}
                name="tenantWhatsappOptIn"
                label={t("fields.tenantWhatsappOptIn")}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("form.terms")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  control={form.control}
                  name="signedOn"
                  label={t("fields.signedOn")}
                  type="date"
                  dir="ltr"
                  max={today}
                />
                <TextField
                  control={form.control}
                  name="startOn"
                  label={t("fields.startOn")}
                  type="date"
                  dir="ltr"
                />
                <TextField
                  control={form.control}
                  name="durationMonths"
                  label={t("fields.durationMonths")}
                  inputMode="numeric"
                  dir="ltr"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="monthlyRent"
                  label={t("fields.monthlyRent")}
                  inputMode="decimal"
                  dir="ltr"
                />
                <TextField
                  control={form.control}
                  name="monthlyCharges"
                  label={t("fields.monthlyCharges")}
                  description={t("fields.monthlyChargesHint")}
                  inputMode="decimal"
                  dir="ltr"
                />
                <SelectField
                  control={form.control}
                  name="frequency"
                  label={t("fields.frequency")}
                  options={rentFrequencies.map((f) => ({ value: f, label: t(`frequency.${f}`) }))}
                />
                <TextField
                  control={form.control}
                  name="deposit"
                  label={t("fields.deposit")}
                  inputMode="decimal"
                  dir="ltr"
                />
              </div>
              <TextareaField control={form.control} name="notes" label={t("fields.notes")} />
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("form.preview")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="lease-preview">
            {preview ? (
              <>
                <p>
                  {t("form.term", {
                    from: formatDate(watched.startOn ?? today),
                    to: formatDate(preview.endOn),
                  })}
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  {preview.periods.slice(0, 4).map((p) => (
                    <li key={p.position} className="flex justify-between gap-2">
                      <span>{formatDate(p.dueOn)}</span>
                      <bdi dir="ltr" className="tabular-nums">
                        {money(p.amount)}
                      </bdi>
                    </li>
                  ))}
                </ul>
                {preview.periods.length > 4 ? (
                  <p className="text-muted-foreground">
                    {t("form.morePeriods", { count: preview.periods.length - 4 })}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">{t("form.previewHint")}</p>
            )}
          </CardContent>
        </Card>
        <Button type="submit" className="w-full" disabled={create.pending || update.pending}>
          <FileSignature data-icon="inline-start" />
          {lease ? tc("save") : t("form.submit")}
        </Button>
      </div>
    </form>
  );
}
