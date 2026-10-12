"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, CheckboxGroupField } from "@/components/forms/fields";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { modules } from "@/lib/modules";
import { type AddonCode, addonCodes } from "@/lib/subscriptions";
import { moneyText } from "@/lib/zod";
import { archivePlanAction, createPlanAction, repriceAddonAction } from "@/server/console/actions";
import { planSchema } from "@/server/console/schemas";

/** A new plan of the catalog (a plan in use never changes: a new one replaces it). */
export function CreatePlanDialog() {
  const t = useTranslations();
  const p = (key: string) => t(`console.plans.${key}` as Parameters<typeof t>[0]);
  const [open, setOpen] = useState(false);
  const create = useAction(createPlanAction);
  const form = useForm<z.input<typeof planSchema>, unknown, z.output<typeof planSchema>>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      code: "",
      nameFr: "",
      nameAr: "",
      yearlyPrice: "",
      quarterlyPrice: "",
      setupFee: "0",
      modules: ["imports"],
      activeUnits: "",
      organizations: "",
      storageGb: "",
      onQuote: false,
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button>
          <Plus data-icon="inline-start" />
          {p("create")}
        </Button>
      }
      title={p("createTitle")}
      description={p("description")}
      submitLabel={p("create")}
      pending={create.pending}
      className="sm:max-w-2xl"
      onSubmit={form.handleSubmit(() =>
        create.run(form.getValues(), {
          onSuccess: () => {
            toast.success(p("created"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField control={form.control} name="code" label={p("code")} dir="ltr" />
        <TextField control={form.control} name="nameFr" label={p("nameFr")} />
        <TextField control={form.control} name="nameAr" label={p("nameAr")} dir="rtl" />
        <TextField
          control={form.control}
          name="yearlyPrice"
          label={p("yearlyPrice")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="quarterlyPrice"
          label={p("quarterlyPrice")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="setupFee"
          label={p("setupFee")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="activeUnits"
          label={p("activeUnits")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="organizations"
          label={p("organizations")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="storageGb"
          label={p("storageGb")}
          inputMode="numeric"
          dir="ltr"
        />
      </div>
      <CheckboxGroupField
        control={form.control}
        name="modules"
        label={p("modules")}
        options={modules.map((m) => ({ value: m, label: t(`modules.${m}.name`) }))}
      />
      <CheckboxField control={form.control} name="onQuote" label={p("onQuote")} />
    </FormDialog>
  );
}

/** Archives a plan: those on it keep it, no new account takes it. */
export function ArchivePlanButton({ planId, name }: { planId: string; name: string }) {
  const t = useTranslations("console.plans");
  return (
    <ConfirmAction
      action={archivePlanAction}
      input={{ planId }}
      label={t("archive")}
      title={t("archive")}
      description={t("archiveConfirm", { name })}
      confirmLabel={t("archive")}
      successMessage={t("archiveDone")}
      variant="ghost"
    />
  );
}

const repriceSchema = z.object({ yearlyPrice: moneyText(), quarterlyPrice: moneyText() });

/** A new price for an add-on: accounts keep the price they took. */
export function RepriceAddonDialog({
  code,
  name,
  yearly,
  quarterly,
}: {
  code: AddonCode;
  name: string;
  yearly: string;
  quarterly: string;
}) {
  const t = useTranslations("console.plans");
  const [open, setOpen] = useState(false);
  const reprice = useAction(repriceAddonAction);
  const form = useForm<z.input<typeof repriceSchema>, unknown, z.output<typeof repriceSchema>>({
    resolver: zodResolver(repriceSchema),
    defaultValues: { yearlyPrice: yearly, quarterlyPrice: quarterly },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          disabled={!(addonCodes as readonly string[]).includes(code)}
        >
          {t("reprice")}
        </Button>
      }
      title={`${t("repriceTitle")} · ${name}`}
      description={t("repriceDescription")}
      submitLabel={t("reprice")}
      pending={reprice.pending}
      onSubmit={form.handleSubmit(() =>
        reprice.run(
          { code, ...form.getValues() },
          {
            onSuccess: () => {
              toast.success(t("repriced"));
              setOpen(false);
            },
            onError: (error) => applyFieldErrors(form, error),
          },
        ),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="yearlyPrice"
          label={t("yearlyPrice")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="quarterlyPrice"
          label={t("quarterlyPrice")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
    </FormDialog>
  );
}
