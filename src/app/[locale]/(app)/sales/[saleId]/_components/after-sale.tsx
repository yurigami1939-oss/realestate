"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftRight, Check, Landmark, Pencil, Undo2, Users, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { FormDialog } from "@/components/forms/form-dialog";
import { SelectField, TextareaField } from "@/components/forms/fields";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { applyRate, formatDZD, parseDZD, parsePercentToBasisPoints } from "@/lib/money";
import { netPrice } from "@/lib/payment-plans";
import { bankLoanStatuses, counterPaymentMethods, MAX_BUYERS_PER_SALE } from "@/lib/sales";
import {
  createBankLoanAction,
  decideWithdrawalAction,
  proposeWithdrawalAction,
  recordWithdrawalRefundAction,
  swapUnitAction,
  transferReservationAction,
  updateBankLoanAction,
} from "@/server/sales/actions";
import {
  createBankLoanSchema,
  decideWithdrawalSchema,
  proposeWithdrawalSchema,
  recordWithdrawalRefundSchema,
  swapUnitSchema,
  transferReservationSchema,
  type updateBankLoanSchema,
} from "@/server/sales/schemas";

const useMoney = () => {
  const locale = useLocale() === "ar" ? "ar" : "fr";
  return (v: bigint) => formatDZD(v, locale);
};

// ── Withdrawal ──────────────────────────────────────────────────────────────

type ProposeValues = z.input<typeof proposeWithdrawalSchema>;

