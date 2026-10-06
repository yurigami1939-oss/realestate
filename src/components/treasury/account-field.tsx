"use client";

import { useTranslations } from "next-intl";
import type { FieldPath, FieldValues } from "react-hook-form";

import { SelectField } from "@/components/forms/fields";
import type { FormControl } from "@/components/forms/text-field";
import type { PaymentMethod } from "@/lib/sales";
import { accountKindsFor, type TreasuryAccountKind } from "@/lib/treasury";

export type AccountOption = { id: string; name: string; kind: TreasuryAccountKind };

/**
 * « Encaissé sur »: the cash desk or account a payment lands on, among those its method fits;
 * left empty, the method's default account (CLAUDE.md §7 Treasury). Hidden without accounts.
 */
export function AccountField<T extends FieldValues>({
  control,
  name,
  method,
  accounts,
}: {
  control: FormControl<T>;
  name: FieldPath<T>;
  method: PaymentMethod;
  accounts: AccountOption[];
}) {
  const t = useTranslations("treasury.fields");
  if (accounts.length === 0) return null;
  const kinds = accountKindsFor(method);
  return (
    <SelectField
      control={control}
      name={name}
      label={t("landsOn")}
      emptyLabel={t("defaultAccount")}
      options={accounts
        .filter((a) => kinds.includes(a.kind))
        .map((a) => ({ value: a.id, label: a.name }))}
    />
  );
}
