/**
 * Fails when source files use physical-direction Tailwind utilities — use logical ones instead
 * (ms/me/ps/pe/start/end/text-start/rounded-s/border-e…) — or Tailwind's raw color palette
 * (`text-red-700`, `bg-amber-50`…) — use the tones of globals.css (`text-danger`,
 * `bg-warning-soft`…). See CLAUDE.md §8.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");

const RAW_PALETTE =
  /(?<![\w-])(?:bg|text|border|ring|divide|outline|decoration|fill|stroke|from|via|to|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?![\w-])/g;

const PHYSICAL =
  /(?<![\w:-])-?(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|left|right|border-[lr]|rounded-(?:[lr]|tl|tr|bl|br))-[\w.[\]/%-]+|(?<![\w:-])(?:text-left|text-right|float-left|float-right|clear-left|clear-right)(?![\w-])/g;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts")) yield path;
  }
}

/** Class names only live in string literals; comments and identifiers are ignored. */
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const problems: string[] = [];
const colors: string[] = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("rtl-lint-ignore")) return;
    for (const literal of line.matchAll(STRING_LITERAL)) {
      for (const match of (literal[2] ?? "").matchAll(PHYSICAL)) {
        problems.push(`${relative(process.cwd(), file)}:${i + 1}  ${match[0]}`);
      }
      for (const match of (literal[2] ?? "").matchAll(RAW_PALETTE)) {
        colors.push(`${relative(process.cwd(), file)}:${i + 1}  ${match[0]}`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error("Physical-direction Tailwind classes found (use logical utilities):");
  for (const p of problems) console.error(`  ${p}`);
}
if (colors.length > 0) {
  console.error("Raw palette colors found (use the tones: success, warning, danger, info…):");
  for (const c of colors) console.error(`  ${c}`);
}
if (problems.length > 0 || colors.length > 0) process.exit(1);
