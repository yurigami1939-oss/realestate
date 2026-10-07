import { describe, expect, it } from "vitest";

import { wilayas } from "./wilayas";

describe("wilayas", () => {
  it("lists the 58 wilayas once each, numbered 01 to 58, in both languages", () => {
    expect(wilayas.map((w) => w.code)).toEqual(
      Array.from({ length: 58 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
    expect(new Set(wilayas.map((w) => w.fr)).size).toBe(58);
    expect(new Set(wilayas.map((w) => w.ar)).size).toBe(58);
    expect(wilayas.find((w) => w.code === "16")).toEqual({
      code: "16",
      fr: "Alger",
      ar: "الجزائر",
    });
  });
});
