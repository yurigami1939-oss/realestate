import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/result";

import { assertSameOrigin, jsonResult, readFormData } from "./route-handler";

const post = (headers: Record<string, string>, body?: BodyInit) =>
  new Request("http://localhost:3000/api/files", { method: "POST", headers, body });

describe("assertSameOrigin", () => {
  it("accepts same-origin and origin-less requests", () => {
    expect(() =>
      assertSameOrigin(post({ host: "localhost:3000", origin: "http://localhost:3000" })),
    ).not.toThrow();
    expect(() => assertSameOrigin(post({ host: "localhost:3000" }))).not.toThrow();
    expect(() =>
      assertSameOrigin(
        post({
          host: "internal:3000",
          "x-forwarded-host": "app.example.dz",
          origin: "https://app.example.dz",
        }),
      ),
    ).not.toThrow();
  });

  it.each(["https://evil.example", "null", "http://localhost:3001"])(
    "refuses origin %s",
    (origin) => {
      expect(() => assertSameOrigin(post({ host: "localhost:3000", origin }))).toThrow(AppError);
    },
  );
});

describe("readFormData", () => {
  const form = (size: number) => {
    const data = new FormData();
    data.set("purpose", "unit.floor_plan");
    data.set("file", new File([new Uint8Array(size)], "plan.pdf"));
    return data;
  };

  it("parses a multipart body under the limit", async () => {
    const request = new Request("http://localhost/api/files", { method: "POST", body: form(10) });
    const data = await readFormData(request, 1024);
    expect(data.get("purpose")).toBe("unit.floor_plan");
    expect((data.get("file") as File).size).toBe(10);
  });

  it("stops reading past the limit, with or without Content-Length", async () => {
    const declared = post({ "content-length": "5000", "content-type": "text/plain" }, "x");
    await expect(readFormData(declared, 1024)).rejects.toMatchObject({
      messageKey: "files.errors.tooLarge",
    });

    // Streamed body: no Content-Length, so the byte count decides.
    const encoded = await new Response(form(4096)).blob();
    const streamed = new Request("http://localhost/api/files", {
      method: "POST",
      headers: { "content-type": encoded.type },
      body: encoded.stream(),
      duplex: "half",
    } as RequestInit);
    await expect(readFormData(streamed, 1024)).rejects.toMatchObject({
      messageKey: "files.errors.tooLarge",
    });
  });

  it("rejects a body that is not multipart", async () => {
    await expect(
      readFormData(post({ "content-type": "application/json" }, "{}"), 1024),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("jsonResult", () => {
  it("answers Result JSON with the matching status", async () => {
    const good = await jsonResult(() => Promise.resolve({ fileId: "f" }));
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ ok: true, data: { fileId: "f" } });

    const bad = await jsonResult(() => Promise.reject(new AppError("NOT_FOUND")));
    expect(bad.status).toBe(404);
    expect(await bad.json()).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" },
    });
  });
});
