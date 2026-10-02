import { describe, expect, it } from "vitest";

import { cleanFileName, contentDisposition, formatFileSize, sniffContentType } from "./files";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

describe("sniffContentType", () => {
  it.each([
    ["application/pdf", bytes("%PDF-1.7\n")],
    ["image/png", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)],
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")],
  ])("recognizes %s from its magic bytes", (type, data) => {
    expect(sniffContentType(data)).toBe(type);
  });

  it.each([
    ["text", bytes("hello")],
    ["svg (scriptable)", bytes("<svg xmlns=")],
    ["zip / docx", bytes("PK", 3, 4)],
    ["RIFF but not WebP", bytes("RIFF", 0, 0, 0, 0, "WAVE")],
    ["empty", bytes()],
    ["truncated PNG", bytes(0x89, "PN")],
  ])("rejects %s", (_, data) => {
    expect(sniffContentType(data)).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("drops paths and control characters", () => {
    expect(cleanFileName("C:\\plans\\bloc A/plan\u0000 F3.pdf")).toBe("plan F3.pdf");
    expect(cleanFileName("plan\u202Efdp.exe")).toBe("planfdp.exe");
    expect(cleanFileName("..")).toBe("file");
    expect(cleanFileName("   ")).toBe("file");
  });

  it("keeps Arabic names and the extension when trimming", () => {
    expect(cleanFileName("مخطط الشقة.pdf")).toBe("مخطط الشقة.pdf");
    const long = `${"a".repeat(300)}.pdf`;
    expect(cleanFileName(long)).toHaveLength(200);
    expect(cleanFileName(long).endsWith(".pdf")).toBe(true);
  });
});

describe("contentDisposition", () => {
  it("gives an ASCII fallback and the UTF-8 name", () => {
    expect(contentDisposition("attachment", "plan A-03.pdf")).toBe(
      `attachment; filename="plan A-03.pdf"; filename*=UTF-8''plan%20A-03.pdf`,
    );
    expect(contentDisposition("inline", 'مخطط "1".pdf')).toBe(
      `inline; filename="____ _1_.pdf"; filename*=UTF-8''%D9%85%D8%AE%D8%B7%D8%B7%20%221%22.pdf`,
    );
  });
});

describe("formatFileSize", () => {
  it("uses the largest fitting unit with Latin digits", () => {
    expect(formatFileSize(512, "fr")).toMatch(/^512\so$/);
    expect(formatFileSize(1536, "fr")).toMatch(/^1,5\sko$/);
    expect(formatFileSize(20 * 1024 * 1024, "fr")).toMatch(/^20\sMo$/);
    expect(formatFileSize(1536 * 1024, "ar")).toMatch(/^1[.,٫]5/);
  });
});
