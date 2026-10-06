"use client";

import { Check, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { closePortalRequestAction } from "@/server/requests/actions";

/** Staff answer a portal request: done, or declined with an answer the buyer reads. */
export function CloseRequestDialog({ requestId }: { requestId: string }) {
  const t = useTranslations("requests");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const close = useAction(closePortalRequestAction);
  const submit = (outcome: "done" | "declined") =>
    close.run(
      { requestId, outcome, answer },
      {
        onSuccess: () => {
          toast.success(t(outcome === "done" ? "markedDone" : "markedDeclined"));
          setOpen(false);
        },
      },
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t("answer")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("answerTitle")}</DialogTitle>
          <DialogDescription>{t("answerHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="request-answer">{t("fields.answer")}</Label>
          <Textarea
            id="request-answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={close.pending || answer.trim() === ""}
            onClick={() => submit("declined")}
          >
            <X data-icon="inline-start" />
            {t("decline")}
          </Button>
          <Button disabled={close.pending} onClick={() => submit("done")}>
            <Check data-icon="inline-start" />
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
