import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FONT_FILES = [
  { weight: 400, file: "IBMPlexSansArabic-Regular.ttf" },
  { weight: 600, file: "IBMPlexSansArabic-SemiBold.ttf" },
  { weight: 700, file: "IBMPlexSansArabic-Bold.ttf" },
] as const;

let fontFaces: string | null = null;

/** Same family as the UI (src/app/fonts.ts), embedded so documents render identically everywhere. */
function fontFaceCss(): string {
  fontFaces ??= FONT_FILES.map(({ weight, file }) => {
    const data = readFileSync(join(process.cwd(), "src", "assets", "fonts", file)).toString(
      "base64",
    );
    return `@font-face{font-family:"Plex";font-weight:${weight};src:url(data:font/ttf;base64,${data})}`;
  }).join("\n");
  return fontFaces;
}

const BASE_CSS = `
*{box-sizing:border-box}
body{font-family:"Plex",sans-serif;font-size:10pt;color:#171717;margin:0;line-height:1.4}
p{margin:0 0 5pt}
.muted{color:#525252;font-size:8.5pt}
[lang="ar"]{line-height:1.6}
`;

/**
 * Shell of every generated document. Put Arabic content in elements with
 * `dir="rtl" lang="ar"`, and wrap values that may mix scripts in <bdi>.
 */
export function PdfDocument({
  title,
  lang = "fr",
  css,
  children,
}: {
  title: string;
  lang?: "fr" | "ar";
  /** Document-specific CSS, including its `@page` rule. */
  css: string;
  children: React.ReactNode;
}) {
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: `${fontFaceCss()}\n${BASE_CSS}\n${css}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
