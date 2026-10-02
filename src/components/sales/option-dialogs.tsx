"use client";

import { Hand } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { placeOptionAction } from "@/server/sales/actions";

export type OptionUnitChoice = { id: string; code: string; projectName: string };
export type OptionLeadChoice = { id: string; fullName: string; phone: string };

/**
 * Places an option: the unit is fixed (unit sheet) and the lead chosen, or the lead is fixed
 * (lead sheet) and the unit chosen among available units.
 */
export function PlaceOptionDialog({
  unitId,
  units = [],
  leadId,
  leads = [],
  optionHours,
}: {
  unitId?: string;
  units?: OptionUnitChoice[];
  leadId?: string;
  leads?: OptionLeadChoice[];
  optionHours: number;
}) {
  const t = useTranslations("sales.options");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [chosenUnit, setChosenUnit] = useState(unitId ?? "");
  const [chosenLead, setChosenLead] = useState(leadId ?? "");
  const place = useAction(placeOptionAction);
  const projects = [...new Set(units.map((u) => u.projectName))];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Hand data-icon="inline-start" />
          {t("place")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("placeTitle")}</DialogTitle>
          <DialogDescription>{t("hint", { hours: optionHours })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {unitId ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="option-unit">{t("unit")}</Label>
              <Select value={chosenUnit || undefined} onValueChange={setChosenUnit}>
                <SelectTrigger id="option-unit" className="w-full">
                  <SelectValue placeholder={t("unit")} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((name) => (
                    <SelectGroup key={name}>
                      <SelectLabel>{name}</SelectLabel>
                      {units
                        .filter((u) => u.projectName === name)
                        .map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.code}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {leadId ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="option-lead">{t("lead")}</Label>
              <Select value={chosenLead || undefined} onValueChange={setChosenLead}>
                <SelectTrigger id="option-lead" className="w-full">
                  <SelectValue placeholder={t("lead")} />
                </SelectTrigger>
                <SelectContent>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.fullName} · {formatPhone(l.phone)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!chosenUnit || !chosenLead || place.pending}
            onClick={() =>
              void place.run(
                { unitId: chosenUnit, leadId: chosenLead },
                {
                  onSuccess: ({ expiresAt }) => {
                    toast.success(t("placed", { date: formatDateTime(new Date(expiresAt)) }));
                    setOpen(false);
                  },
                },
              )
            }
          >
            {t("place")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
