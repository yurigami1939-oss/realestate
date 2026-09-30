/**
 * Fails when source files use physical-direction Tailwind utilities.
 * Use logical ones instead (ms/me/ps/pe/start/end/text-start/rounded-s/border-e…), see CLAUDE.md §8.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");

const PHYSICAL =
  /(?<![\w:-])-?(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|left|right|border-[lr]|rounded-(?:[lr]|tl|tr|bl|br))-[\w.[\]/%-]+|(?<![\w:-])(?:text-left|text-right|float-left|float-right|clear-left|clear-right)(?![\w-])/g;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts")) yield path;
  }
}

const problems: string[] = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("rtl-lint-ignore")) return;
    for (const match of line.matchAll(PHYSICAL)) {
      problems.push(`${relative(process.cwd(), file)}:${i + 1}  ${match[0]}`);
    }
  });
}

if (problems.length > 0) {
  console.error("Physical-direction Tailwind classes found (use logical utilities):");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
