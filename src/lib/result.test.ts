import { describe, expect, it } from "vitest";

import { AppError, err, ok } from "./result";

describe("Result / AppError", () => {
  it("defaults the message key from the code", () => {
    expect(new AppError("FORBIDDEN").toShape()).toEqual({
      code: "FORBIDDEN",
      messageKey: "errors.FORBIDDEN",
    });
  });

  it("wraps success and failure", () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    const failure = err(
      new AppError("VALIDATION", "errors.VALIDATION", { fieldErrors: { name: ["required"] } }),
    );
    expect(failure).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        messageKey: "errors.VALIDATION",
        fieldErrors: { name: ["required"] },
      },
    });
  });
});
