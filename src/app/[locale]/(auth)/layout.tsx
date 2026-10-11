import { BrandLogo } from "@/components/brand/brand-mark";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="flex items-center justify-between gap-4 p-4">
        <BrandLogo />
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center p-4 pb-16 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
