"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, CalendarPlus, Check, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { CheckboxField, TextareaField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
import { TextField } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  archiveRoomAction,
  bookRoomAction,
  cancelBookingAction,
  createRoomAction,
  decideBookingAction,
  updateRoomAction,
} from "@/server/rooms/actions";
import { createRoomSchema, decideBookingSchema, staffBookingSchema } from "@/server/rooms/schemas";

type RoomValues = Omit<z.input<typeof createRoomSchema>, "residenceId">;

const emptyRoom: RoomValues = {
  name: "",
  description: "",
  capacity: "",
  opensAt: "08:00",
  closesAt: "22:00",
  maxHours: "4",
  needsApproval: true,
};

/** A new common room of a residence, or one corrected (`roomId` and its values). */
export function RoomDialog({
  residenceId,
  roomId,
  values,
}: {
  residenceId: string;
  roomId?: string;
  values?: RoomValues;
}) {
  const t = useTranslations("rooms");
  const [open, setOpen] = useState(false);
  const create = useAction(createRoomAction);
  const update = useAction(updateRoomAction);
  const form = useForm<
    z.input<typeof createRoomSchema>,
    unknown,
    z.output<typeof createRoomSchema>
  >({
    resolver: zodResolver(createRoomSchema),
    defaultValues: { residenceId, ...(values ?? emptyRoom) },
  });
  const done = (message: string) => {
    toast.success(message);
    setOpen(false);
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        roomId ? (
          <Button variant="ghost" size="icon" className="size-8" aria-label={t("edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        )
      }
      title={roomId ? t("editTitle") : t("newTitle")}
      submitLabel={roomId ? t("save") : t("new")}
      pending={create.pending || update.pending}
      onSubmit={form.handleSubmit(() => {
        const { residenceId: _r, ...raw } = form.getValues();
        const onError = (error: Parameters<typeof applyFieldErrors>[1]) =>
          applyFieldErrors(form, error);
        if (roomId) {
          void update.run({ ...raw, roomId }, { onSuccess: () => done(t("saved")), onError });
        } else {
          void create.run(
            { ...raw, residenceId },
            {
              onSuccess: () => {
                done(t("created"));
                form.reset();
              },
              onError,
            },
          );
        }
      })}
    >
      <TextField control={form.control} name="name" label={t("fields.name")} />
      <TextareaField control={form.control} name="description" label={t("fields.description")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={form.control}
          name="opensAt"
          label={t("fields.opensAt")}
          type="time"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="closesAt"
          label={t("fields.closesAt")}
          type="time"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="maxHours"
          label={t("fields.maxHours")}
          inputMode="numeric"
          dir="ltr"
        />
        <TextField
          control={form.control}
          name="capacity"
          label={t("fields.capacity")}
          inputMode="numeric"
          dir="ltr"
        />
      </div>
      <CheckboxField
        control={form.control}
        name="needsApproval"
        label={t("fields.needsApproval")}
      />
    </FormDialog>
  );
}

export function ArchiveRoomButton({ roomId }: { roomId: string }) {
  const t = useTranslations("rooms");
  return (
    <ConfirmAction
      action={archiveRoomAction}
      input={{ roomId }}
      label={t("archive")}
      icon={<Archive />}
      title={t("archiveTitle")}
      description={t("archiveDescription")}
      confirmLabel={t("archive")}
      successMessage={t("archived")}
      variant="ghost"
      size="icon"
    />
  );
}

type SlotValues = z.input<typeof staffBookingSchema>;

/** Staff book a room for someone (approved at once). */
export function BookRoomDialog({
  roomId,
  roomName,
  today,
}: {
  roomId: string;
  roomName: string;
  today: string;
}) {
  const t = useTranslations("rooms");
  const [open, setOpen] = useState(false);
  const book = useAction(bookRoomAction);
  const form = useForm<SlotValues, unknown, z.output<typeof staffBookingSchema>>({
    resolver: zodResolver(staffBookingSchema),
    defaultValues: {
      roomId,
      day: today,
      from: "18:00",
      to: "20:00",
      purpose: "",
      guests: "",
      bookedFor: "",
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm">
          <CalendarPlus data-icon="inline-start" />
          {t("book")}
        </Button>
      }
      title={t("bookTitle", { room: roomName })}
      submitLabel={t("book")}
      pending={book.pending}
      onSubmit={form.handleSubmit(() =>
        book.run(form.getValues(), {
          onSuccess: () => {
            toast.success(t("booked"));
            setOpen(false);
            form.reset();
          },
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
    >
      <TextField control={form.control} name="bookedFor" label={t("fields.bookedFor")} />
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

/** Confirms a requested booking, or refuses it with a note the resident reads. */
export function DecideBooking({ bookingId }: { bookingId: string }) {
  const t = useTranslations("rooms");
  const [open, setOpen] = useState(false);
  const decide = useAction(decideBookingAction);
  const form = useForm<
    z.input<typeof decideBookingSchema>,
    unknown,
    z.output<typeof decideBookingSchema>
  >({
    resolver: zodResolver(decideBookingSchema),
    defaultValues: { bookingId, approve: false, note: "" },
  });
  return (
    <div className="flex flex-wrap gap-1">
      <ConfirmAction
        action={decideBookingAction}
        input={{ bookingId, approve: true, note: "" }}
        label={t("approve")}
        icon={<Check data-icon="inline-start" />}
        title={t("approve")}
        description={t("approveDescription")}
        confirmLabel={t("approve")}
        successMessage={t("decided")}
        size="sm"
      />
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button variant="ghost" size="sm">
            <X data-icon="inline-start" />
            {t("reject")}
          </Button>
        }
        title={t("rejectTitle")}
        submitLabel={t("reject")}
        pending={decide.pending}
        onSubmit={form.handleSubmit(() =>
          decide.run(
            { ...form.getValues(), approve: false },
            {
              onSuccess: () => {
                toast.success(t("decided"));
                setOpen(false);
              },
              onError: (error) => applyFieldErrors(form, error),
            },
          ),
        )}
      >
        <TextareaField control={form.control} name="note" label={t("fields.note")} />
      </FormDialog>
    </div>
  );
}

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations("rooms");
  return (
    <ConfirmAction
      action={cancelBookingAction}
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
