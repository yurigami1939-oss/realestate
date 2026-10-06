"use client";

import { FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD, parseDZD } from "@/lib/money";
import { buildSchedule, formatShare, netPrice, type ScheduleLine } from "@/lib/payment-plans";
import { issueQuotationAction } from "@/server/quotations/actions";
import type { PaymentSetups } from "@/server/payment-plans/queries";

export type QuotableUnit = {
  id: string;
  projectId: string;
  code: string;
  typology: string | null;
  listPrice: bigint;
};

/**
 * Simulator and quotation form: pick a unit and a plan, see the schedule on the net price,
 * then issue the numbered quotation. Managers get the discount field; a commercial gets it on a
 * unit with a discount approved for this lead, up to that amount.
 */
export function QuotationForm({
  leadId,
  defaultProjectId,
  projects,
  units,
  setups,
  canDiscount,
  approvedDiscounts,
}: {
  leadId: string;
  defaultProjectId: string | null;
  projects: { id: string; name: string }[];
  units: QuotableUnit[];
  setups: PaymentSetups;
  canDiscount: boolean;
  /** Discounts approved for this lead, per unit (commercials). */
  approvedDiscounts: { unitId: string; amount: bigint }[];
}) {
  const t = useTranslations("quotations");
  const tp = useTranslations("paymentPlans");
  const td = useTranslations("discounts");
  const translate = useTranslateKey();
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const router = useRouter();
  const issue = useAction(issueQuotationAction);

  const [projectId, setProjectId] = useState(
    defaultProjectId && projects.some((p) => p.id === defaultProjectId)
      ? defaultProjectId
      : (projects[0]?.id ?? ""),
  );
  const setup = setups[projectId];
  const projectUnits = units.filter((u) => u.projectId === projectId);
  const [unitId, setUnitId] = useState("");
  const [planId, setPlanId] = useState(setup?.plans[0]?.id ?? "");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");

  const unit = projectUnits.find((u) => u.id === unitId);
  const plan = setup?.plans.find((p) => p.id === planId);
  const parsedDiscount = discount.trim() === "" ? 0n : parseDZD(discount);
  const approved = canDiscount
    ? null
    : (approvedDiscounts.find((a) => a.unitId === unitId)?.amount ?? null);
  const discountError =
    parsedDiscount === null
      ? "validation.amount"
      : unit && parsedDiscount > unit.listPrice
        ? "quotations.errors.discountTooHigh"
        : approved !== null && parsedDiscount > approved
          ? "discounts.errors.aboveApproved"
          : null;
  const price = unit ? netPrice(unit.listPrice, parsedDiscount ?? 0n) : null;
  const lines =
    unit && plan && price !== null
      ? buildSchedule(price, plan.steps, todayInAlgiers(), setup?.milestones ?? [])
      : [];

  const money = (v: bigint) => formatDZD(v, locale);
  const dueText = (line: ScheduleLine) => {
    if (line.trigger === "signing") return t("atSigning");
    if (line.trigger === "months_after_signing") return line.dueOn ? formatDate(line.dueOn) : "—";
    return line.dueOn
      ? t("plannedMilestone", { name: line.milestoneName ?? "—", date: formatDate(line.dueOn) })
      : t("unplannedMilestone", { name: line.milestoneName ?? "—" });
  };

  const choose = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { value: string; label: string }[],
    placeholder?: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* Remounted per project: Radix clears a value whose options change. */}
      <Select
        key={id === "quotation-project" ? id : projectId}
        value={value || undefined}
        onValueChange={onChange}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-2">
        <CardContent className="space-y-4">
          {choose(
            "quotation-project",
            t("project"),
            projectId,
            (v) => {
              setProjectId(v);
              setUnitId("");
              setPlanId(setups[v]?.plans[0]?.id ?? "");
            },
            projects.map((p) => ({ value: p.id, label: p.name })),
          )}
          {projectUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noUnits")}</p>
          ) : (
            choose(
              "quotation-unit",
              t("unit"),
              unitId,
              setUnitId,
              projectUnits.map((u) => ({
                value: u.id,
                label: `${u.code}${u.typology ? ` · ${u.typology}` : ""} · ${money(u.listPrice)}`,
              })),
              t("chooseUnit"),
            )
          )}
          {!setup || setup.plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPlan")}</p>
          ) : (
            choose(
              "quotation-plan",
              t("plan"),
              planId,
              setPlanId,
              setup.plans.map((p) => ({
                value: p.id,
                label: p.isDefault ? `${p.name} · ${tp("default")}` : p.name,
              })),
            )
          )}
          {canDiscount || approved !== null ? (
            <div className="space-y-1.5">
              <Label htmlFor="quotation-discount">{t("discount")}</Label>
              <Input
                id="quotation-discount"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                aria-invalid={discountError !== null}
              />
              {discountError ? (
                <p className="text-sm text-destructive">{translate(discountError)}</p>
              ) : approved !== null ? (
                <p className="text-sm text-muted-foreground">
                  {td("availableDiscount", { amount: money(approved) })}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("discountHint")}</p>
              )}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="quotation-notes">{t("notes")}</Label>
            <Textarea
              id="quotation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
          <Button
            className="w-full"
            disabled={!unit || !plan || discountError !== null || issue.pending}
            onClick={() =>
              void issue.run(
                { leadId, unitId, paymentPlanId: planId, discount, notes },
                {
                  onSuccess: ({ id, number }) => {
                    toast.success(t("issued", { number }));
                    router.push(`/quotations/${id}`);
                  },
                },
              )
            }
          >
            <FileText data-icon="inline-start" />
            {t("issue")}
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">{t("simulator")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {unit && price !== null ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2 rounded-md border p-2">
                <dt className="text-muted-foreground">{t("listPrice")}</dt>
                <dd dir="ltr">{money(unit.listPrice)}</dd>
              </div>
              <div className="flex justify-between gap-2 rounded-md border p-2 font-semibold">
                <dt>{t("net")}</dt>
                <dd dir="ltr" data-testid="quotation-net">
                  {money(price)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t("chooseUnit")}</p>
          )}
          {lines.length > 0 && price !== null ? (
            <Table data-testid="quotation-schedule">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.step")}</TableHead>
                  <TableHead>{t("columns.due")}</TableHead>
                  <TableHead className="text-end">{t("columns.share")}</TableHead>
                  <TableHead className="text-end">{t("columns.amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.position}>
                    <TableCell className="whitespace-normal">{line.label}</TableCell>
                    <TableCell className="whitespace-normal">{dueText(line)}</TableCell>
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
                  <TableCell colSpan={3}>{t("net")}</TableCell>
                  <TableCell className="text-end whitespace-nowrap" dir="ltr">
                    {money(price)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
