import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { getSession } from "@/server/auth/session";
import { getPendingInvitation } from "@/server/organizations/queries";

import { InvitationActions } from "./invitation-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invitation");
  return { title: t("title") };
}

export default async function AcceptInvitationPage({
  params,
}: PageProps<"/[locale]/accept-invitation/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(toLocale(locale));
  const t = await getTranslations();

  const [invitation, session] = await Promise.all([getPendingInvitation(id), getSession()]);

  if (!invitation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t("invitation.title")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FormAlert message={t("invitation.invalid")} />
        </CardContent>
      </Card>
    );
  }

  const next = `/accept-invitation/${invitation.id}`;
  const roles = invitation.roles.map((role) => t(`roles.${role}`)).join(", ");
  const isRecipient = session?.user.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("invitation.title")}</h1>
        </CardTitle>
        <CardDescription>
          {t("invitation.description", {
            inviter: invitation.inviterName,
            organization: invitation.organizationName,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{t("invitation.roles", { roles })}</p>
        {session && !isRecipient ? (
          <FormAlert message={t("invitation.wrongAccount", { email: invitation.email })} />
        ) : null}
        {!session ? (
          <p className="text-sm text-muted-foreground">
            {t("invitation.signInToAccept", { email: invitation.email })}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {session && isRecipient ? <InvitationActions invitationId={invitation.id} /> : null}
        {!session ? (
          <>
            <Button asChild>
              <Link href={`/sign-in?next=${encodeURIComponent(next)}`}>
                {t("auth.signIn.submit")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/sign-up?next=${encodeURIComponent(next)}`}>
                {t("auth.signIn.signUpLink")}
              </Link>
            </Button>
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
}
