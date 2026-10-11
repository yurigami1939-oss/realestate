import "server-only";

import type { DocumentTextKind } from "@/lib/document-texts";
import type { CompanyIdentity } from "@/server/organizations/settings";

/**
 * The organization's own wording on a kind of document (« mentions de la société »), French
 * then Arabic, as set on its documents settings page; nothing when it set none.
 */
export function CompanyNote({
  company,
  kind,
}: {
  company: CompanyIdentity;
  kind: DocumentTextKind;
}) {
  const text = company.documentTexts?.[kind];
  if (!text || (text.fr.trim() === "" && text.ar.trim() === "")) return null;
  return (
    <div
      className="company-note"
      style={{
        border: "0.75pt solid #d4d4d4",
        borderRadius: "4pt",
        padding: "6pt 8pt",
        margin: "10pt 0",
        fontSize: "8.5pt",
        whiteSpace: "pre-line",
      }}
      data-company-note={kind}
    >
      {text.fr.trim() ? <p style={{ margin: 0 }}>{text.fr}</p> : null}
      {text.ar.trim() ? (
        <p dir="rtl" lang="ar" style={{ margin: text.fr.trim() ? "4pt 0 0" : 0 }}>
          {text.ar}
        </p>
      ) : null}
    </div>
  );
}
