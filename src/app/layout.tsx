/**
 * The real root layout (with <html>) is src/app/[locale]/layout.tsx.
 * This pass-through exists because src/app/not-found.tsx needs a layout.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
