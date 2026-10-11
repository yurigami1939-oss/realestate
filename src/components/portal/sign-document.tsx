"use client";

import { BadgeCheck, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { formatDate } from "@/lib/dates";
import { SIGNATURE_CODE_MINUTES, type SignableDocument } from "@/lib/signatures";
import { requestSignatureCodeAction, signDocumentAction } from "@/server/signatures/actions";

import { PortalDocument } from "./portal-document";

/**
 * Signing a document from the portal (CLAUDE.md §7 Electronic signature): the document to read,
 * a one-time code e-mailed to the account, then the code typed — or the day it was signed.
 */
export function SignDocument({
  documentType,
  documentId,
  fileId,
  label,
  signedAt,
}: {
  documentType: SignableDocument;
  documentId: string;
  fileId: string | null;
  label: string;
  signedAt: Date | null;
}) {
  const t = useTranslations("signatures");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const request = useAction(requestSignatureCodeAction);
  const sign = useAction(signDocumentAction);

  if (signedAt) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-emerald-800"
        data-signed={documentType}
      >
        <BadgeCheck className="size-3.5" aria-hidden />
        {t("signedOn", { date: formatDate(signedAt) })}
      </span>
    );
  }
  if (!fileId) return null;

  const send = () =>
    request.run({ documentType, documentId }, { onSuccess: ({ email }) => setSentTo(email) });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSentTo(null);
          setCode("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PenLine data-icon="inline-start" />
          {t("sign")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("explanation")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">{t("readFirst")}</p>
          <PortalDocument fileId={fileId} label={label} />
          {sentTo ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("codeSent", { email: sentTo, minutes: SIGNATURE_CODE_MINUTES })}
              </p>
              <Field>
                <FieldLabel htmlFor={`signature-code-${documentId}`}>{t("code")}</FieldLabel>
                <Input
                  id={`signature-code-${documentId}`}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  dir="ltr"
                />
              </Field>
            </>
          ) : null}
        </div>
        <DialogFooter>
          {sentTo ? (
            <>
              <Button variant="ghost" onClick={() => void send()} disabled={request.pending}>
                {t("resend")}
              </Button>
              <Button
                disabled={sign.pending || code.trim().length !== 6}
                onClick={() =>
                  void sign.run(
                    { documentType, documentId, code },
                    {
                      onSuccess: () => {
                        toast.success(t("signed"));
                        setOpen(false);
                        router.refresh();
                      },
                    },
                  )
                }
              >
                {t("confirm")}
              </Button>
            </>
          ) : (
            <Button onClick={() => void send()} disabled={request.pending}>
              {t("sendCode")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
