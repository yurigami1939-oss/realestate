"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { SelectField } from "@/components/forms/fields";
import { FormDialog } from "@/components/forms/form-dialog";
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
} from "@/components/ui/dialog";
import { leadSources } from "@/lib/crm";
import { createCaptureKeyAction } from "@/server/crm/capture-actions";
import { createCaptureKeySchema } from "@/server/crm/schemas";

/** A new capture key; the key itself is shown once, with how to call the endpoint. */
export function CreateCaptureKeyDialog({
  endpoint,
  projects,
}: {
  endpoint: string;
  projects: { id: string; name: string }[];
}) {
  const t = useTranslations("capture");
  const ts = useTranslations("crm.source");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const create = useAction(createCaptureKeyAction);
  const form = useForm<
    z.input<typeof createCaptureKeySchema>,
    unknown,
    z.output<typeof createCaptureKeySchema>
  >({
    resolver: zodResolver(createCaptureKeySchema),
    defaultValues: { name: "", source: "website", projectId: "" },
  });
  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <Button>
            <KeyRound data-icon="inline-start" />
            {t("create")}
          </Button>
        }
        title={t("createTitle")}
        description={t("createHint")}
        submitLabel={t("create")}
        pending={create.pending}
        onSubmit={form.handleSubmit(() =>
          create.run(form.getValues(), {
            onSuccess: (data) => {
              setOpen(false);
              form.reset();
              setKey(data.key);
            },
            onError: (error) => applyFieldErrors(form, error),
          }),
        )}
      >
        <TextField control={form.control} name="name" label={t("fields.name")} />
        <SelectField
          control={form.control}
          name="source"
          label={t("fields.source")}
          options={leadSources.map((s) => ({ value: s, label: ts(s) }))}
        />
        <SelectField
          control={form.control}
          name="projectId"
          label={t("fields.project")}
          emptyLabel={t("fields.noProject")}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
      </FormDialog>
      <Dialog open={key !== null} onOpenChange={(next) => (next ? null : setKey(null))}>
        <DialogContent closeLabel={tc("close")} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("keyTitle")}</DialogTitle>
            <DialogDescription>{t("keyHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <pre
              className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs"
              dir="ltr"
              data-testid="capture-key"
            >
              {key}
            </pre>
            <p className="font-medium">{t("example")}</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs" dir="ltr">
              {`curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${key ?? ""}" \\
  -H "Content-Type: application/json" \\
  -d '{"fullName":"Karim Bensalem","phone":"0550 12 34 56","message":"F3"}'`}
            </pre>
          </div>
          <DialogFooter>
            <Button onClick={() => setKey(null)}>{t("keySaved")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
