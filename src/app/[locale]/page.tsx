import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";

/** Entry point: the back-office layout sends signed-out users to /sign-in. */
export default async function RootPage({ params }: PageProps<"/[locale]">) {
  redirect({ href: "/dashboard", locale: toLocale((await params).locale) });
}
