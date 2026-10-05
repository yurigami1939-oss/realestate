"use client";

import { Download, Ruler } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { useTranslateKey } from "@/components/forms/text-field";
import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  distributeSharesByAreaAction,
  importSaleBuyersAction,
  saveSharesAction,
} from "@/server/residences/actions";
import type { PortalAccess } from "@/server/portal/invitations";
import type { ResidenceDetail, UnitResident } from "@/server/residences/queries";

import { UnitResidents } from "./unit-residents";

/** Units of the residence: tantièmes (edited as a whole), current co-owners and occupants. */
export function SharesEditor({
  residence,
  history,
  editable,
  today,
  portal,
}: {
  residence: ResidenceDetail;
  history: UnitResident[];
  editable: boolean;
  today: string;
  portal: { access: Record<string, PortalAccess>; editable: boolean };
}) {
  const t = useTranslations("residences");
  const translate = useTranslateKey();
  const save = useAction(saveSharesAction);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(residence.units.map((u) => [u.unitId, String(u.share)])),
  );
  const total = Object.values(values).reduce((sum, v) => sum + (Number.parseInt(v, 10) || 0), 0);
  const balanced = total === residence.shareBasis;

  return (
    <div className="space-y-3">
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <ConfirmAction
            action={distributeSharesByAreaAction}
            input={{ residenceId: residence.id }}
            label={t("shares.byArea")}
            icon={<Ruler data-icon="inline-start" />}
            title={t("shares.byAreaTitle")}
            description={t("shares.byAreaDescription", { basis: residence.shareBasis })}
            confirmLabel={t("shares.byArea")}
            successMessage={t("shares.saved")}
          />
          <ConfirmAction
            action={importSaleBuyersAction}
            input={{ residenceId: residence.id }}
            label={t("import.open")}
            icon={<Download data-icon="inline-start" />}
            title={t("import.title")}
            description={t("import.description")}
            confirmLabel={t("import.submit")}
            successMessage={({ units, coOwners }) => t("import.done", { units, coOwners })}
          />
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="residence-units">
          <TableHeader>
            <TableRow>
              <TableHead>{t("units.unit")}</TableHead>
              <TableHead className="text-end">{t("units.area")}</TableHead>
              <TableHead className="w-32">{t("units.share")}</TableHead>
              <TableHead>{t("units.coOwners")}</TableHead>
              <TableHead>{t("units.occupant")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("units.residents")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {residence.units.map((u) => {
              const coOwners = u.residents.filter((r) => r.kind === "co_owner");
              const occupants = u.residents.filter((r) => r.kind === "occupant");
              const area = u.livingArea ?? u.usableArea;
              return (
                <TableRow key={u.unitId} data-unit={u.code}>
                  <TableCell>
                    <span className="font-medium" dir="ltr">
                      {u.code}
                    </span>
                    {u.typology ? (
                      <span className="text-muted-foreground"> · {u.typology}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {area ? `${area.replace(".", ",")} m²` : "—"}
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Input
                        value={values[u.unitId] ?? ""}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [u.unitId]: e.target.value }))
                        }
                        inputMode="numeric"
                        dir="ltr"
                        className="h-8 w-24"
                        aria-label={t("units.shareOf", { code: u.code })}
                      />
                    ) : (
                      <span className="tabular-nums">{u.share}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {coOwners.length === 0 ? (
                      <Badge variant="outline" className="text-amber-800">
                        {t("units.noCoOwner")}
                      </Badge>
                    ) : (
                      coOwners.map((r) => `${r.lastName} ${r.firstName}`).join(", ")
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {occupants.map((r) => `${r.lastName} ${r.firstName}`).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <UnitResidents
                      residenceId={residence.id}
                      unitId={u.unitId}
                      code={u.code}
                      history={history.filter((r) => r.unitId === u.unitId)}
                      editable={editable}
                      today={today}
                      portal={portal}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>{t("units.total")}</TableCell>
              <TableCell
                className={cn("tabular-nums", !balanced && "text-amber-800")}
                dir="ltr"
                data-testid="shares-total"
              >
                {total} / {residence.shareBasis}
              </TableCell>
              <TableCell colSpan={3} className="text-sm font-normal text-muted-foreground">
                {balanced ? null : t("shares.unbalanced", { basis: residence.shareBasis })}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      {editable ? (
        <Button
          disabled={save.pending}
          onClick={() =>
            void save.run(
              {
                residenceId: residence.id,
                shares: residence.units.map((u) => ({
                  unitId: u.unitId,
                  share: values[u.unitId] ?? "0",
                })),
              },
              {
                onSuccess: ({ changed }) =>
                  toast.success(t("shares.savedCount", { count: changed })),
                onError: (error) => {
                  const key = Object.values(error.fieldErrors ?? {})[0]?.[0];
                  toast.error(translate(key ?? error.messageKey));
                  return true;
                },
              },
            )
          }
        >
          {t("shares.save")}
        </Button>
      ) : null}
    </div>
  );
}
