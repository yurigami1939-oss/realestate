"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { ticketCategories, ticketPriorities } from "@/lib/tickets";
import { createPortalTicketAction } from "@/server/portal/portal-actions";
import type { PortalTicketTarget } from "@/server/portal/residences";
import { portalTicketSchema } from "@/server/portal/schemas";

type Values = z.input<typeof portalTicketSchema>;

/** A resident reports a problem on one of its units or the common areas. */
export function PortalTicketDialog({ targets }: { targets: PortalTicketTarget[] }) {
  const t = useTranslations("portal.tickets");
  const tt = useTranslations("tickets");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createPortalTicketAction);
  const form = useForm<Values, unknown, z.output<typeof portalTicketSchema>>({
    resolver: zodResolver(portalTicketSchema),
    defaultValues: {
      residenceId: targets[0]?.id ?? "",
      unitId: targets[0]?.units[0]?.unitId ?? "",
      title: "",
      description: "",
      category: "other",
      priority: "normal",
    },
  });
  const chosen = useWatch({ control: form.control, name: "residenceId" });
  const units = targets.find((r) => r.id === chosen)?.units ?? [];
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Plus data-icon="inline-start" />
          {t("new")}
        </Button>
      }
      title={t("newTitle")}
      description={t("newDescription")}
      submitLabel={t("send")}
      pending={create.pending}
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: ({ id }) => {
            toast.success(t("sent"));
            setOpen(false);
            router.push(`/portal/tickets/${id}`);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      {targets.length > 1 ? (
        <SelectField
          control={form.control}
          name="residenceId"
          label={tt("fields.residenceId")}
          options={targets.map((r) => ({ value: r.id, label: r.name }))}
        />
      ) : null}
      <SelectField
        key={chosen}
        control={form.control}
        name="unitId"
        label={t("place")}
        emptyLabel={tt("commonAreas")}
        options={units.map((u) => ({ value: u.unitId, label: tt("unit", { code: u.code }) }))}
      />
      <TextField control={form.control} name="title" label={tt("fields.title")} />
      <TextareaField
        control={form.control}
        name="description"
        label={tt("fields.description")}
        rows={4}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={form.control}
          name="category"
          label={tt("fields.category")}
          options={ticketCategories.map((c) => ({ value: c, label: tt(`category.${c}`) }))}
        />
        <SelectField
          control={form.control}
          name="priority"
          label={tt("fields.priority")}
          options={ticketPriorities.map((p) => ({ value: p, label: tt(`priority.${p}`) }))}
        />
      </div>
    </FormDialog>
  );
}
