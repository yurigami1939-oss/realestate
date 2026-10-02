"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import type { UserOrganization } from "@/server/organizations/queries";

export function OrganizationPicker({ organizations }: { organizations: UserOrganization[] }) {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function open(organizationId: string) {
    startTransition(async () => {
      await authClient.organization.setActive({ organizationId });
      router.replace("/dashboard");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("existing")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {organizations.map((org) => (
            <li key={org.id} className="flex items-center justify-between gap-3 py-2">
              <span className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" aria-hidden />
                {org.name}
              </span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => open(org.id)}>
                {t("open")}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
