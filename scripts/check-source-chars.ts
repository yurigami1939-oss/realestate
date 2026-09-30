/**
 * Fails on invisible or bidirectional-control characters in source code (no-break spaces,
 * direction marks, zero-width chars…): write them as \u escapes. Guards against unreadable literals and "Trojan Source"
 * bidi tricks. Message catalogs are exempt: they hold real Arabic text.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "scripts", "tests", "e2e"].map((d) => join(import.meta.dirname, "..", d));

const FORBIDDEN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u00a0\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\u202f\ufeff\u0300-\u036f]/g;

function* walk(dir: string): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|mjs|sql|css)$/.test(name)) yield path;
  }
}

const problems: string[] = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const match of line.matchAll(FORBIDDEN)) {
          const code = match[0].codePointAt(0)?.toString(16).padStart(4, "0");
          problems.push(`${relative(process.cwd(), file)}:${i + 1}  U+${code}`);
        }
      });
  }
}

if (problems.length > 0) {
  console.error("Invisible or bidi-control characters found (use \\u escapes):");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
