import localFont from "next/font/local";

/**
 * IBM Plex Sans Arabic for Arabic script only (its faces are limited to the Arabic ranges);
 * Latin text falls through to the system font of `--font-sans` (globals.css): SF Pro on Apple
 * devices, Segoe UI on Windows. PDFs embed the full family (src/pdf).
 */
export const appFont = localFont({
  src: [
    { path: "../assets/fonts/IBMPlexSansArabic-Regular.ttf", weight: "400", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-Medium.ttf", weight: "500", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-arabic",
  display: "swap",
  // No metric fallback face: it would cover Latin text before the system font.
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F",
    },
  ],
});
