import "server-only";

import { formatDate } from "@/lib/dates";
import type { InspectionCondition, InspectionKind } from "@/lib/rentals";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on an état des lieux, already resolved. */
export type InspectionReportData = {
  kind: InspectionKind;
  inspectedOn: string;
  leaseNumber: string;
  projectName: string;
  projectAddress: string;
  buildingName: string;
  unitCode: string;
  tenantName: string;
  tenantNameAr: string | null;
  items: { element: string; condition: InspectionCondition; notes: string | null }[];
  /** At check-out, the condition each element had at check-in (same element name). */
  entry: Record<string, InspectionCondition> | null;
  electricityMeter: string | null;
  gasMeter: string | null;
  waterMeter: string | null;
  keysCount: number | null;
  observations: string | null;
};

export const conditionLabels: Record<InspectionCondition, { fr: string; ar: string }> = {
  good: { fr: "Bon état", ar: "حالة جيدة" },
  fair: { fr: "État moyen", ar: "حالة متوسطة" },
  poor: { fr: "Mauvais état", ar: "حالة سيئة" },
};

const CSS = `
@page{size:A4;margin:14mm}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:10pt}
.title h1{font-size:14pt;margin:0}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:7pt;margin-bottom:8pt}
.box h2{font-size:10pt;margin:0 0 4pt;display:flex;justify-content:space-between}
.kv{display:flex;justify-content:space-between;gap:8pt}
b{font-weight:600}
table{width:100%;border-collapse:collapse;margin:4pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:3.5pt 5pt;text-align:start;vertical-align:top}
th{font-size:8.5pt;color:#525252;font-weight:600}
.signatures{display:flex;justify-content:space-between;margin-top:26pt}
.signatures>div{width:45%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

const titles: Record<InspectionKind, { fr: string; ar: string }> = {
  check_in: { fr: "ÉTAT DES LIEUX D'ENTRÉE", ar: "محضر معاينة الدخول" },
  check_out: { fr: "ÉTAT DES LIEUX DE SORTIE", ar: "محضر معاينة الخروج" },
};

/** Bilingual état des lieux, rendered once when it is recorded. */
export function InspectionReportTemplate({
  data,
  company,
}: {
  data: InspectionReportData;
  company: CompanyIdentity;
}) {
  const title = titles[data.kind];
  const meters: [string, string, string | null][] = [
    ["Compteur d'électricité", "عداد الكهرباء", data.electricityMeter],
    ["Compteur de gaz", "عداد الغاز", data.gasMeter],
    ["Compteur d'eau", "عداد الماء", data.waterMeter],
  ];
  const label = (condition: InspectionCondition) => (
    <>
      {conditionLabels[condition].fr} · <span lang="ar">{conditionLabels[condition].ar}</span>
    </>
  );
  return (
    <PdfDocument title={`${title.fr} ${data.leaseNumber}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>{title.fr}</h1>
        <div style={{ textAlign: "center" }}>
          <b>{formatDate(data.inspectedOn)}</b>
          <div className="muted">
            Bail <bdi dir="ltr">{data.leaseNumber}</bdi>
          </div>
        </div>
        <h1 dir="rtl" lang="ar">
          {title.ar}
        </h1>
      </div>

      <div className="box">
        <h2>
          <span>Bien loué</span>
          <span dir="rtl" lang="ar">
            العقار المؤجر
          </span>
        </h2>
        <div>
          <b>{data.projectName}</b>
          {data.projectAddress ? <span className="muted"> · {data.projectAddress}</span> : null}
        </div>
        <div>
          {data.buildingName} · Lot <b dir="ltr">{data.unitCode}</b>
        </div>
      </div>

      <div className="box">
        <h2>
          <span>Locataire</span>
          <span dir="rtl" lang="ar">
            المستأجر
          </span>
        </h2>
        <b>{data.tenantName}</b>
        {data.tenantNameAr ? (
          <>
            {" · "}
            <bdi dir="rtl" lang="ar">
              {data.tenantNameAr}
            </bdi>
          </>
        ) : null}
      </div>

      <div className="box">
        <h2>
          <span>Constat</span>
          <span dir="rtl" lang="ar">
            المعاينة
          </span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>
                Élément · <span lang="ar">العنصر</span>
              </th>
              {data.entry ? (
                <th>
                  À l&apos;entrée · <span lang="ar">عند الدخول</span>
                </th>
              ) : null}
              <th>
                État · <span lang="ar">الحالة</span>
              </th>
              <th>
                Observations · <span lang="ar">ملاحظات</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, index) => {
              const before = data.entry?.[item.element];
              return (
                <tr key={index}>
                  <td>{item.element}</td>
                  {data.entry ? <td>{before ? label(before) : "—"}</td> : null}
                  <td>{label(item.condition)}</td>
                  <td dir="auto">{item.notes ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="box">
        <div className="kv">
          <span>
            Clés remises · <span lang="ar">المفاتيح</span>
          </span>
          <b>{data.keysCount ?? "—"}</b>
        </div>
        {meters.map(([fr, ar, value]) => (
          <div className="kv" key={fr}>
            <span>
              {fr} · <span lang="ar">{ar}</span>
            </span>
            <b dir="ltr">{value ?? "—"}</b>
          </div>
        ))}
      </div>

      {data.observations ? (
        <div className="box">
          <h2>
            <span>Observations</span>
            <span dir="rtl" lang="ar">
              ملاحظات
            </span>
          </h2>
          <p style={{ whiteSpace: "pre-line" }} dir="auto">
            {data.observations}
          </p>
        </div>
      ) : null}

      <div className="signatures">
        <div>
          Le bailleur · <span lang="ar">المؤجر</span>
        </div>
        <div>
          Le locataire · <span lang="ar">المستأجر</span>
          <div className="muted">
            Lu et approuvé · <span lang="ar">قُرئ وصودق عليه</span>
          </div>
        </div>
      </div>
    </PdfDocument>
  );
}
