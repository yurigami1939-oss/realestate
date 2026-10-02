import "server-only";

import { AppError, err, ok, type ErrorCode } from "@/lib/result";

const httpStatus: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  UNEXPECTED: 500,
};

/** Maps a thrown error to its HTTP status, logging anything that is not an `AppError`. */
export function toHttpError(error: unknown): { error: AppError; status: number } {
  if (!(error instanceof AppError)) console.error("[route] unexpected error", error);
  const appError = error instanceof AppError ? error : new AppError("UNEXPECTED");
  return { error: appError, status: httpStatus[appError.code] };
}

/**
 * Runs a Route Handler body and answers the same `Result<T>` as Server Actions, as JSON,
 * with the matching HTTP status. `T` must be JSON-serializable (no bigint).
 */
export async function jsonResult<T>(run: () => Promise<T>): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(ok(await run()), { headers });
  } catch (error) {
    const failure = toHttpError(error);
    return Response.json(err(failure.error), { status: failure.status, headers });
  }
}

/**
 * Cookie-authenticated POSTs must come from our own pages (Server Actions get the same check
 * from Next.js). Browsers always send `Origin` on POST; requests without it are not from a page.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // "null" or malformed origin
  }
  if (!host || originHost !== host) throw new AppError("FORBIDDEN");
}

/**
 * Parses a multipart body without ever buffering more than `maxBytes`
 * (`request.formData()` has no limit).
 */
export async function readFormData(request: Request, maxBytes: number): Promise<FormData> {
  const tooLarge = () =>
    new AppError("VALIDATION", "files.errors.tooLarge", {
      fieldErrors: { file: ["files.errors.tooLarge"] },
    });
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge();
  if (!request.body) throw new AppError("VALIDATION");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new AppError("VALIDATION");
  }
}
