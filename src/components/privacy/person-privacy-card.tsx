import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { PersonPrivacy } from "@/server/privacy/consents";

/**
 * A person's consents (given or withdrawn, how and by whom) and who opened their file (Loi
 * 18-07, CLAUDE.md §7 Personal data), for the managers who answer access requests.
 */
export function PersonPrivacyCard({ privacy }: { privacy: PersonPrivacy }) {
  const t = useTranslations("privacy.person");
  return (
    <Card data-testid="person-privacy">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <h3 className="font-medium">{t("consents")}</h3>
          {privacy.consents.length === 0 ? (
            <p className="text-muted-foreground">{t("noConsent")}</p>
          ) : (
            <ul className="space-y-1" data-testid="person-consents">
              {privacy.consents.map((c) => (
                <li key={c.id}>
                  {t(c.granted ? "given" : "withdrawn", { purpose: t(`purpose.${c.purpose}`) })}
                  <span className="block text-xs text-muted-foreground">
                    {[formatDateTime(c.createdAt), t(`source.${c.source}`), c.actorName, c.detail]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1">
          <h3 className="font-medium">{t("accesses")}</h3>
          {privacy.accesses.length === 0 ? (
            <p className="text-muted-foreground">{t("noAccess")}</p>
          ) : (
            <ul className="space-y-1" data-testid="person-accesses">
              {privacy.accesses.map((a) => (
                <li key={a.id}>
                  {a.userName}
                  <span className="text-muted-foreground">
                    {" · "}
                    {formatDate(a.day)} · {t("times", { count: a.count })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
