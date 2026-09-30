import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRODUCT_NAME",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" dir="ltr">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
