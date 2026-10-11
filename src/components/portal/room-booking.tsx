"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { cancelPortalBookingAction, requestPortalBookingAction } from "@/server/rooms/actions";
import { portalBookingSchema } from "@/server/rooms/schemas";

type Values = z.input<typeof portalBookingSchema>;

/** A resident books a common room of its residence: a day, a slot within the room's hours. */
export function PortalBookingDialog({
  room,
  today,
}: {
  room: { id: string; name: string };
  today: string;
}) {
  const t = useTranslations("rooms");
  const tp = useTranslations("portal.rooms");
  const [open, setOpen] = useState(false);
  const book = useAction(requestPortalBookingAction);
  const form = useForm<Values, unknown, z.output<typeof portalBookingSchema>>({
    resolver: zodResolver(portalBookingSchema),
    defaultValues: { roomId: room.id, day: today, from: "", to: "", purpose: "", guests: "" },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm">
          <CalendarPlus data-icon="inline-start" />
          {t("book")}
        </Button>
      }
      title={t("bookTitle", { room: room.name })}
      submitLabel={t("book")}
      pending={book.pending}
      onSubmit={form.handleSubmit(() =>
        book.run(form.getValues(), {
          onSuccess: ({ status }) => {
            toast.success(status === "approved" ? tp("approved") : tp("requested"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          control={form.control}
          name="day"
          label={t("fields.day")}
          type="date"
          min={today}
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="from"
          label={t("fields.from")}
          type="time"
          dir="ltr"
        />
        <TextField control={form.control} name="to" label={t("fields.to")} type="time" dir="ltr" />
      </div>
      <TextField control={form.control} name="purpose" label={t("fields.purpose")} />
      <TextField
        control={form.control}
        name="guests"
        label={t("fields.guests")}
        inputMode="numeric"
        dir="ltr"
      />
    </FormDialog>
  );
}

export function CancelMyBookingButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("rooms");
  return (
    <ConfirmAction
      action={cancelPortalBookingAction}
      input={{ bookingId }}
      label={t("cancel")}
      title={t("cancelTitle")}
      description={t("cancelDescription")}
      confirmLabel={t("cancel")}
      successMessage={t("cancelled")}
      variant="ghost"
      size="sm"
      destructive
    />
  );
}
