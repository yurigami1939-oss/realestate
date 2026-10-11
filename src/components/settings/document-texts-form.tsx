"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { documentTextKinds, type DocumentTexts } from "@/lib/document-texts";
import { saveDocumentTextsAction } from "@/server/organizations/actions";
import { documentTextsSchema } from "@/server/organizations/schemas";

type Values = z.input<typeof documentTextsSchema>;

/** The organization's wording per kind of document, French and Arabic. */
export function DocumentTextsForm({ current }: { current: DocumentTexts }) {
  const t = useTranslations("documentTexts");
  const save = useAction(saveDocumentTextsAction);
  const form = useForm<Values, unknown, z.output<typeof documentTextsSchema>>({
    resolver: zodResolver(documentTextsSchema),
    defaultValues: {
      texts: Object.fromEntries(
        documentTextKinds.map((kind) => [
          kind,
          { fr: current[kind]?.fr ?? "", ar: current[kind]?.ar ?? "" },
        ]),
      ),
    },
  });
  return (
    <form
      onSubmit={form.handleSubmit(() =>
        save.run(form.getValues(), {
          onSuccess: () => toast.success(t("saved")),
          onError: (error) => applyFieldErrors(form, error),
        }),
      )}
      className="space-y-4"
      noValidate
    >
      {documentTextKinds.map((kind) => (
        <Card key={kind} data-kind={kind}>
          <CardHeader>
            <CardTitle>{t(`kinds.${kind}`)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextareaField
              control={form.control}
              name={`texts.${kind}.fr`}
              label={t("fr", { document: t(`kinds.${kind}`) })}
              rows={3}
            />
            <TextareaField
              control={form.control}
              name={`texts.${kind}.ar`}
              label={t("ar", { document: t(`kinds.${kind}`) })}
              rows={3}
              dir="rtl"
            />
          </CardContent>
        </Card>
      ))}
      <Button type="submit" disabled={save.pending}>
        {t("save")}
      </Button>
    </form>
  );
}
