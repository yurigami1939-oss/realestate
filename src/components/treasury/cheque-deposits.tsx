"use client";

import { CheckCheck, FileText, Landmark } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import type { ChequeSource } from "@/lib/treasury";
import {
  clearChequeDepositAction,
  createChequeDepositAction,
} from "@/server/treasury/deposit-actions";

export type PendingChequeRow = {
  source: ChequeSource;
  paymentId: string;
  receivedOn: string;
  amount: bigint;
  chequeNumber: string | null;
  bank: string | null;
  payerName: string;
};

const keyOf = (c: { source: ChequeSource; paymentId: string }) => `${c.source}:${c.paymentId}`;

/**
 * Cheques of a bank or CCP account still to hand to the bank: ticked ones (all by default) go
 * on a numbered bordereau de remise.
 */
export function PendingCheques({
  accountId,
  cheques,
  today,
  canDeposit,
}: {
  accountId: string;
  cheques: PendingChequeRow[];
  today: string;
  canDeposit: boolean;
}) {
  const t = useTranslations("treasury.deposits");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const money = (v: bigint) => formatDZD(v, locale);
  const [picked, setPicked] = useState(() => new Set(cheques.map(keyOf)));
  const [depositedOn, setDepositedOn] = useState(today);
  const create = useAction(createChequeDepositAction);
  const chosen = cheques.filter((c) => picked.has(keyOf(c)));
  const total = chosen.reduce((sum, c) => sum + c.amount, 0n);
  const toggle = (key: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  if (cheques.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("nonePending")}</p>;
  }
  return (
    <div className="space-y-3" data-testid="pending-cheques">
      <ul className="divide-y rounded-md border text-sm">
        {cheques.map((c) => {
          const key = keyOf(c);
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-3 p-2">
              <label className="flex min-w-0 items-center gap-2">
                {canDeposit ? (
                  <Checkbox
                    checked={picked.has(key)}
                    onCheckedChange={(on) => toggle(key, on === true)}
                    aria-label={t("pick", { payer: c.payerName })}
                  />
                ) : null}
                <span className="min-w-0">
                  <span className="font-medium">{c.payerName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`source.${c.source}`)} · {formatDate(c.receivedOn)}
                    {c.bank ? ` · ${c.bank}` : ""}
                    {c.chequeNumber ? (
                      <>
                        {" · "}
                        <bdi dir="ltr">{c.chequeNumber}</bdi>
                      </>
                    ) : null}
                  </span>
                </span>
              </label>
              <span className="tabular-nums" dir="ltr">
                {money(c.amount)}
              </span>
            </li>
          );
        })}
      </ul>
      {canDeposit ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="deposited-on">{t("depositedOn")}</Label>
            <Input
              id="deposited-on"
              type="date"
              dir="ltr"
              value={depositedOn}
              max={today}
              onChange={(e) => setDepositedOn(e.target.value)}
            />
          </div>
          <Button
            disabled={chosen.length === 0 || create.pending}
            onClick={() =>
              create.run(
                {
                  accountId,
                  depositedOn,
                  cheques: chosen.map((c) => ({ source: c.source, paymentId: c.paymentId })),
                },
                {
                  onSuccess: ({ number }) => toast.success(t("created", { number })),
                },
              )
            }
          >
            <Landmark data-icon="inline-start" />
            {t("create", { count: chosen.length, total: money(total) })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The bank credited a slip: its cheques are cleared on that day. */
export function ClearDepositDialog({
  depositId,
  number,
  depositedOn,
  today,
}: {
  depositId: string;
  number: string;
  depositedOn: string;
  today: string;
}) {
  const t = useTranslations("treasury.deposits");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [clearedOn, setClearedOn] = useState(today);
  const clear = useAction(clearChequeDepositAction);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CheckCheck data-icon="inline-start" />
          {t("clear")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("clearTitle", { number })}</DialogTitle>
          <DialogDescription>{t("clearHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="cleared-on">{t("clearedOn")}</Label>
          <Input
            id="cleared-on"
            type="date"
            dir="ltr"
            value={clearedOn}
            min={depositedOn}
            max={today}
            onChange={(e) => setClearedOn(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            disabled={clear.pending}
            onClick={() =>
              clear.run(
                { depositId, clearedOn },
                {
                  onSuccess: () => {
                    toast.success(t("cleared"));
                    setOpen(false);
                  },
                },
              )
            }
          >
            {t("clear")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Link to a slip's PDF, or a note while the worker renders it. */
export function DepositPdf({ fileId, number }: { fileId: string | null; number: string }) {
  const t = useTranslations("treasury.deposits");
  if (!fileId) return <span className="text-muted-foreground">{t("pdfPending")}</span>;
  return (
    <Button asChild variant="link" size="sm" className="h-auto px-0">
      <a href={`/api/files/${fileId}`} target="_blank" rel="noopener">
        <FileText data-icon="inline-start" />
        {number}.pdf
      </a>
    </Button>
  );
}
