import "server-only";

import type { AnnouncementCategory } from "@/lib/announcements";
import { formatDate } from "@/lib/dates";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on an announcement's notice, already resolved. */
export type AnnouncementNoticeData = {
  residenceName: string;
  residenceAddress: string;
  category: AnnouncementCategory;
  title: string;
  titleAr: string | null;
  body: string;
  bodyAr: string | null;
  publishedAt: Date;
  expiresOn: string | null;
};

export const announcementCategoryLabels: Record<AnnouncementCategory, { fr: string; ar: string }> =
  {
    general: { fr: "Information", ar: "إعلام" },
    works: { fr: "Travaux", ar: "أشغال" },
    outage: { fr: "Coupure", ar: "انقطاع" },
    meeting: { fr: "Réunion", ar: "اجتماع" },
    safety: { fr: "Sécurité", ar: "السلامة" },
  };

const CSS = `
@page{size:A4;margin:16mm}
.title{border-block:1.5pt solid #171717;padding:8pt 0;margin:4pt 0 14pt;text-align:center}
.title h1{font-size:20pt;margin:0;letter-spacing:0.5pt}
.title .muted{font-size:9.5pt;margin-top:3pt}
.category{display:inline-block;border:1pt solid #a3a3a3;border-radius:10pt;padding:1pt 9pt;font-size:9pt;margin-bottom:8pt}
h2{font-size:15pt;margin:0 0 8pt}
.body{font-size:12pt;line-height:1.55;white-space:pre-line;margin-bottom:14pt}
.ar h2,.ar .body{text-align:start}
hr{border:none;border-top:0.75pt solid #d4d4d4;margin:14pt 0}
.validity{font-size:10pt;margin-top:10pt}
.signatures{display:flex;justify-content:flex-end;margin-top:28pt}
.signatures div{width:40%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Bilingual notice to post in the building (« avis aux résidents »). */
export function AnnouncementNoticeTemplate({
  data,
  company,
}: {
  data: AnnouncementNoticeData;
  company: CompanyIdentity;
}) {
  const category = announcementCategoryLabels[data.category];
  return (
    <PdfDocument title={`Avis ${data.residenceName}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>AVIS AUX RÉSIDENTS</h1>
        <h1 dir="rtl" lang="ar">
          إعلان إلى السكان
        </h1>
        <div className="muted">
          {data.residenceName}
          {data.residenceAddress ? ` · ${data.residenceAddress}` : ""} · Le{" "}
          {formatDate(data.publishedAt)}
        </div>
      </div>

      <div className="category">
        {category.fr} · <span lang="ar">{category.ar}</span>
      </div>
      <h2>{data.title}</h2>
      <div className="body">{data.body}</div>

      {data.titleAr || data.bodyAr ? (
        <>
          <hr />
          <div className="ar" dir="rtl" lang="ar">
            {data.titleAr ? <h2>{data.titleAr}</h2> : null}
            {data.bodyAr ? <div className="body">{data.bodyAr}</div> : null}
          </div>
        </>
      ) : null}

      {data.expiresOn ? (
        <p className="validity">
          Valable jusqu&apos;au <b>{formatDate(data.expiresOn)}</b> ·{" "}
          <span lang="ar">
            صالح إلى غاية <b>{formatDate(data.expiresOn)}</b>
          </span>
        </p>
      ) : null}

      <div className="signatures">
        <div className="muted">Le gestionnaire · المسير</div>
      </div>
    </PdfDocument>
  );
}
