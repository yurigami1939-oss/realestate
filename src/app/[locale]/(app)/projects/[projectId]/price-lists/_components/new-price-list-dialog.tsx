"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
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
import { FieldGroup } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { createPriceListAction } from "@/server/inventory/actions";
import { createPriceListSchema } from "@/server/inventory/schemas";

type Values = z.input<typeof createPriceListSchema>;

export function NewPriceListDialog({ projectId }: { projectId: string }) {
  const t = useTranslations("inventory.priceLists");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const create = useAction(createPriceListAction);
  const form = useForm<Values, unknown, z.output<typeof createPriceListSchema>>({
    resolver: zodResolver(createPriceListSchema),
    defaultValues: { projectId, name: "" },
  });

  async function onSubmit(values: Values) {
    await create.run(values, {
      onSuccess: ({ id }) => {
        setOpen(false);
        router.push(`/projects/${projectId}/price-lists/${id}`);
      },
      onError: (error) => applyFieldErrors(form, error),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          id="new-price-list"
          onSubmit={form.handleSubmit(() => onSubmit(form.getValues()))}
          noValidate
        >
          <FieldGroup>
            <TextField
              control={form.control}
              name="name"
              label={t("name")}
              description={t("nameHint")}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="new-price-list" disabled={create.pending}>
            {tc("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
