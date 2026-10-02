"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxGroupField, SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { financingModes, leadSources } from "@/lib/crm";
import { typologies } from "@/lib/inventory";
import type { AppErrorShape } from "@/lib/result";
import { createLeadAction, updateLeadAction } from "@/server/crm/actions";
import { createLeadSchema } from "@/server/crm/schemas";

export type LeadFormValues = z.input<typeof createLeadSchema>;

export const emptyLead: LeadFormValues = {
  fullName: "",
  phone: "",
  phone2: "",
  email: "",
  city: "",
  source: "walk_in",
  sourceDetail: "",
  projectId: "",
  typologies: [],
  budget: "",
  financing: "",
  notes: "",
  assignedTo: "",
};

type Option = { id: string; name: string };

/** Create (no `leadId`) or edit a lead. Managers choose the commercial on creation. */
export function LeadForm({
  leadId,
  defaultValues = emptyLead,
  projects,
  owners,
}: {
  leadId?: string;
  defaultValues?: LeadFormValues;
  projects: Option[];
  /** Assignable members (managers creating a lead); null hides the field. */
  owners: Option[] | null;
}) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useAction(createLeadAction);
  const update = useAction(updateLeadAction);
  const form = useForm<LeadFormValues, unknown, z.output<typeof createLeadSchema>>({
    resolver: zodResolver(createLeadSchema),
    defaultValues,
  });
  const f = (key: keyof LeadFormValues) => t(`leads.fields.${key}`);

  async function onSubmit(values: LeadFormValues) {
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    const done = (id: string, duplicates: number, message: string) => {
      toast.success(duplicates > 0 ? t("leads.createdDuplicate", { count: duplicates }) : message);
      router.push(`/leads/${id}`);
    };
    if (leadId) {
      const { assignedTo: _ignored, ...fields } = values;
      await update.run(
        { ...fields, leadId },
        { onSuccess: ({ duplicates }) => done(leadId, duplicates, tc("saved")), onError },
      );
    } else {
      await create.run(values, {
        onSuccess: ({ id, duplicates }) => done(id, duplicates, t("leads.created")),
        onError,
      });
    }
  }

  return (
    <Card>
      <CardContent>
        <form
          id="lead-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="fullName" label={f("fullName")} />
              <TextField control={form.control} name="city" label={f("city")} autoComplete="off" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField
                control={form.control}
                name="phone"
                label={f("phone")}
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="0550 12 34 56"
              />
              <TextField
                control={form.control}
                name="phone2"
                label={f("phone2")}
                type="tel"
                inputMode="tel"
                dir="ltr"
              />
              <TextField
                control={form.control}
                name="email"
                label={f("email")}
                type="email"
                dir="ltr"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="source"
                label={f("source")}
                options={leadSources.map((s) => ({ value: s, label: t(`source.${s}`) }))}
              />
              <TextField control={form.control} name="sourceDetail" label={f("sourceDetail")} />
            </div>
            {owners ? (
              <SelectField
                control={form.control}
                name="assignedTo"
                label={f("assignedTo")}
                emptyLabel={t("leads.unassigned")}
                options={owners.map((o) => ({ value: o.id, label: o.name }))}
              />
            ) : null}

            <FieldSeparator>{t("leads.sections.interest")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                control={form.control}
                name="projectId"
                label={f("projectId")}
                emptyLabel="—"
                options={projects.map((p) => ({ value: p.id, label: p.name }))}
              />
              <TextField
                control={form.control}
                name="budget"
                label={f("budget")}
                inputMode="decimal"
                dir="ltr"
              />
              <SelectField
                control={form.control}
                name="financing"
                label={f("financing")}
                emptyLabel="—"
                options={financingModes.map((m) => ({ value: m, label: t(`financing.${m}`) }))}
              />
            </div>
            <CheckboxGroupField
              control={form.control}
              name="typologies"
              label={f("typologies")}
              columns={4}
              options={typologies.map((v) => ({ value: v, label: v }))}
            />
            <TextareaField control={form.control} name="notes" label={f("notes")} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.pending || update.pending}>
                {leadId ? tc("save") : tc("create")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                {tc("cancel")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
