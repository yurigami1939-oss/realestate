"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import type { AppErrorShape } from "@/lib/result";
import { civilities, maritalStatuses } from "@/lib/sales";
import { createBuyerAction, updateBuyerAction } from "@/server/buyers/actions";
import { createBuyerSchema } from "@/server/buyers/schemas";

export type BuyerFormValues = z.input<typeof createBuyerSchema>;

export const emptyBuyer: BuyerFormValues = {
  civility: "",
  lastName: "",
  firstName: "",
  lastNameAr: "",
  firstNameAr: "",
  birthDate: "",
  birthPlace: "",
  fatherFirstName: "",
  motherFullName: "",
  nin: "",
  idCardNumber: "",
  idCardIssuedOn: "",
  idCardIssuedBy: "",
  phone: "",
  phone2: "",
  email: "",
  address: "",
  commune: "",
  wilaya: "",
  profession: "",
  employer: "",
  maritalStatus: "",
  notes: "",
  leadId: "",
};

/** Create (no `buyerId`, optionally from a lead) or edit a buyer file. */
export function BuyerForm({
  buyerId,
  defaultValues,
}: {
  buyerId?: string;
  defaultValues: BuyerFormValues;
}) {
  const t = useTranslations("buyers");
  const tc = useTranslations("common");
  const router = useRouter();
  const create = useAction(createBuyerAction);
  const update = useAction(updateBuyerAction);
  const form = useForm<BuyerFormValues, unknown, z.output<typeof createBuyerSchema>>({
    resolver: zodResolver(createBuyerSchema),
    defaultValues,
  });
  type Name = Exclude<keyof BuyerFormValues, "leadId">;
  type InputExtras = Pick<React.ComponentProps<"input">, "dir" | "lang" | "type" | "inputMode">;
  const field = (name: Name, extra: InputExtras = {}) => (
    <TextField control={form.control} name={name} label={t(`fields.${name}`)} {...extra} />
  );
  const ltr = { dir: "ltr" } as const;
  const date = { type: "date", dir: "ltr" } as const;

  async function onSubmit(values: BuyerFormValues) {
    const onError = (error: AppErrorShape) => applyFieldErrors(form, error);
    if (buyerId) {
      const { leadId: _leadId, ...fields } = values;
      await update.run(
        { ...fields, buyerId },
        {
          onSuccess: () => {
            toast.success(tc("saved"));
            router.push(`/buyers/${buyerId}`);
          },
          onError,
        },
      );
    } else {
      await create.run(values, {
        onSuccess: ({ id }) => {
          toast.success(t("created"));
          router.push(`/buyers/${id}`);
        },
        onError,
      });
    }
  }

  return (
    <Card>
      <CardContent>
        <form
          id="buyer-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <FieldSeparator>{t("sections.identity")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr_1fr]">
              <SelectField
                control={form.control}
                name="civility"
                label={t("fields.civility")}
                emptyLabel="—"
                options={civilities.map((c) => ({ value: c, label: t(`civility.${c}`) }))}
              />
              {field("lastName")}
              {field("firstName")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("lastNameAr", { dir: "rtl", lang: "ar" })}
              {field("firstNameAr", { dir: "rtl", lang: "ar" })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("birthDate", date)}
              {field("birthPlace")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("fatherFirstName")}
              {field("motherFullName")}
            </div>

            <FieldSeparator>{t("sections.idCard")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("nin", { ...ltr, inputMode: "numeric" })}
              {field("idCardNumber", ltr)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("idCardIssuedOn", date)}
              {field("idCardIssuedBy")}
            </div>

            <FieldSeparator>{t("sections.contact")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-3">
              {field("phone", { ...ltr, type: "tel", inputMode: "tel" })}
              {field("phone2", { ...ltr, type: "tel", inputMode: "tel" })}
              {field("email", { ...ltr, type: "email" })}
            </div>
            {field("address")}
            <div className="grid gap-4 sm:grid-cols-2">
              {field("commune")}
              {field("wilaya")}
            </div>

            <FieldSeparator>{t("sections.situation")}</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-3">
              {field("profession")}
              {field("employer")}
              <SelectField
                control={form.control}
                name="maritalStatus"
                label={t("fields.maritalStatus")}
                emptyLabel="—"
                options={maritalStatuses.map((m) => ({ value: m, label: t(`maritalStatus.${m}`) }))}
              />
            </div>
            <TextareaField control={form.control} name="notes" label={t("fields.notes")} />
            <div className="flex gap-2">
              <Button type="submit" disabled={create.pending || update.pending}>
                {buyerId ? tc("save") : tc("create")}
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
