export const errorCodes = [
  "VALIDATION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_TRANSITION",
  "UNEXPECTED",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

/** Serializable error returned to the client by Server Actions. */
export type AppErrorShape = {
  code: ErrorCode;
  /** next-intl key, e.g. `errors.FORBIDDEN`. */
  messageKey: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, string | number | boolean | null>;
};

/** Thrown by services; converted to a `Result` by `defineAction`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly fieldErrors?: AppErrorShape["fieldErrors"];
  readonly details?: AppErrorShape["details"];

  constructor(
    code: ErrorCode,
    messageKey: string = `errors.${code}`,
    extra: Pick<AppErrorShape, "fieldErrors" | "details"> = {},
  ) {
    super(`${code}: ${messageKey}`);
    this.name = "AppError";
    this.code = code;
    this.messageKey = messageKey;
    this.fieldErrors = extra.fieldErrors;
    this.details = extra.details;
  }

  toShape(): AppErrorShape {
    return {
      code: this.code,
      messageKey: this.messageKey,
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = (error: AppError | AppErrorShape): Result<never> => ({
  ok: false,
  error: error instanceof AppError ? error.toShape() : error,
});