/** Directeur commercial: proposes a withdrawal with the retention prefilled (company default). */
export function ProposeWithdrawalDialog({
  reservationId,
  paid,
  defaultRetention,
  termination = false,
}: {
  reservationId: string;
  paid: bigint;
  defaultRetention: string;
  /** A termination for non-payment rather than the buyer's désistement. */
  termination?: boolean;
}) {
  const t = useTranslations("sales.withdrawal");
  const tt = useTranslations("sales.termination");
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const propose = useAction(proposeWithdrawalAction);
  const form = useForm<ProposeValues, unknown, z.output<typeof proposeWithdrawalSchema>>({
    resolver: zodResolver(proposeWithdrawalSchema),
    defaultValues: {
      reservationId,
      retention: defaultRetention,
      reason: "",
      kind: termination ? "termination" : "withdrawal",
    },
  });
  const retention = useWatch({ control: form.control, name: "retention" });
  const bp = parsePercentToBasisPoints(retention.trim());
  const kept = bp !== null && bp >= 0n && bp <= 10_000n ? applyRate(paid, bp) : null;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={termination ? "destructive" : "outline"} size="sm">
          <Undo2 data-icon="inline-start" />
          {termination ? tt("propose") : t("propose")}
        </Button>
      }
      title={termination ? tt("proposeTitle") : t("proposeTitle")}
      description={termination ? tt("proposeDescription") : t("proposeDescription")}
      submitLabel={termination ? tt("propose") : t("propose")}
      pending={propose.pending}
      onSubmit={form.handleSubmit(() =>
        propose.run(form.getValues(), {
          onSuccess: () => {
            toast.success(termination ? tt("proposed") : t("proposed"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="retention"
        label={t("retention")}
        inputMode="decimal"
        dir="ltr"
      />
      <p className="text-sm text-muted-foreground" data-testid="withdrawal-preview">
        {kept === null
          ? t("paid", { amount: money(paid) })
          : t("preview", {
              paid: money(paid),
              retention: money(kept),
              refund: money(paid - kept),
            })}
      </p>
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

type DecideValues = z.input<typeof decideWithdrawalSchema>;

/** Gérant: approves (the unit is released) or rejects (with a note) a proposed withdrawal. */
export function DecideWithdrawalDialog({
  withdrawalId,
  approve,
  refund,
  termination = false,
}: {
  withdrawalId: string;
  approve: boolean;
  refund: bigint;
  termination?: boolean;
}) {
  const t = useTranslations("sales.withdrawal");
  const tt = useTranslations("sales.termination");
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const decide = useAction(decideWithdrawalAction);
  const form = useForm<DecideValues, unknown, z.output<typeof decideWithdrawalSchema>>({
    resolver: zodResolver(decideWithdrawalSchema),
    defaultValues: { withdrawalId, approve, note: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant={approve ? "default" : "outline"} size="sm">
          {approve ? <Check data-icon="inline-start" /> : <X data-icon="inline-start" />}
          {approve ? (termination ? tt("approve") : t("approve")) : t("reject")}
        </Button>
      }
      title={approve ? (termination ? tt("approveTitle") : t("approveTitle")) : t("rejectTitle")}
      description={
        approve
          ? (termination ? tt : t)("approveDescription", { refund: money(refund) })
          : t("rejectDescription")
      }
      submitLabel={approve ? (termination ? tt("approve") : t("approve")) : t("reject")}
      destructive={approve}
      pending={decide.pending}
      onSubmit={form.handleSubmit(() =>
        decide.run(form.getValues(), {
          onSuccess: () => {
            toast.success(approve ? (termination ? tt("approved") : t("approved")) : t("rejected"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextareaField control={form.control} name="note" label={t("note")} rows={2} />
    </FormDialog>
  );
}

type RefundValues = z.input<typeof recordWithdrawalRefundSchema>;

/** Cashier / accountant: the refund of an approved withdrawal was paid out. */
export function WithdrawalRefundDialog({
  withdrawalId,
  refund,
  today,
}: {
  withdrawalId: string;
  refund: bigint;
  today: string;
}) {
  const t = useTranslations("sales.withdrawal");
  const tp = useTranslations("payments");
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const record = useAction(recordWithdrawalRefundAction);
  const form = useForm<RefundValues, unknown, z.output<typeof recordWithdrawalRefundSchema>>({
    resolver: zodResolver(recordWithdrawalRefundSchema),
    defaultValues: { withdrawalId, refundedOn: today, method: "cheque", reference: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Undo2 data-icon="inline-start" />
          {t("recordRefund")}
        </Button>
      }
      title={t("refundTitle", { amount: money(refund) })}
      submitLabel={t("recordRefund")}
      pending={record.pending}
      onSubmit={form.handleSubmit(() =>
        record.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("refunded"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField
        control={form.control}
        name="refundedOn"
        label={t("refundedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <SelectField
        control={form.control}
        name="method"
        label={tp("fields.method")}
        options={counterPaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
      />
      <TextField control={form.control} name="reference" label={tp("fields.reference")} dir="ltr" />
    </FormDialog>
  );
}

// ── Transfer (cession) and unit swap ────────────────────────────────────────

type TransferValues = z.input<typeof transferReservationSchema>;

export type BuyerChoice = { id: string; label: string };

/** Cession: new buyers (main first) take the reservation over. */
export function TransferDialog({
  reservationId,
  buyers,
  current,
  today,
}: {
  reservationId: string;
  buyers: BuyerChoice[];
  current: string[];
  today: string;
}) {
  const t = useTranslations("sales.transfer");
  const ts = useTranslations("sales.fields");
  const translate = useTranslateKey();
  const [open, setOpen] = useState(false);
  const transfer = useAction(transferReservationAction);
  const form = useForm<TransferValues, unknown, z.output<typeof transferReservationSchema>>({
    resolver: zodResolver(transferReservationSchema),
    defaultValues: { reservationId, buyerIds: current, transferredOn: today, notes: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <Users data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      pending={transfer.pending}
      onSubmit={form.handleSubmit(() =>
        transfer.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("done"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <Controller
        control={form.control}
        name="buyerIds"
        render={({ field, fieldState }) => {
          const ids = field.value;
          const setAt = (index: number, id: string) =>
            field.onChange(ids.map((value, i) => (i === index ? id : value)));
          return (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel>{ts("buyerIds")}</FieldLabel>
              {ids.map((id, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select value={id} onValueChange={(v) => setAt(index, v)}>
                    <SelectTrigger
                      className="w-full min-w-0"
                      aria-label={index === 0 ? ts("mainBuyer") : ts("coBuyer")}
                    >
                      <SelectValue placeholder={index === 0 ? ts("mainBuyer") : ts("coBuyer")} />
                    </SelectTrigger>
                    <SelectContent>
                      {buyers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {index > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={ts("removeBuyer")}
                      onClick={() => field.onChange(ids.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
              ))}
              {ids.length < MAX_BUYERS_PER_SALE ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => field.onChange([...ids, ""])}
                >
                  {ts("addBuyer")}
                </Button>
              ) : null}
              {fieldState.error?.message ? (
                <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
              ) : null}
            </Field>
          );
        }}
      />
      <TextField
        control={form.control}
        name="transferredOn"
        label={t("transferredOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField control={form.control} name="notes" label={t("notes")} rows={2} />
    </FormDialog>
  );
}

type SwapValues = z.input<typeof swapUnitSchema>;

export type SwapUnitChoice = {
  id: string;
  code: string;
  typology: string | null;
  listPrice: bigint;
};

/** Changement de lot within the project, at the chosen unit's price. */
export function SwapUnitDialog({
  reservationId,
  units,
  paid,
  canDiscount,
  today,
}: {
  reservationId: string;
  units: SwapUnitChoice[];
  paid: bigint;
  canDiscount: boolean;
  today: string;
}) {
  const t = useTranslations("sales.swap");
  const money = useMoney();
  const translate = useTranslateKey();
  const [open, setOpen] = useState(false);
  const swap = useAction(swapUnitAction);
  const form = useForm<SwapValues, unknown, z.output<typeof swapUnitSchema>>({
    resolver: zodResolver(swapUnitSchema),
    defaultValues: { reservationId, unitId: "", discount: "", swappedOn: today, reason: "" },
  });
  const [unitId, discount] = useWatch({ control: form.control, name: ["unitId", "discount"] });
  const target = units.find((u) => u.id === unitId);
  const parsed = !discount?.trim() ? 0n : parseDZD(discount);
  const price = target && parsed !== null ? netPrice(target.listPrice, parsed) : null;
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <ArrowLeftRight data-icon="inline-start" />
          {t("open")}
        </Button>
      }
      title={t("title")}
      description={t("description", { paid: money(paid) })}
      submitLabel={t("submit")}
      pending={swap.pending}
      onSubmit={form.handleSubmit(() =>
        swap.run(form.getValues(), {
          onSuccess: ({ price: newPrice }) => {
            toast.success(t("done", { price: money(newPrice) }));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <Controller
        control={form.control}
        name="unitId"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="swap-unit">{t("unit")}</FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="swap-unit" className="w-full">
                <SelectValue placeholder={t("unit")} />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.code}
                    {u.typology ? ` · ${u.typology}` : ""} · {money(u.listPrice)}
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
      {canDiscount ? (
        <TextField
          control={form.control}
          name="discount"
          label={t("discount")}
          inputMode="decimal"
          dir="ltr"
        />
      ) : null}
      {price !== null ? (
        <p className="text-sm font-medium" data-testid="swap-price">
          {t("newPrice", { price: money(price) })}
        </p>
      ) : null}
      <TextField
        control={form.control}
        name="swappedOn"
        label={t("swappedOn")}
        type="date"
        dir="ltr"
        max={today}
      />
      <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
    </FormDialog>
  );
}

// ── Bank loan ───────────────────────────────────────────────────────────────

type LoanValues = z.input<typeof createBankLoanSchema>;
type LoanUpdateValues = z.input<typeof updateBankLoanSchema>;

export type LoanInput = {
  id: string;
  bank: string;
  requested: string;
  approved: string;
  status: (typeof bankLoanStatuses)[number];
  submittedOn: string;
  decidedOn: string;
  reference: string;
  notes: string;
};

/** Opens or updates the buyer's bank loan file (one followed loan per sale). */
export function BankLoanDialog({
  reservationId,
  loan,
}: {
  reservationId: string;
  loan: LoanInput | null;
}) {
  const t = useTranslations("sales.loan");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const create = useAction(createBankLoanAction);
  const update = useAction(updateBankLoanAction);
  const defaults = {
    bank: loan?.bank ?? "",
    requested: loan?.requested ?? "",
    approved: loan?.approved ?? "",
    status: loan?.status ?? ("preparing" as const),
    submittedOn: loan?.submittedOn ?? "",
    decidedOn: loan?.decidedOn ?? "",
    reference: loan?.reference ?? "",
    notes: loan?.notes ?? "",
  };
  const form = useForm<LoanValues, unknown, z.output<typeof createBankLoanSchema>>({
    resolver: zodResolver(createBankLoanSchema),
    defaultValues: { reservationId, ...defaults },
  });
  const done = () => {
    toast.success(t("saved"));
    setOpen(false);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          {loan ? <Pencil data-icon="inline-start" /> : <Landmark data-icon="inline-start" />}
          {loan ? tc("edit") : t("open")}
        </Button>
      }
      title={t("title")}
      submitLabel={tc("save")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const { reservationId: _id, ...values } = form.getValues();
        if (loan) {
          const input: LoanUpdateValues = { bankLoanId: loan.id, ...values };
          return update.run(input, {
            onSuccess: done,
            onError: (error) => applyFieldErrors(form, error),
          });
        }
        return create.run(form.getValues(), {
          onSuccess: done,
          onError: (error) => applyFieldErrors(form, error),
        });
      })}
    >
      <TextField control={form.control} name="bank" label={t("bank")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="requested"
          label={t("requested")}
          inputMode="decimal"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="approved"
          label={t("approved")}
          inputMode="decimal"
          dir="ltr"
        />
      </div>
      <SelectField
        control={form.control}
        name="status"
        label={t("status")}
        options={bankLoanStatuses.map((s) => ({ value: s, label: t(`statuses.${s}`) }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="submittedOn"
          label={t("submittedOn")}
          type="date"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="decidedOn"
          label={t("decidedOn")}
          type="date"
          dir="ltr"
        />
      </div>
      <TextField control={form.control} name="reference" label={t("reference")} />
      <TextareaField control={form.control} name="notes" label={t("notes")} rows={2} />
    </FormDialog>
  );
}
