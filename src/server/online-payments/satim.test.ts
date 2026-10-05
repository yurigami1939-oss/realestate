import { afterEach, describe, expect, it, vi } from "vitest";

import { satimConfirm, satimRegister, SatimUnavailableError } from "./satim";

const account = {
  baseUrl: "https://satim.example.test/payment/rest",
  username: "merchant",
  password: "secret",
  terminalId: "E010900001",
};

/** The gateway answers this JSON (or this status) to the next call. */
function answer(body: unknown, status = 200) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("SATIM client", () => {
  it("registers with the merchant's terminal, in centimes and DZD, credentials in the body", async () => {
    const calls = answer({
      orderId: "V721uPPf",
      formUrl: "https://pay.example/main.html",
      errorCode: 0,
    });
    const result = await satimRegister(account, {
      orderNumber: "0123456789",
      amount: 1_234_56n,
      returnUrl: "https://app.example/back",
      failUrl: "https://app.example/back",
      description: "Résidence · A-03-01",
      language: "ar",
    });
    expect(result).toEqual({
      ok: true,
      orderId: "V721uPPf",
      formUrl: "https://pay.example/main.html",
    });
    expect(calls[0]?.url).toBe("https://satim.example.test/payment/rest/register.do");
    const sent = new URLSearchParams(calls[0]?.body);
    expect(Object.fromEntries(sent)).toMatchObject({
      userName: "merchant",
      password: "secret",
      orderNumber: "0123456789",
      amount: "123456",
      currency: "012",
      language: "AR",
    });
    expect(JSON.parse(sent.get("jsonParams") ?? "{}")).toEqual({
      force_terminal_id: "E010900001",
      udf1: "0123456789",
    });
  });

  it("reports a refusal with SATIM's code and message", async () => {
    answer({ errorCode: "1", errorMessage: "Order number already registered" });
    const result = await satimRegister(account, {
      orderNumber: "0123456789",
      amount: 5_000n,
      returnUrl: "https://app.example/back",
      failUrl: "https://app.example/back",
      description: "",
      language: "fr",
    });
    expect(result).toEqual({ ok: false, code: "1", message: "Order number already registered" });
  });

  it("reads paid, declined and open orders", async () => {
    answer({
      OrderStatus: 2,
      ErrorCode: "0",
      Amount: 500000,
      approvalCode: "657869",
      Pan: "628058**1011",
      params: { respCode: "00", respCode_desc: "Votre paiement a été accepté" },
    });
    expect(await satimConfirm(account, "V721", "fr")).toMatchObject({
      outcome: "paid",
      amount: 500000n,
      approvalCode: "657869",
      message: "Votre paiement a été accepté",
    });
    answer({ OrderStatus: 6, ErrorCode: "0", actionCodeDescription: "Carte refusée" });
    expect(await satimConfirm(account, "V721", "fr")).toMatchObject({
      outcome: "declined",
      message: "Carte refusée",
    });
    answer({ ErrorCode: "6", ErrorMessage: "Unregistered orderId" });
    expect(await satimConfirm(account, "V721", "fr")).toMatchObject({ outcome: "declined" });
    answer({ OrderStatus: 0, ErrorCode: "0" });
    expect(await satimConfirm(account, "V721", "fr")).toMatchObject({
      outcome: "open",
      message: null,
    });
  });

  it("treats an HTTP error or a non-JSON answer as unavailable", async () => {
    answer({}, 502);
    await expect(satimConfirm(account, "V721", "fr")).rejects.toBeInstanceOf(SatimUnavailableError);
    vi.stubGlobal("fetch", async () => new Response("<html>maintenance</html>"));
    await expect(satimConfirm(account, "V721", "fr")).rejects.toBeInstanceOf(SatimUnavailableError);
  });
});
