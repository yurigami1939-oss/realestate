import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { formatDateTime } from "@/lib/dates";
import type { DocumentSignature } from "@/server/signatures/queries";

/** Who signed a document electronically, when, and the fingerprint of what they signed. */
export function SignatureList({ signatures }: { signatures: DocumentSignature[] | undefined }) {
  const t = useTranslations("signatures");
  if (!signatures || signatures.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs" data-testid="e-signatures">
      {signatures.map((s) => (
        <li key={`${s.signerName}-${s.signedAt.toISOString()}`} className="text-emerald-800">
          <BadgeCheck className="inline size-3.5 align-text-bottom" aria-hidden />{" "}
          {t("signedBy", { name: s.signerName, date: formatDateTime(s.signedAt) })}
          <span className="block text-muted-foreground" dir="ltr">
            {t("fingerprint", { hash: s.documentSha256.slice(0, 16) })}
            {s.ipAddress ? ` · ${s.ipAddress}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
