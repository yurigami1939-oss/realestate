"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, CircleCheck, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import {
  blockUnitAction,
  unblockUnitAction,
  updateUnitPriceAction,
} from "@/server/inventory/actions";
import { unitStatusReasonSchema, updateUnitPriceSchema } from "@/server/inventory/schemas";

type ReasonValues = z.input<typeof unitStatusReasonSchema>;

/** Block (available → blocked) or unblock (blocked → available), reason required. */
export function BlockUnitDialog({
  unitId,
  code,
  blocked,
}: {
  unitId: string;
  code: string;
  blocked: boolean;
}) {
  const t = useTranslations("inventory.units");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const run = useAction(blocked ? unblockUnitAction : blockUnitAction);
  const form = useForm<ReasonValues, unknown, z.output<typeof unitStatusReasonSchema>>({
    resolver: zodResolver(unitStatusReasonSchema),
    defaultValues: { unitId, reason: "" },
  });

  async function onSubmit(values: ReasonValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(blocked ? t("unblocked") : t("blocked"));
        setOpen(false);
        form.reset();
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          {blocked ? <CircleCheck data-icon="inline-start" /> : <Ban data-icon="inline-start" />}
          {blocked ? t("unblock") : t("block")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>
            {blocked ? t("unblockTitle", { code }) : t("blockTitle", { code })}
          </DialogTitle>
        </DialogHeader>
        <form
          id="unit-status-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <TextareaField control={form.control} name="reason" label={t("reason")} />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="unit-status-form" disabled={run.pending}>
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PriceValues = z.input<typeof updateUnitPriceSchema>;

/** One-off list-price change with a reason (price lists handle bulk changes). */
export function ChangePriceDialog({
  unitId,
  code,
  currentPrice,
}: {
  unitId: string;
  code: string;
  /** Current price in dinars as typed ("12500000,00"), or "". */
  currentPrice: string;
}) {
  const t = useTranslations("inventory.units");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const run = useAction(updateUnitPriceAction);
  const form = useForm<PriceValues, unknown, z.output<typeof updateUnitPriceSchema>>({
    resolver: zodResolver(updateUnitPriceSchema),
    defaultValues: { unitId, price: currentPrice, reason: "" },
  });

  async function onSubmit(values: PriceValues) {
    await run.run(values, {
      onSuccess: () => {
        toast.success(t("priceChanged"));
        setOpen(false);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Tag data-icon="inline-start" />
          {t("changePrice")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("changePriceTitle", { code })}</DialogTitle>
        </DialogHeader>
        <form
          id="unit-price-form"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <TextField
              control={form.control}
              name="price"
              label={t("newPrice")}
              inputMode="decimal"
              dir="ltr"
            />
            <TextareaField control={form.control} name="reason" label={t("reason")} rows={2} />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="unit-price-form" disabled={run.pending}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
