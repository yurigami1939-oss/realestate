import { describe, expect, it } from "vitest";

import {
  isStopReply,
  templateParam,
  templateParamCount,
  whatsappKinds,
  whatsappNumber,
  whatsappTemplates,
} from "./whatsapp";

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

describe("WhatsApp templates", () => {
  it.each(whatsappKinds)(
    "%s: same placeholders in both languages, in order, never at an end",
    (kind) => {
      const template = whatsappTemplates[kind];
      expect(template.name).toMatch(/^[a-z0-9_]+$/);
      const count = templateParamCount(template);
      const expected = Array.from({ length: count }, (_, i) => i + 1);
      expect(placeholders(template.fr)).toEqual(expected);
      expect([...new Set(placeholders(template.ar))].sort((a, b) => a - b)).toEqual(expected);
      for (const text of [template.fr, template.ar]) {
        expect(text.trim()).not.toMatch(/^\{\{|\}\}$/);
        expect(text.length).toBeLessThan(1024);
      }
    },
  );
});

describe("WhatsApp numbers and parameters", () => {
  it("keeps mobiles and foreign numbers, never landlines or malformed ones", () => {
    expect(whatsappNumber("+213661501234")).toBe("213661501234");
    expect(whatsappNumber("+213550123456")).toBe("213550123456");
    expect(whatsappNumber("+213770123456")).toBe("213770123456");
    expect(whatsappNumber("+33612345678")).toBe("33612345678");
    expect(whatsappNumber("+21321634578")).toBeNull();
    expect(whatsappNumber("0661501234")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it("flattens parameters (no line breaks, tabs or runs of spaces) and caps their length", () => {
    expect(templateParam("Coupure\n\td'eau    jeudi ")).toBe("Coupure d'eau jeudi");
    expect(templateParam("x".repeat(300))).toHaveLength(200);
  });

  it("reads « STOP » in French and Arabic", () => {
    expect(isStopReply(" Stop ")).toBe(true);
    expect(isStopReply("ARRÊT.")).toBe(true);
    expect(isStopReply("توقف")).toBe(true);
    expect(isStopReply("Merci")).toBe(false);
  });
});
