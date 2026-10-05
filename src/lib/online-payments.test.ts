import { describe, expect, it } from "vitest";

import { MIN_ONLINE_PAYMENT, onlinePaymentOffer, suggestedOnlinePayment } from "./online-payments";

const lines = (...remaining: bigint[]) => remaining.map((r) => ({ remaining: r }));

describe("online payment offer", () => {
  it("suggests what is due, else the next installment still unpaid", () => {
    expect(
      suggestedOnlinePayment({ due: 3_000_00n, remaining: 9_000_00n, lines: lines(0n, 3_000_00n) }),
    ).toBe(3_000_00n);
    expect(
      suggestedOnlinePayment({
        due: 0n,
        remaining: 9_000_00n,
        lines: lines(0n, 4_000_00n, 5_000_00n),
      }),
    ).toBe(4_000_00n);
  });

  it("offers at least 50 DA, and nothing when less than that remains", () => {
    expect(onlinePaymentOffer({ due: 10_00n, remaining: 9_000_00n, lines: lines(10_00n) })).toEqual(
      {
        suggested: MIN_ONLINE_PAYMENT,
        remaining: 9_000_00n,
      },
    );
    expect(onlinePaymentOffer({ due: 0n, remaining: 49_99n, lines: lines(49_99n) })).toBeNull();
  });
});
