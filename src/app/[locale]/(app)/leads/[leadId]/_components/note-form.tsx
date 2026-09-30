"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addLeadNoteAction } from "@/server/crm/actions";

export function NoteForm({ leadId }: { leadId: string }) {
  const t = useTranslations("crm.leads");
  const [note, setNote] = useState("");
  const run = useAction(addLeadNoteAction);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (note.trim() === "") return;
        void run.run(
          { leadId, note },
          {
            onSuccess: () => {
              setNote("");
              toast.success(t("noteAdded"));
            },
          },
        );
      }}
    >
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("notePlaceholder")}
        aria-label={t("addNote")}
        rows={2}
        maxLength={2000}
      />
      <Button type="submit" size="sm" disabled={run.pending || note.trim() === ""}>
        {t("addNote")}
      </Button>
    </form>
  );
}
