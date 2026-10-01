"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import { type ConstructionStage, constructionStages } from "@/lib/sales";
import { saveMilestonesAction } from "@/server/payment-plans/actions";
import { saveMilestonesSchema } from "@/server/payment-plans/schemas";

type Values = z.input<typeof saveMilestonesSchema>;

/** Radix Select reserves "" — this sentinel stands for "not classified". */
const NONE = "__none__";

export type EditableMilestone = {
  id: string;
  name: string;
  stage: ConstructionStage | null;
  plannedOn: string | null;
  validatedOn: string | null;
};

export function MilestonesEditor({
  projectId,
  milestones,
  editable,
}: {
  projectId: string;
  milestones: EditableMilestone[];
  editable: boolean;
}) {
  const t = useTranslations("paymentPlans");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const save = useAction(saveMilestonesAction);
  const form = useForm<Values, unknown, z.output<typeof saveMilestonesSchema>>({
    resolver: zodResolver(saveMilestonesSchema),
    defaultValues: {
      projectId,
      milestones: milestones.map((m) => ({
        id: m.id,
        name: m.name,
        stage: m.stage ?? "",
        plannedOn: m.plannedOn ?? "",
      })),
    },
  });
  const rows = useFieldArray({ control: form.control, name: "milestones" });
  const current = useWatch({ control: form.control, name: "milestones" });
  const validatedOn = (id: string) => milestones.find((m) => m.id === id)?.validatedOn ?? null;

  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => toast.success(t("milestonesSaved")),
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
      noValidate
    >
      {rows.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noMilestones")}</p>
      ) : (
        <ol className="space-y-2" data-testid="milestones">
          {rows.fields.map((row, index) => {
            // `row.id` is react-hook-form's key; the milestone's own id is in the values.
            const savedId = current[index]?.id ?? "";
            const done = savedId ? validatedOn(savedId) : null;
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-2">
                <span className="w-6 pt-2 text-sm text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <Controller
                  control={form.control}
                  name={`milestones.${index}.name`}
                  render={({ field, fieldState }) => (
                    <div className="min-w-48 flex-1 space-y-1">
                      <Input
                        {...field}
                        aria-label={`${t("milestoneName")} ${index + 1}`}
                        aria-invalid={fieldState.invalid}
                        disabled={!editable}
                      />
                      {fieldState.error?.message ? (
                        <p className="text-xs text-destructive">
                          {translate(fieldState.error.message)}
                        </p>
                      ) : null}
                    </div>
                  )}
                />
                <Controller
                  control={form.control}
                  name={`milestones.${index}.stage`}
                  render={({ field }) => (
                    <Select
                      value={field.value ? field.value : NONE}
                      onValueChange={(value) => field.onChange(value === NONE ? "" : value)}
                      disabled={!editable}
                    >
                      <SelectTrigger
                        className="w-44"
                        aria-label={`${t("stage")} ${index + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("stages.none")}</SelectItem>
                        {constructionStages.map((stage) => (
                          <SelectItem key={stage} value={stage}>
                            {t(`stages.${stage}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <Controller
                  control={form.control}
                  name={`milestones.${index}.plannedOn`}
                  render={({ field }) => (
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="date"
                      dir="ltr"
                      className="w-40"
                      aria-label={`${t("plannedOn")} ${index + 1}`}
                      disabled={!editable}
                    />
                  )}
                />
                {done ? (
                  <Badge variant="secondary" className="mt-1.5" data-testid="milestone-validated">
                    {t("validatedOn", { date: formatDate(done) })}
                  </Badge>
                ) : null}
                {editable && !done ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => rows.remove(index)}
                    aria-label={tc("delete")}
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rows.append({ id: "", name: "", stage: "", plannedOn: "" })}
          >
            <Plus data-icon="inline-start" />
            {t("addMilestone")}
          </Button>
          <Button type="submit" size="sm" disabled={save.pending}>
            {t("saveMilestones")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
