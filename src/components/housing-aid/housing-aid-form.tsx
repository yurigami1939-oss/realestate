"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FieldArrayPath, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { saveHousingAidAction } from "@/server/housing-aid/actions";
import { housingAidSchema } from "@/server/housing-aid/schemas";

export type HousingAidValues = z.input<typeof housingAidSchema>;

/**
 * Logement promotionnel aidé (gérant): the SNMG, the household income ceiling and the CNL aid
 * and subsidised rate brackets, as the decrees in force set them.
 */
export function HousingAidForm({ defaultValues }: { defaultValues: HousingAidValues }) {
  const t = useTranslations("housingAid");
  const tc = useTranslations("common");
  const save = useAction(saveHousingAidAction);
  const form = useForm<HousingAidValues, unknown, z.output<typeof housingAidSchema>>({
    resolver: zodResolver(housingAidSchema),
    defaultValues,
  });
  const cnl = useFieldArray({ control: form.control, name: "cnlBrackets" });
  const rates = useFieldArray({ control: form.control, name: "rateBrackets" });

  const rows = (
    array: typeof cnl | typeof rates,
    name: FieldArrayPath<HousingAidValues>,
    value: "amount" | "rate",
  ) => (
    <ol className="space-y-2" data-testid={name}>
      {array.fields.map((row, index) => (
        <li key={row.id} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <TextField
            control={form.control}
            name={`${name}.${index}.maxMultiple` as "cnlBrackets.0.maxMultiple"}
            label={t("maxMultiple", { index: index + 1 })}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name={`${name}.${index}.${value}` as "cnlBrackets.0.amount"}
            label={t(value === "amount" ? "aidAmount" : "rate", { index: index + 1 })}
            inputMode="decimal"
            dir="ltr"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tc("delete")}
            onClick={() => array.remove(index)}
          >
            <X />
          </Button>
        </li>
      ))}
    </ol>
  );

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
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={form.control}
            name="snmg"
            label={t("snmg")}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            control={form.control}
            name="lpaMaxMultiple"
            label={t("lpaMaxMultiple")}
            inputMode="decimal"
            dir="ltr"
          />
        </div>
        <FieldSeparator>{t("cnlBrackets")}</FieldSeparator>
        {rows(cnl, "cnlBrackets", "amount")}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cnl.append({ maxMultiple: "", amount: "" })}
          >
            <Plus data-icon="inline-start" />
            {t("addBracket")}
          </Button>
        </div>
        <FieldSeparator>{t("rateBrackets")}</FieldSeparator>
        {rows(rates, "rateBrackets", "rate")}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rates.append({ maxMultiple: "", rate: "" })}
          >
            <Plus data-icon="inline-start" />
            {t("addBracket")}
          </Button>
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
