import "./globals.css";

/** Requests outside any locale segment (rare: the proxy adds a locale prefix). */
export default function GlobalNotFound() {
  return (
    <html lang="fr" dir="ltr">
      <body className="grid min-h-dvh place-items-center p-8 text-center">
        <p>Page introuvable · الصفحة غير موجودة</p>
      </body>
    </html>
  );
}
