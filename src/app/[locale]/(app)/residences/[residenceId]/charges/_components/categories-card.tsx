import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteChargeCategoryAction } from "@/server/charges/actions";
import type { ChargeCategoryRow, ChargesSetup } from "@/server/charges/queries";

import { CategoryDialog } from "./category-dialog";

/** Charge categories of a residence with their distribution key. */
export function CategoriesCard({ setup, editable }: { setup: ChargesSetup; editable: boolean }) {
  const t = useTranslations("charges");
  const keyLabel = (c: ChargeCategoryRow) => {
    const weighting = t(`weightingInline.${c.weighting}`);
    switch (c.key) {
      case "share":
      case "equal":
        return t(`keyDescription.${c.key}`);
      case "per_building":
        return t("keyDescription.per_building", { building: c.buildingCode ?? "—", weighting });
      case "custom":
        return t("keyDescription.custom", { count: c.unitIds.length, weighting });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t("categories.title")}</CardTitle>
        {editable ? (
          <CategoryDialog
            residenceId={setup.residence.id}
            buildings={setup.buildings}
            units={setup.units}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {setup.categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("categories.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table data-testid="charge-categories">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("categories.columns.name")}</TableHead>
                  <TableHead>{t("categories.columns.key")}</TableHead>
                  {editable ? (
                    <TableHead>
                      <span className="sr-only">{t("categories.columns.actions")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {setup.categories.map((c) => (
                  <TableRow key={c.id} data-category={c.name}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{c.name}</div>
                      {c.nameAr ? (
                        <div className="text-xs text-muted-foreground">
                          <bdi lang="ar">{c.nameAr}</bdi>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">{keyLabel(c)}</TableCell>
                    {editable ? (
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <CategoryDialog
                            residenceId={setup.residence.id}
                            category={c}
                            buildings={setup.buildings}
                            units={setup.units}
                          />
                          <ConfirmAction
                            action={deleteChargeCategoryAction}
                            input={{ categoryId: c.id }}
                            label={t("categories.delete")}
                            icon={<Trash2 data-icon="inline-start" />}
                            variant="ghost"
                            destructive
                            title={t("categories.deleteTitle", { name: c.name })}
                            description={t("categories.deleteDescription")}
                            confirmLabel={t("categories.delete")}
                            successMessage={t("categories.deleted")}
                          />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
