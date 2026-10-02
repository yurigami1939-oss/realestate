"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileSignature, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { VspWarnings } from "@/components/sales/vsp-warnings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { formatDZD, parseDZD } from "@/lib/money";
import {
  buildSchedule,
  checkVspLimits,
  formatShare,
  milestoneDueOn,
  netPrice,
  type ScheduleLine,
} from "@/lib/payment-plans";
import { formatPhone } from "@/lib/phone";
import { MAX_BUYERS_PER_SALE, type VspLimits } from "@/lib/sales";
import type { PaymentSetups } from "@/server/payment-plans/queries";
import { createReservationAction } from "@/server/sales/actions";
import type { ReservableUnit } from "@/server/sales/queries";
import { createReservationSchema } from "@/server/sales/schemas";

type Values = z.input<typeof createReservationSchema>;

export type BuyerChoice = {
  id: string;
  lastName: string;
  firstName: string;
  phone: string;
  leadId: string | null;
};

/**
 * Reservation form: unit, buyers (main + co-buyers), plan, discount for managers and the
 * contract date; the schedule and the VSP limit check are previewed as the form changes.
 */
export function ReservationForm({
  units,
  buyers,
  setups,
  vspLimits,
  canDiscount,
  delayDays,
  today,
  defaults,
}: {
  units: ReservableUnit[];
  buyers: BuyerChoice[];
  setups: PaymentSetups;
  vspLimits: VspLimits;
  canDiscount: boolean;
  /** Company delay after a milestone's validation (payment calls). */
  delayDays: number;
  today: string;
  defaults: { unitId: string; buyerId: string };
}) {
  const t = useTranslations("sales");
  const tq = useTranslations("quotations");
  const tp = useTranslations("paymentPlans");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, locale);
  const router = useRouter();
  const create = useAction(createReservationAction);

  const projects = [
    ...new Map(units.map((u) => [u.projectId, { id: u.projectId, name: u.projectName }])).values(),
  ];
  const preselected = units.find((u) => u.id === defaults.unitId);
  const [projectId, setProjectId] = useState(preselected?.projectId ?? projects[0]?.id ?? "");
  const defaultPlan = (id: string) => setups[id]?.plans[0]?.id ?? "";

  const form = useForm<Values, unknown, z.output<typeof createReservationSchema>>({
    resolver: zodResolver(createReservationSchema),
    defaultValues: {
      unitId: preselected?.id ?? "",
      buyerIds: [defaults.buyerId],
      paymentPlanId: defaultPlan(preselected?.projectId ?? projects[0]?.id ?? ""),
      discount: "",
      reservedOn: today,
      notary: "",
      reference: "",
      notes: "",
    },
  });
  const [unitId, buyerIds, planId, discount, reservedOn] = useWatch({
    control: form.control,
    name: ["unitId", "buyerIds", "paymentPlanId", "discount", "reservedOn"],
  });

  const setup = setups[projectId];
  const projectUnits = units.filter((u) => u.projectId === projectId);
  const unit = projectUnits.find((u) => u.id === unitId);
  const plan = setup?.plans.find((p) => p.id === planId);
  const parsedDiscount = !discount?.trim() ? 0n : parseDZD(discount);
  const price = unit ? netPrice(unit.listPrice, parsedDiscount ?? 0n) : null;
  const signingOn = /^\d{4}-\d{2}-\d{2}$/.test(reservedOn) ? reservedOn : today;
  const lines =
    unit && plan && price !== null && price >= 0n
      ? buildSchedule(price, plan.steps, signingOn, setup?.milestones ?? [])
      : [];
  const warnings = plan ? checkVspLimits(plan.steps, setup?.milestones ?? [], vspLimits) : [];
  const holderHasBuyer =
    !unit?.option ||
    buyerIds.some((id) => buyers.find((b) => b.id === id)?.leadId === unit.option?.leadId);

  const buyerLabel = (b: BuyerChoice) => `${b.lastName} ${b.firstName} · ${formatPhone(b.phone)}`;
  const dueText = (line: ScheduleLine, index: number) => {
    if (line.trigger === "signing") return t("atSigning");
    if (line.trigger === "months_after_signing") return line.dueOn ? formatDate(line.dueOn) : "—";
    const milestone = setup?.milestones.find((m) => m.id === plan?.steps[index]?.milestoneId);
    if (milestone?.validatedOn) {
      return t("milestoneReached", {
        name: milestone.name,
        date: formatDate(milestoneDueOn(milestone.validatedOn, delayDays, signingOn)),
      });
    }
    const name = t("atMilestone", { name: line.milestoneName ?? "—" });
    return line.dueOn ? `${name} (${t("plannedOn", { date: formatDate(line.dueOn) })})` : name;
  };

  const submit = form.handleSubmit(() =>
    create.run(form.getValues(), {
      onSuccess: ({ id, number }) => {
        toast.success(t("created", { number }));
        router.push(`/sales/${id}`);
      },
      onError: (error) => applyFieldErrors(form, error),
    }),
  );

  return (
    <form className="grid gap-6 xl:grid-cols-5" onSubmit={submit} noValidate>
      <Card className="xl:col-span-2">
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="reservation-project">{tq("project")}</FieldLabel>
            <Select
              value={projectId}
              onValueChange={(value) => {
                setProjectId(value);
                form.setValue("unitId", "");
                form.setValue("paymentPlanId", defaultPlan(value));
              }}
            >
              <SelectTrigger id="reservation-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Controller
            control={form.control}
            name="unitId"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="unitId">{t("fields.unitId")}</FieldLabel>
                {/* Remounted per project: Radix clears a value whose options change. */}
                <Select key={projectId} value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="unitId" className="w-full" aria-invalid={fieldState.invalid}>
                    <SelectValue placeholder={tq("chooseUnit")} />
                  </SelectTrigger>
                  <SelectContent>
                    {projectUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.code}
                        {u.typology ? ` · ${u.typology}` : ""} · {money(u.listPrice)}
                        {u.option ? ` · ${t("optionFor", { name: u.option.leadName })}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.error?.message ? (
                  <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
                ) : null}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="buyerIds"
            render={({ field, fieldState }) => {
              const ids = field.value;
              const setAt = (index: number, id: string) =>
                field.onChange(ids.map((current, i) => (i === index ? id : current)));
              return (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>{t("fields.buyerIds")}</FieldLabel>
                  {buyers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noBuyer")}</p>
                  ) : null}
                  <div className="space-y-2">
                    {ids.map((id, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Select value={id} onValueChange={(v) => setAt(index, v)}>
                          <SelectTrigger
                            className="w-full min-w-0"
                            aria-label={index === 0 ? t("fields.mainBuyer") : t("fields.coBuyer")}
                          >
                            <SelectValue
                              placeholder={
                                index === 0 ? t("fields.mainBuyer") : t("fields.coBuyer")
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {buyers.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {buyerLabel(b)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {index > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("fields.removeBuyer")}
                            onClick={() => field.onChange(ids.filter((_, i) => i !== index))}
                          >
                            <X />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ids.length < MAX_BUYERS_PER_SALE ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => field.onChange([...ids, ""])}
                      >
                        <Plus data-icon="inline-start" />
                        {t("fields.addBuyer")}
                      </Button>
                    ) : null}
                    <Button type="button" variant="link" size="sm" asChild>
                      <Link href="/buyers/new">{t("newBuyer")}</Link>
                    </Button>
                  </div>
                  {fieldState.error?.message ? (
                    <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
                  ) : null}
                </Field>
              );
            }}
          />

          <Controller
            control={form.control}
            name="paymentPlanId"
            render={({ field, fieldState }) =>
              !setup || setup.plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tq("noPlan")}</p>
              ) : (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="paymentPlanId">{t("fields.paymentPlanId")}</FieldLabel>
                  <Select key={projectId} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="paymentPlanId" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {setup.plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.isDefault ? `${p.name} · ${tp("default")}` : p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )
            }
          />

          {canDiscount ? (
            <TextField
              control={form.control}
              name="discount"
              label={t("fields.discount")}
              inputMode="decimal"
              dir="ltr"
            />
          ) : null}
          <TextField
            control={form.control}
            name="reservedOn"
            label={t("fields.reservedOn")}
            type="date"
            dir="ltr"
            max={today}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={form.control} name="notary" label={t("fields.notary")} />
            <TextField control={form.control} name="reference" label={t("fields.reference")} />
          </div>
          <TextareaField control={form.control} name="notes" label={t("fields.notes")} rows={2} />

          <Button type="submit" className="w-full" disabled={create.pending}>
            <FileSignature data-icon="inline-start" />
            {t("submit")}
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">{t("schedule")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {unit?.option ? (
            <Alert>
              <AlertDescription>
                {t(holderHasBuyer ? "optionHeld" : "optionHolderMissing", {
                  name: unit.option.leadName,
                })}
              </AlertDescription>
            </Alert>
          ) : null}
          {unit && price !== null ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2 rounded-md border p-2">
                <dt className="text-muted-foreground">{tq("listPrice")}</dt>
                <dd dir="ltr">{money(unit.listPrice)}</dd>
              </div>
              <div className="flex justify-between gap-2 rounded-md border p-2 font-semibold">
                <dt>{tq("net")}</dt>
                <dd dir="ltr" data-testid="reservation-price">
                  {money(price)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{tq("chooseUnit")}</p>
          )}
          {lines.length > 0 && price !== null ? (
            <Table data-testid="reservation-schedule">
              <TableHeader>
                <TableRow>
                  <TableHead>{tq("columns.step")}</TableHead>
                  <TableHead>{tq("columns.due")}</TableHead>
                  <TableHead className="text-end">{tq("columns.share")}</TableHead>
                  <TableHead className="text-end">{tq("columns.amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={line.position}>
                    <TableCell className="whitespace-normal">{line.label}</TableCell>
                    <TableCell className="whitespace-normal">{dueText(line, index)}</TableCell>
                    <TableCell className="text-end" dir="ltr">
                      {formatShare(line.shareBp)}
                    </TableCell>
                    <TableCell className="text-end whitespace-nowrap" dir="ltr">
                      {money(line.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>{tc("total")}</TableCell>
                  <TableCell className="text-end whitespace-nowrap" dir="ltr">
                    {money(price)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          ) : null}
          <VspWarnings warnings={warnings} />
        </CardContent>
      </Card>
    </form>
  );
}
