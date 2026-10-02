import { describe, expect, it } from "vitest";

import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/**
 * ICU argument names used by a message: {name}, {count, plural, …} → name, count. Branch bodies
 * (`other {Décembre}`, `=0 {Aucun}`, `1 {Janvier}`) are not arguments. A set: Arabic has more
 * plural branches than French, each of which may repeat an argument.
 */
function argumentsOf(message: string): string[] {
  const argument =
    /(?<!(?:\b(?:zero|one|two|few|many|other)|=\d+|\b\d+)\s*)\{\s*([a-zA-Z_]\w*)\s*[,}]/g;
  const names = [...message.matchAll(argument)].map((m) => m[1] ?? "");
  return [...new Set(names)].sort();
}

describe("message catalogs", () => {
  const frMessages = flatten(fr);
  const arMessages = flatten(ar);

  it("have exactly the same keys in French and Arabic", () => {
    expect([...arMessages.keys()].sort()).toEqual([...frMessages.keys()].sort());
  });

  it("use the same ICU arguments in both languages", () => {
    for (const [key, message] of frMessages) {
      expect(argumentsOf(arMessages.get(key) ?? ""), key).toEqual(argumentsOf(message));
    }
  });

  it("have no empty translations", () => {
    for (const [key, message] of [...frMessages, ...arMessages]) {
      expect(message.trim(), key).not.toBe("");
    }
  });
});
