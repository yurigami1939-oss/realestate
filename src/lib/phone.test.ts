import { describe, expect, it } from "vitest";

import { formatPhone, normalizePhone, phoneSearchDigits, whatsappHref } from "./phone";

describe("phones", () => {
  it.each([
    ["0550 12 34 56", "+213550123456"],
    ["0661123456", "+213661123456"],
    ["07.70.12.34.56", "+213770123456"],
    ["021 63 45 78", "+21321634578"],
    ["+213 550 12 34 56", "+213550123456"],
    ["00213550123456", "+213550123456"],
    ["+33 6 12 34 56 78", "+33612345678"],
  ])("normalizes %s to E.164", (input, e164) => {
    expect(normalizePhone(input)).toBe(e164);
  });

  it.each(["0550 12", "0450123456", "abc", ""])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("shows Algerian numbers nationally and others internationally", () => {
    expect(formatPhone("+213550123456")).toBe("0550 12 34 56");
    expect(formatPhone("+21321634578")).toBe("021 63 45 78");
    expect(formatPhone("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(whatsappHref("+213550123456")).toBe("https://wa.me/213550123456");
  });

  it("turns a typed number into digits to search stored E.164 numbers", () => {
    expect(phoneSearchDigits("0550 12")).toBe("55012");
    expect(phoneSearchDigits("+213 770")).toBe("770");
    expect(phoneSearchDigits("00213 66")).toBeNull();
    expect(phoneSearchDigits("Karim")).toBeNull();
  });
});
