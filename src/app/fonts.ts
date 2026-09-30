import localFont from "next/font/local";

/**
 * IBM Plex Sans Arabic covers Arabic and Latin, so both locales share one family.
 * The same files are embedded in PDFs (src/pdf).
 */
export const appFont = localFont({
  src: [
    { path: "../assets/fonts/IBMPlexSansArabic-Regular.ttf", weight: "400", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-Medium.ttf", weight: "500", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../assets/fonts/IBMPlexSansArabic-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
