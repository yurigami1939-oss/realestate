"use client";

import { Check, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { useAction } from "@/components/forms/use-action";
import { useFloorLabel } from "@/components/inventory/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { priceForArea } from "@/lib/inventory";
import {
  adjustByBasisPoints,
  formatAmountInput,
  formatDZD,
  parseDZD,
  parsePercentToBasisPoints,
  sumCentimes,
} from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  applyPriceListAction,
  discardPriceListAction,
  setPriceListItemsAction,
} from "@/server/inventory/actions";
import type { PriceListDetail } from "@/server/inventory/queries";

type Row = PriceListDetail["rows"][number];

export function PriceListEditor({ list, editable }: { list: PriceListDetail; editable: boolean }) {
  const t = useTranslations("inventory");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const locale = useLocale() === "ar" ? "ar" : "fr";
  const floorLabel = useFloorLabel();
  const router = useRouter();
  const save = useAction(setPriceListItemsAction);
  const apply = useAction(applyPriceListAction);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      list.rows.map((r) => [r.unitId, r.price !== null ? formatAmountInput(r.price) : ""]),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [percent, setPercent] = useState("");
  const [perSqm, setPerSqm] = useState("");

  const parsed = useMemo(() => {
    const out = new Map<string, bigint | null | "invalid">();
    for (const r of list.rows) {
      const raw = values[r.unitId]?.trim() ?? "";
      out.set(r.unitId, raw === "" ? null : (parseDZD(raw) ?? "invalid"));
    }
    return out;
  }, [values, list.rows]);
  const hasInvalid = [...parsed.values()].includes("invalid");

  const setAll = (compute: (r: Row) => bigint | null) => {
    setValues((prev) => {
      const next = { ...prev };
      for (const r of list.rows) {
        const price = compute(r);
        if (price !== null) next[r.unitId] = formatAmountInput(price);
      }
      return next;
    });
    setDirty(true);
  };

  const applyPercent = () => {
    const bp = parsePercentToBasisPoints(percent);
    if (bp === null) return toast.error(tv("percent"));
    setAll((r) => (r.currentPrice !== null ? adjustByBasisPoints(r.currentPrice, bp) : null));
  };
  const applyPerSqm = () => {
    const price = parseDZD(perSqm);
    if (price === null) return toast.error(tv("amount"));
    setAll((r) => (r.livingArea ? priceForArea(price, r.livingArea) : null));
  };

  /** Saves the draft; resolves to true on success. */
  async function saveDraft(): Promise<boolean> {
    if (hasInvalid) {
      toast.error(tv("amount"));
      return false;
    }
    let ok = false;
    const items = list.rows
      .filter((r) => (values[r.unitId]?.trim() ?? "") !== "")
      .map((r) => ({ unitId: r.unitId, price: values[r.unitId] ?? "" }));
    await save.run({ priceListId: list.id, items }, { onSuccess: () => (ok = true) });
    if (ok) setDirty(false);
    return ok;
  }

  async function saveAndApply() {
    if (dirty && !(await saveDraft())) return;
    await apply.run(
      { priceListId: list.id },
      { onSuccess: ({ changed }) => toast.success(t("priceLists.applied", { changed })) },
    );
  }

  const priced = [...parsed.values()].filter((v): v is bigint => typeof v === "bigint");
  const currentTotal = sumCentimes(list.rows.map((r) => r.currentPrice ?? 0n));
  const newTotal = sumCentimes(priced);
  const buildings = [...new Set(list.rows.map((r) => r.buildingCode))];

  return (
    <div className="space-y-4">
      {editable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("priceLists.bulk.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="bulk-percent">{t("priceLists.bulk.percent")}</Label>
                <Input
                  id="bulk-percent"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  dir="ltr"
                  inputMode="decimal"
                />
              </div>
              <Button variant="outline" onClick={applyPercent}>
                {t("priceLists.bulk.applyPercent")}
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="bulk-sqm">{t("priceLists.bulk.perSqm")}</Label>
                <Input
                  id="bulk-sqm"
                  value={perSqm}
                  onChange={(e) => setPerSqm(e.target.value)}
                  dir="ltr"
                  inputMode="decimal"
                />
              </div>
              <Button variant="outline" onClick={applyPerSqm}>
                {t("priceLists.bulk.applyPerSqm")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t("priceLists.readOnly")}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="price-list-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t("priceLists.columns.unit")}</TableHead>
              <TableHead>{t("priceLists.columns.floor")}</TableHead>
              <TableHead>{t("priceLists.columns.typology")}</TableHead>
              <TableHead>{t("priceLists.columns.area")}</TableHead>
              <TableHead className="text-end">{t("priceLists.columns.current")}</TableHead>
              <TableHead className="w-48">{t("priceLists.columns.new")}</TableHead>
              <TableHead className="text-end">{t("priceLists.columns.change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buildings.map((code) => (
              <Fragment key={code}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={7} className="py-1.5 text-xs font-semibold" dir="ltr">
                    {code}
                  </TableCell>
                </TableRow>
                {list.rows
                  .filter((r) => r.buildingCode === code)
                  .map((r) => {
                    const next = parsed.get(r.unitId);
                    const change =
                      typeof next === "bigint" && r.currentPrice && r.currentPrice > 0n
                        ? Number(((next - r.currentPrice) * 10_000n) / r.currentPrice) / 100
                        : null;
                    return (
                      <TableRow key={r.unitId}>
                        <TableCell className="font-medium" dir="ltr">
                          {r.code}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{floorLabel(r.floor)}</TableCell>
                        <TableCell>{r.typology ?? t(`unitType.${r.type}`)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.livingArea ? `${r.livingArea.replace(".", ",")} m²` : "—"}
                        </TableCell>
                        <TableCell className="text-end whitespace-nowrap" dir="ltr">
                          {r.currentPrice !== null ? formatDZD(r.currentPrice, locale) : "—"}
                        </TableCell>
                        <TableCell>
                          {editable ? (
                            <Input
                              aria-label={`${t("priceLists.columns.new")} ${r.code}`}
                              value={values[r.unitId] ?? ""}
                              onChange={(e) => {
                                setValues((prev) => ({ ...prev, [r.unitId]: e.target.value }));
                                setDirty(true);
                              }}
                              aria-invalid={next === "invalid"}
                              className={cn("h-8", next === "invalid" && "border-destructive")}
                              dir="ltr"
                              inputMode="decimal"
                            />
                          ) : (
                            <span dir="ltr">
                              {typeof next === "bigint" ? formatDZD(next, locale) : "—"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-end whitespace-nowrap",
                            change !== null && change > 0 && "text-emerald-700",
                            change !== null && change < 0 && "text-rose-700",
                          )}
                          dir="ltr"
                        >
                          {change !== null && change !== 0
                            ? `${change > 0 ? "+" : ""}${change.toFixed(2)} %`
                            : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </Fragment>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>{t("priceLists.items", { count: priced.length })}</TableCell>
              <TableCell className="text-end whitespace-nowrap" dir="ltr">
                {formatDZD(currentTotal, locale)}
              </TableCell>
              <TableCell className="whitespace-nowrap" dir="ltr">
                {formatDZD(newTotal, locale)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void saveDraft().then((ok) => ok && toast.success(t("priceLists.saved")))
            }
            disabled={save.pending || !dirty}
          >
            {t("priceLists.save")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={hasInvalid || save.pending || apply.pending}>
                <Check data-icon="inline-start" />
                {t("priceLists.apply")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("priceLists.applyTitle", { name: list.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>{t("priceLists.applyDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void saveAndApply()}>
                  {t("priceLists.apply")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <ConfirmAction
            action={discardPriceListAction}
            input={{ priceListId: list.id }}
            label={t("priceLists.discard")}
            icon={<Trash2 data-icon="inline-start" />}
            title={t("priceLists.discard")}
            description={t("priceLists.discardDescription")}
            confirmLabel={t("priceLists.discard")}
            successMessage={t("priceLists.discarded")}
            redirectTo={`/projects/${list.projectId}/price-lists`}
            variant="ghost"
            destructive
          />
          {dirty ? (
            <span className="self-center text-sm text-muted-foreground">
              {t("priceLists.unsaved")}
            </span>
          ) : null}
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => router.push(`/projects/${list.projectId}/price-lists`)}
        >
          {tc("back")}
        </Button>
      )}
    </div>
  );
}
