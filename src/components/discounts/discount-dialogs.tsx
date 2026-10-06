"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BadgePercent, Gavel } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DISCOUNT_APPROVAL_DAYS, type DiscountRequestState } from "@/lib/discounts";
import { formatDZD, parseDZD, toDecimalString } from "@/lib/money";
import { decideDiscountAction, requestDiscountAction } from "@/server/discounts/actions";
import { requestDiscountSchema } from "@/server/discounts/schemas";

const stateVariant: Record<DiscountRequestState, "default" | "secondary" | "outline"> = {
  pending: "outline",
  approved: "default",
  rejected: "secondary",
  cancelled: "secondary",
  expired: "secondary",
};

export function DiscountStateBadge({ state }: { state: DiscountRequestState }) {
  const t = useTranslations("discounts.state");
  return (
    <Badge variant={stateVariant[state]} data-state={state}>
      {t(state)}
    </Badge>
  );
}

export type DiscountUnitChoice = {
  id: string;
  code: string;
  projectName: string;
  listPrice: bigint;
};

/** A commercial asks a manager for a discount on a unit for this lead. */
export function RequestDiscountDialog({
  leadId,
  units,
}: {
  leadId: string;
  units: DiscountUnitChoice[];
}) {
  const t = useTranslations("discounts");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const [open, setOpen] = useState(false);
  const request = useAction(requestDiscountAction);
  const form = useForm<
    z.input<typeof requestDiscountSchema>,
    unknown,
    z.output<typeof requestDiscountSchema>
  >({
    resolver: zodResolver(requestDiscountSchema),
    defaultValues: { leadId, unitId: "", amount: "", reason: "" },
  });
  const unitId = useWatch({ control: form.control, name: "unitId" });
  const unit = units.find((u) => u.id === unitId);
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <BadgePercent data-icon="inline-start" />
          {t("request")}
        </Button>
      }
      title={t("requestTitle")}
      description={t("requestHint", { days: DISCOUNT_APPROVAL_DAYS })}
      submitLabel={t("request")}
      pending={request.pending}
      onSubmit={form.handleSubmit(() =>
        request.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("requested"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <SelectField
        control={form.control}
        name="unitId"
        label={t("fields.unit")}
        options={units.map((u) => ({ value: u.id, label: `${u.code} · ${u.projectName}` }))}
      />
      {unit ? (
        <p className="text-sm text-muted-foreground">
          {t("listPrice", { amount: formatDZD(unit.listPrice, locale) })}
        </p>
      ) : null}
      <TextField
        control={form.control}
        name="amount"
        label={t("fields.amount")}
        inputMode="decimal"
        dir="ltr"
      />
      <TextareaField control={form.control} name="reason" label={t("fields.reason")} rows={3} />
    </FormDialog>
  );
}

/**
 * A manager decides a pending request: granted for the amount asked or less, or refused with a
 * note.
 */
export function DecideDiscountDialog({
  request,
}: {
  request: {
    id: string;
    leadName: string;
    unitCode: string;
    amount: bigint;
    listPrice: bigint;
    reason: string;
    requesterName: string;
  };
}) {
  const t = useTranslations("discounts");
  const tc = useTranslations("common");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, locale);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => toDecimalString(request.amount).replace(".", ","));
  const [note, setNote] = useState("");
  const decide = useAction(decideDiscountAction);
  const parsed = amount.trim() === "" ? request.amount : parseDZD(amount);
  const submit = (approve: boolean) =>
    decide.run(
      { requestId: request.id, approve, amount, note },
      {
        onSuccess: () => {
          toast.success(t(approve ? "approved" : "rejected"));
          setOpen(false);
        },
      },
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Gavel data-icon="inline-start" />
          {t("decide")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>
            {t("decideTitle", { unit: request.unitCode, lead: request.leadName })}
          </DialogTitle>
          <DialogDescription>
            {t("decideHint", {
              name: request.requesterName,
              amount: money(request.amount),
              price: money(request.listPrice),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-line">{request.reason}</p>
          <div className="space-y-1.5">
            <Label htmlFor="discount-approved">{t("fields.approvedAmount")}</Label>
            <Input
              id="discount-approved"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              aria-invalid={parsed === null || parsed > request.amount}
            />
            {parsed !== null && parsed <= request.amount ? (
              <p className="text-sm text-muted-foreground">
                {t("netPrice", { amount: money(request.listPrice - parsed) })}
              </p>
            ) : (
              <p className="text-sm text-destructive">{t("errors.moreThanAsked")}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount-note">{t("fields.note")}</Label>
            <Textarea
              id="discount-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={decide.pending || note.trim() === ""}
            onClick={() => submit(false)}
          >
            {t("reject")}
          </Button>
          <Button
            disabled={decide.pending || parsed === null || parsed > request.amount}
            onClick={() => submit(true)}
          >
            {t("approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
