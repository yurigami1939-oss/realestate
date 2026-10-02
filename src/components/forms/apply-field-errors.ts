import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";

import type { AppErrorShape } from "@/lib/result";

/**
 * Puts a server VALIDATION error's field messages (i18n keys) on the form, and maps known
 * error keys to a field. Returns true when the error was shown on the form.
 */
export function applyFieldErrors<T extends FieldValues>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- any context/output types
  form: UseFormReturn<T, any, any>,
  error: AppErrorShape,
  keyToField: Record<string, FieldPath<T>> = {},
): boolean {
  const field = keyToField[error.messageKey];
  if (field) {
    form.setError(field, { message: error.messageKey });
    return true;
  }
  const entries = Object.entries(error.fieldErrors ?? {});
  for (const [name, messages] of entries) {
    form.setError(name as FieldPath<T>, { message: messages[0] ?? "errors.VALIDATION" });
  }
  return entries.length > 0;
}
