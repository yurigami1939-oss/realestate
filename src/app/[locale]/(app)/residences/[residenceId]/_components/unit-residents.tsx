"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { PhoneText } from "@/components/crm/phone";
import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { CheckboxField, SelectField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { residentKinds } from "@/lib/residences";
import { addResidentAction, endResidentAction } from "@/server/residences/actions";
import type { UnitResident } from "@/server/residences/queries";
import { addResidentSchema } from "@/server/residences/schemas";

type Values = z.input<typeof addResidentSchema>;

/** End of an ownership or occupancy, inline: date then confirm. */
function EndResident({ residentId, today }: { residentId: string; today: string }) {
  const t = useTranslations("residences.residents");
  const end = useAction(endResidentAction);
  const [day, setDay] = useState(today);
  return (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        dir="ltr"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        className="h-8 w-36"
        aria-label={t("untilOn")}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={end.pending || !day}
        onClick={() =>
          void end.run({ residentId, untilOn: day }, { onSuccess: () => toast.success(t("ended")) })
        }
      >
        {t("end")}
      </Button>
    </div>
  );
}

/** Co-owners and occupants of a unit over time; add one, end one. */
export function UnitResidents({
  residenceId,
  unitId,
  code,
  history,
  editable,
  today,
}: {
  residenceId: string;
  unitId: string;
  code: string;
  history: UnitResident[];
  editable: boolean;
  today: string;
}) {
  const t = useTranslations("residences.residents");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const add = useAction(addResidentAction);
  const periodOf = (sinceOn: string | null, untilOn: string | null) => {
    if (sinceOn && untilOn) {
      return t("period", { since: formatDate(sinceOn), until: formatDate(untilOn) });
    }
    if (sinceOn) return t("periodSince", { since: formatDate(sinceOn) });
    if (untilOn) return t("periodUntil", { until: formatDate(untilOn) });
    return null;
  };
  const empty: Values = {
    residenceId,
    unitId,
    kind: "co_owner",
    isMain: history.every((r) => r.untilOn !== null || r.kind !== "co_owner"),
    lastName: "",
    firstName: "",
    lastNameAr: "",
    firstNameAr: "",
    phone: "",
    email: "",
    address: "",
    sinceOn: today,
    notes: "",
  };
  const form = useForm<Values, unknown, z.output<typeof addResidentSchema>>({
    resolver: zodResolver(addResidentSchema),
    defaultValues: empty,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Users data-icon="inline-start" />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent
        closeLabel={tc("close")}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{t("title", { code })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="divide-y text-sm" data-testid="unit-residents">
            {history.map((r) => {
              const details = [periodOf(r.sinceOn, r.untilOn), r.fromSale ? t("fromSale") : null]
                .filter((part) => part !== null)
                .join(" · ");
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium">
                      {r.lastName} {r.firstName}
                    </span>{" "}
                    <Badge variant="outline">{t(`kind.${r.kind}`)}</Badge>{" "}
                    {r.isMain ? <Badge variant="secondary">{t("main")}</Badge> : null}
                    <div className="text-xs text-muted-foreground">
                      {r.phone ? <PhoneText value={r.phone} /> : null}
                      {r.phone && details ? " · " : null}
                      {details}
                    </div>
                  </div>
                  {editable && r.untilOn === null ? (
                    <EndResident residentId={r.id} today={today} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {editable ? (
          <form
            className="space-y-3 border-t pt-3"
            onSubmit={form.handleSubmit(() =>
              add.run(form.getValues(), {
                onSuccess: () => {
                  toast.success(t("added"));
                  form.reset(empty);
                },
                onError: (error) => applyFieldErrors(form, error),
              }),
            )}
            noValidate
          >
            <div className="text-sm font-medium">{t("add")}</div>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  control={form.control}
                  name="kind"
                  label={t("fields.kind")}
                  options={residentKinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
                />
                <TextField
                  control={form.control}
                  name="sinceOn"
                  label={t("fields.sinceOn")}
                  type="date"
                  dir="ltr"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField control={form.control} name="lastName" label={t("fields.lastName")} />
                <TextField control={form.control} name="firstName" label={t("fields.firstName")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="lastNameAr"
                  label={t("fields.lastNameAr")}
                  dir="rtl"
                  lang="ar"
                />
                <TextField
                  control={form.control}
                  name="firstNameAr"
                  label={t("fields.firstNameAr")}
                  dir="rtl"
                  lang="ar"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  control={form.control}
                  name="phone"
                  label={t("fields.phone")}
                  type="tel"
                  dir="ltr"
                />
                <TextField
                  control={form.control}
                  name="email"
                  label={t("fields.email")}
                  type="email"
                  dir="ltr"
                />
              </div>
              <TextField control={form.control} name="address" label={t("fields.address")} />
              <CheckboxField control={form.control} name="isMain" label={t("fields.isMain")} />
            </FieldGroup>
            <Button type="submit" disabled={add.pending}>
              {t("addSubmit")}
            </Button>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
