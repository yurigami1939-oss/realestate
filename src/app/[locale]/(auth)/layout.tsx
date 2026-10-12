import { BrandMark } from "@/components/brand/brand-mark";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { BRAND_NAME } from "@/lib/brand";

/**
 * Account pages (sign-in, sign-up, two-factor, password reset, invitation, onboarding), like an
 * Apple ID page (CLAUDE.md §14 item 13): the mark above one centred card, a large title, 44 px
 * fields and button, links in the accent. The pages keep their own Card markup; the look is
 * set here once.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-end p-4">
        <LocaleSwitcher />
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-2 pb-16 sm:justify-center sm:pt-0">
        <div
          className={[
            "w-full max-w-[26rem] space-y-6",
            // the card
            "[&_[data-slot=card]]:rounded-2xl [&_[data-slot=card]]:[--card-spacing:--spacing(7)]",
            "[&_[data-slot=card-header]]:justify-items-center [&_[data-slot=card-header]]:text-center",
            "[&_[data-slot=card-title]]:text-[1.625rem] [&_[data-slot=card-title]]:leading-tight [&_[data-slot=card-title]]:font-semibold",
            "[&_[data-slot=card-description]]:text-sm",
            // fields and the main button
            "[&_[data-slot=input]]:h-11 [&_[data-slot=input]]:rounded-xl [&_[data-slot=input]]:text-[0.9375rem]",
            "[&_[data-slot=select-trigger]]:rounded-xl [&_[data-slot=select-trigger][data-size=default]]:h-11",
            "[&_button[type=submit]]:h-11 [&_button[type=submit]]:w-full [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:text-[0.9375rem]",
            // the footer: centred links in the accent, no gray band
            "[&_[data-slot=card-footer]]:items-center [&_[data-slot=card-footer]]:border-t-0 [&_[data-slot=card-footer]]:bg-transparent [&_[data-slot=card-footer]]:pt-0 [&_[data-slot=card-footer]]:text-center",
            "[&_[data-slot=card-footer]_a]:font-medium [&_[data-slot=card-footer]_a]:text-primary",
          ].join(" ")}
        >
          <div className="flex flex-col items-center gap-3">
            <BrandMark className="size-14 drop-shadow-sm" />
            <span className="text-sm font-semibold tracking-tight text-muted-foreground">
              {BRAND_NAME}
            </span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
