"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { saveAcquisitionCostsAction } from "@/server/organizations/actions";
import { acquisitionCostsSchema } from "@/server/organizations/schemas";

export type AcquisitionCostsValues = z.input<typeof acquisitionCostsSchema>;

/**
 * The figures quotations estimate a buyer's acquisition costs with (gérant): the notary's scale
 * by tranches, the VAT on the fees, the registration duty, the land registry publication and
 * fixed costs — set with the organization's notary; nothing set = nothing printed.
 */
export function AcquisitionCostsForm({ defaultValues }: { defaultValues: AcquisitionCostsValues }) {
  const t = useTranslations("acquisitionCosts");
  const tc = useTranslations("common");
  const save = useAction(saveAcquisitionCostsAction);
  const form = useForm<AcquisitionCostsValues, unknown, z.output<typeof acquisitionCostsSchema>>({
    resolver: zodResolver(acquisitionCostsSchema),
    defaultValues,
  });
  const tranches = useFieldArray({ control: form.control, name: "tranches" });

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
        <p className="text-sm text-muted-foreground">{t("help")}</p>
        <FieldSeparator>{t("notaryScale")}</FieldSeparator>
        <ol className="space-y-2" data-testid="notary-tranches">
          {tranches.fields.map((row, index) => (
            <li key={row.id} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <TextField
                control={form.control}
                name={`tranches.${index}.upTo`}
                label={t("upTo", { index: index + 1 })}
                placeholder={t("above")}
                inputMode="decimal"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name={`tranches.${index}.rate`}
                label={t("rate", { index: index + 1 })}
                inputMode="decimal"
                dir="ltr"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tc("delete")}
                onClick={() => tranches.remove(index)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ol>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => tranches.append({ upTo: "", rate: "" })}
          >
            <Plus data-icon="inline-start" />
            {t("addTranche")}
          </Button>
        </div>
        <FieldSeparator>{t("duties")}</FieldSeparator>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="notaryVat"
            label={t("notaryVat")}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="registration"
            label={t("registration")}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="publication"
            label={t("publication")}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="fixedFees"
            label={t("fixedFees")}
            inputMode="decimal"
            dir="ltr"
          />
        </div>
        <div>
          <Button type="submit" disabled={save.pending}>
            {tc("save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
