"use client";

import { Controller, type FieldPath, type FieldValues } from "react-hook-form";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { type FormControl, useTranslateKey } from "./text-field";

type BaseProps<T extends FieldValues> = {
  control: FormControl<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
};

export type Option = { value: string; label: string };

/** Radix Select reserves "" — this sentinel stands for "no value". */
const NONE = "__none__";

function ErrorMessage({ message }: { message?: string }) {
  const translate = useTranslateKey();
  return message ? <FieldError errors={[{ message: translate(message) }]} /> : null;
}

/** Select bound to a string field. With `emptyLabel`, the field can be cleared to "". */
export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
  emptyLabel,
}: BaseProps<T> & { options: Option[]; emptyLabel?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Select
            name={field.name}
            value={field.value ? String(field.value) : emptyLabel ? NONE : ""}
            onValueChange={(value) => field.onChange(value === NONE ? "" : value)}
          >
            <SelectTrigger id={field.name} aria-invalid={fieldState.invalid} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {emptyLabel ? <SelectItem value={NONE}>{emptyLabel}</SelectItem> : null}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <ErrorMessage message={fieldState.error?.message} />
        </Field>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  rows = 3,
  dir,
}: BaseProps<T> & { rows?: number; dir?: "ltr" | "rtl" }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Textarea
            id={field.name}
            rows={rows}
            dir={dir}
            aria-invalid={fieldState.invalid}
            {...field}
            value={field.value ?? ""}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          <ErrorMessage message={fieldState.error?.message} />
        </Field>
      )}
    />
  );
}

/** Single checkbox bound to a boolean field. */
export function CheckboxField<T extends FieldValues>({ control, name, label }: BaseProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Checkbox
            id={field.name}
            checked={Boolean(field.value)}
            onCheckedChange={(checked) => field.onChange(checked === true)}
          />
          <FieldLabel htmlFor={field.name} className="font-normal">
            {label}
          </FieldLabel>
        </Field>
      )}
    />
  );
}

/** Several checkboxes bound to a string[] field. */
export function CheckboxGroupField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  columns = 2,
}: BaseProps<T> & { options: Option[]; columns?: 2 | 4 }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value: string[] = Array.isArray(field.value) ? field.value : [];
        return (
          <FieldSet data-invalid={fieldState.invalid}>
            <FieldLegend variant="label">{label}</FieldLegend>
            <div
              className={
                columns === 4
                  ? "grid grid-cols-2 gap-2 sm:grid-cols-4"
                  : "grid gap-2 sm:grid-cols-2"
              }
            >
              {options.map((o) => (
                <Field key={o.value} orientation="horizontal">
                  <Checkbox
                    id={`${field.name}-${o.value}`}
                    checked={value.includes(o.value)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked ? [...value, o.value] : value.filter((v) => v !== o.value),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`${field.name}-${o.value}`} className="font-normal">
                    {o.label}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            <ErrorMessage message={fieldState.error?.message} />
          </FieldSet>
        );
      }}
    />
  );
}
