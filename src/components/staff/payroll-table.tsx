"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField, useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { AccountField, type AccountOption } from "@/components/treasury/account-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { formatAmountInput, formatDZD, parseDZD } from "@/lib/money";
import { chargePaymentMethods } from "@/lib/residences";
import { deletePayAction, payStaffAction, savePayAction } from "@/server/staff/actions";
import type { PayrollRow } from "@/server/staff/pay";
import { payStaffSchema } from "@/server/staff/schemas";

type PayValues = z.input<typeof payStaffSchema>;

function PayDialog({
  payId,
  month,
  today,
  accounts,
}: {
  payId: string;
  month: string;
  today: string;
  accounts: AccountOption[];
}) {
  const t = useTranslations("staff.payroll");
  const tp = useTranslations("payments");
  const [open, setOpen] = useState(false);
  const pay = useAction(payStaffAction);
  const form = useForm<PayValues, unknown, z.output<typeof payStaffSchema>>({
    resolver: zodResolver(payStaffSchema),
    defaultValues: { payId, paidOn: today, method: "cash", accountId: "" },
  });
  const method = useWatch({ control: form.control, name: "method" });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" size="sm">
          <Banknote data-icon="inline-start" />
          {t("pay")}
        </Button>
      }
      title={t("payTitle")}
      submitLabel={t("pay")}
      pending={pay.pending}
      onSubmit={form.handleSubmit(() =>
        pay.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("paid"));
            setOpen(false);
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="paidOn"
          label={t("paidOnField")}
          type="date"
          dir="ltr"
          min={month}
          max={today}
        />
        <SelectField
          control={form.control}
          name="method"
          label={tp("fields.method")}
          options={chargePaymentMethods.map((m) => ({ value: m, label: tp(`method.${m}`) }))}
        />
      </div>
      <AccountField
        control={form.control}
        name="accountId"
        method={method}
        accounts={accounts}
        outgoing
      />
    </FormDialog>
  );
}

