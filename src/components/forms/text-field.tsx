"use client";

import { useTranslations } from "next-intl";
import { type Control, Controller, type FieldPath, type FieldValues } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  /** Called after react-hook-form has recorded the new value. */
  onValueChange?: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "name" | "value" | "defaultValue" | "onChange">;

/** react-hook-form + shadcn Field. Zod messages are i18n keys, translated here. */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  onValueChange,
  ...inputProps
}: TextFieldProps<T>) {
  const translate = useTranslateKey();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Input
            id={field.name}
            aria-invalid={fieldState.invalid}
            {...inputProps}
            {...field}
            value={field.value ?? ""}
            onChange={(event) => {
              field.onChange(event);
              onValueChange?.(event.target.value);
            }}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error?.message ? (
            <FieldError errors={[{ message: translate(fieldState.error.message) }]} />
          ) : null}
        </Field>
      )}
    />
  );
}

/** Translates a key coming from data (zod messages, AppError.messageKey); unknown keys pass through. */
export function useTranslateKey() {
  const t = useTranslations();
  return (key: string): string => {
    const typedKey = key as Parameters<typeof t>[0];
    return t.has(typedKey) ? t(typedKey) : key;
  };
}
