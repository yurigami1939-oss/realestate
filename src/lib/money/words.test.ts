import { describe, expect, it } from "vitest";

import { amountInWordsAr, integerToWordsAr } from "./words-ar";
import { amountInWordsFr, integerToWordsFr } from "./words-fr";

const DA = (dinars: number, centimes = 0) => BigInt(dinars) * 100n + BigInt(centimes);

describe("integerToWordsFr", () => {
  it.each([
    [0, "zéro"],
    [1, "un"],
    [11, "onze"],
    [16, "seize"],
    [17, "dix-sept"],
    [21, "vingt et un"],
    [22, "vingt-deux"],
    [61, "soixante et un"],
    [70, "soixante-dix"],
    [71, "soixante et onze"],
    [77, "soixante-dix-sept"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [90, "quatre-vingt-dix"],
    [91, "quatre-vingt-onze"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [101, "cent un"],
    [180, "cent quatre-vingts"],
    [200, "deux cents"],
    [201, "deux cent un"],
    [1_000, "mille"],
    [1_001, "mille un"],
    [2_000, "deux mille"],
    [21_000, "vingt et un mille"],
    [80_000, "quatre-vingt mille"],
    [200_000, "deux cent mille"],
    [1_000_000, "un million"],
    [2_000_000, "deux millions"],
    [200_000_000, "deux cents millions"],
    [80_000_000, "quatre-vingts millions"],
    [1_250_000, "un million deux cent cinquante mille"],
    [3_000_000_000, "trois milliards"],
    [
      999_999_999,
      "neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf",
    ],
  ])("%i → %s", (n, expected) => {
    expect(integerToWordsFr(BigInt(n))).toBe(expected);
  });
});

describe("amountInWordsFr", () => {
  it.each([
    [DA(0), "zéro dinar algérien"],
    [DA(1), "un dinar algérien"],
    [DA(2), "deux dinars algériens"],
    [DA(1_000_000), "un million de dinars algériens"],
    [DA(2_000_000), "deux millions de dinars algériens"],
    [
      DA(1_250_000, 50),
      "un million deux cent cinquante mille dinars algériens et cinquante centimes",
    ],
    [DA(0, 1), "un centime"],
    [DA(0, 80), "quatre-vingts centimes"],
    [DA(5, 1), "cinq dinars algériens et un centime"],
  ])("%s → %s", (amount, expected) => {
    expect(amountInWordsFr(amount)).toBe(expected);
  });

  it("refuses negative amounts", () => {
    expect(() => amountInWordsFr(-1n)).toThrow(RangeError);
  });
});

describe("integerToWordsAr", () => {
  it.each([
    [0, "صفر"],
    [1, "واحد"],
    [2, "اثنان"],
    [11, "أحد عشر"],
    [12, "اثنا عشر"],
    [15, "خمسة عشر"],
    [21, "واحد وعشرون"],
    [100, "مائة"],
    [200, "مائتان"],
    [305, "ثلاثمائة وخمسة"],
    [2_000, "ألفان"],
    [3_000, "ثلاثة آلاف"],
    [11_000, "أحد عشر ألفاً"],
    [1_250_000, "مليون ومائتان وخمسون ألفاً"],
  ])("%i → %s", (n, expected) => {
    expect(integerToWordsAr(BigInt(n))).toBe(expected);
  });
});

describe("amountInWordsAr", () => {
  it.each([
    [DA(0), "صفر دينار جزائري"],
    [DA(1), "دينار جزائري واحد"],
    [DA(2), "ديناران جزائريان"],
    [DA(5), "خمسة دنانير جزائرية"],
    [DA(10), "عشرة دنانير جزائرية"],
    [DA(11), "أحد عشر ديناراً جزائرياً"],
    [DA(25), "خمسة وعشرون ديناراً جزائرياً"],
    [DA(100), "مائة دينار جزائري"],
    [DA(200), "مائتا دينار جزائري"],
    [DA(1_000), "ألف دينار جزائري"],
    [DA(2_000), "ألفا دينار جزائري"],
    [DA(2_500), "ألفان وخمسمائة دينار جزائري"],
    [DA(3_000), "ثلاثة آلاف دينار جزائري"],
    [DA(15_300), "خمسة عشر ألفاً وثلاثمائة دينار جزائري"],
    [DA(50_000), "خمسون ألف دينار جزائري"],
    [DA(200_500), "مائتا ألف وخمسمائة دينار جزائري"],
    [DA(1_000_000), "مليون دينار جزائري"],
    [DA(2_000_000), "مليونا دينار جزائري"],
    [DA(7_000_000), "سبعة ملايين دينار جزائري"],
    [DA(1_250_000, 50), "مليون ومائتان وخمسون ألف دينار جزائري وخمسون سنتيماً"],
    [DA(0, 1), "سنتيم واحد"],
    [DA(0, 5), "خمسة سنتيمات"],
    [DA(3, 2), "ثلاثة دنانير جزائرية وسنتيمان"],
  ])("%s → %s", (amount, expected) => {
    expect(amountInWordsAr(amount)).toBe(expected);
  });

  it("refuses negative amounts", () => {
    expect(() => amountInWordsAr(-1n)).toThrow(RangeError);
  });
});
