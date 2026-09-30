import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { getSession } from "@/server/auth/session";

/** Every back-office page requires a session and an active organization. */
export default async function AppLayout({ children, params }: LayoutProps<"/[locale]">) {
  const locale = toLocale((await params).locale);
  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in", locale });
  if (!session.session.activeOrganizationId) return redirect({ href: "/onboarding", locale });

  return <>{children}</>;
}