/** One agent's pay for the month: amounts edited until paid, net computed as typed. */
function PayrollRowForm({
  row,
  month,
  editable,
  today,
  accounts,
}: {
  row: PayrollRow;
  month: string;
  editable: boolean;
  today: string;
  accounts: AccountOption[];
}) {
  const t = useTranslations("staff.payroll");
  const tr = useTranslations("staff.role");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const translate = useTranslateKey();
  const save = useAction(savePayAction);
  const money = (v: bigint) => formatDZD(v, locale);
  const pay = row.pay;
  const paid = pay?.paidOn != null;
  const [base, setBase] = useState(formatAmountInput(pay?.baseAmount ?? row.monthlySalary));
  const [bonus, setBonus] = useState(pay && pay.bonus > 0n ? formatAmountInput(pay.bonus) : "");
  const [deduction, setDeduction] = useState(
    pay && pay.deduction > 0n ? formatAmountInput(pay.deduction) : "",
  );
  const amount = (v: string) => (v.trim() === "" ? 0n : parseDZD(v));
  const parts = [amount(base), amount(bonus), amount(deduction)];
  const valid = parts.every((p) => p !== null);
  const net = valid ? (parts[0] ?? 0n) + (parts[1] ?? 0n) - (parts[2] ?? 0n) - row.advances : null;
  const input = (value: string, set: (v: string) => void, label: string) =>
    paid || !editable ? (
      <span className="tabular-nums" dir="ltr">
        {value === "" ? "—" : value}
      </span>
    ) : (
      <Input
        value={value}
        onChange={(e) => set(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        className="h-8 w-28 text-end"
        aria-label={label}
      />
    );
  const name = `${row.lastName} ${row.firstName}`;

  return (
    <tr className="border-t" data-staff={name}>
      <td className="p-2">
        <div className="font-medium">{name}</div>
        <div className="text-xs text-muted-foreground">{tr(row.role)}</div>
      </td>
      <td className="p-2 text-end tabular-nums">
        {row.workedDays}
        {row.markedDays > 0 ? (
          <div className="text-xs text-muted-foreground">
            {t("marked", { count: row.markedDays })}
          </div>
        ) : null}
      </td>
      <td className="p-2 text-end">{input(base, setBase, t("baseOf", { name }))}</td>
      <td className="p-2 text-end">{input(bonus, setBonus, t("bonusOf", { name }))}</td>
      <td className="p-2 text-end">{input(deduction, setDeduction, t("deductionOf", { name }))}</td>
      <td className="p-2 text-end tabular-nums" dir="ltr">
        {row.advances > 0n ? money(row.advances) : "—"}
      </td>
      <td className="p-2 text-end font-medium tabular-nums" dir="ltr">
        {net === null ? "—" : money(net)}
      </td>
      <td className="p-2">
        {paid && pay?.paidOn ? (
          <Badge variant="default">{t("paidOn", { date: formatDate(pay.paidOn) })}</Badge>
        ) : pay ? (
          <Badge variant="secondary">{t("recorded")}</Badge>
        ) : (
          <Badge variant="outline">{t("notRecorded")}</Badge>
        )}
      </td>
      {editable ? (
        <td className="p-2 text-end">
          {paid ? null : (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                disabled={save.pending || !valid}
                onClick={() =>
                  void save.run(
                    {
                      staffId: row.id,
                      month: month.slice(0, 7),
                      baseAmount: base,
                      bonus,
                      deduction,
                    },
                    {
                      onSuccess: () => toast.success(t("saved", { name })),
                      onError: (error) => {
                        const key = Object.values(error.fieldErrors ?? {})[0]?.[0];
                        toast.error(translate(key ?? error.messageKey));
                        return true;
                      },
                    },
                  )
                }
              >
                {t("save")}
              </Button>
              {pay ? (
                <>
                  <PayDialog payId={pay.id} month={month} today={today} accounts={accounts} />
                  <ConfirmAction
                    action={deletePayAction}
                    input={{ payId: pay.id }}
                    label={t("delete")}
                    icon={<Trash2 data-icon="inline-start" />}
                    variant="ghost"
                    destructive
                    title={t("deleteTitle", { name })}
                    description={t("deleteDescription")}
                    confirmLabel={t("delete")}
                    successMessage={t("deleted")}
                  />
                </>
              ) : null}
            </div>
          )}
        </td>
      ) : null}
    </tr>
  );
}

/** Pay sheet of a residence for a month: one editable row per agent employed that month. */
export function PayrollTable({
  rows,
  month,
  editable,
  today,
  accounts = [],
}: {
  rows: PayrollRow[];
  month: string;
  editable: boolean;
  today: string;
  /** Where pay can be paid from (« Payé depuis »). */
  accounts?: AccountOption[];
}) {
  const t = useTranslations("staff.payroll");
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm" data-testid="payroll">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="p-2 text-start font-medium">{t("columns.agent")}</th>
            <th className="p-2 text-end font-medium">{t("columns.worked")}</th>
            <th className="p-2 text-end font-medium">{t("columns.base")}</th>
            <th className="p-2 text-end font-medium">{t("columns.bonus")}</th>
            <th className="p-2 text-end font-medium">{t("columns.deduction")}</th>
            <th className="p-2 text-end font-medium">{t("columns.advances")}</th>
            <th className="p-2 text-end font-medium">{t("columns.net")}</th>
            <th className="p-2 text-start font-medium">{t("columns.state")}</th>
            {editable ? (
              <th className="p-2">
                <span className="sr-only">{t("columns.actions")}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PayrollRowForm
              key={`${row.id}:${row.pay?.id ?? "new"}:${row.pay?.netAmount ?? ""}:${row.pay?.paidOn ?? ""}`}
              row={row}
              month={month}
              editable={editable}
              today={today}
              accounts={accounts}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
