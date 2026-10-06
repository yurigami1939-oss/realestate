import "server-only";

import { formatDate } from "@/lib/dates";
import type { Orientation, Typology, UnitStatus, UnitType } from "@/lib/inventory";
import { type Centimes, formatDZD } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** Everything printed on a unit sheet, already resolved (no lookups in templates). */
export type UnitSheetData = {
  issuedOn: string;
  projectName: string;
  projectAddress: string | null;
  plannedDeliveryOn: string | null;
  buildingName: string;
  code: string;
  type: UnitType;
  typology: Typology | null;
  floor: number;
  isDuplex: boolean;
  livingArea: string | null;
  usableArea: string | null;
  outdoorArea: string | null;
  orientations: Orientation[];
  status: UnitStatus;
  listPrice: Centimes | null;
  planName: string | null;
  lines: {
    label: string;
    shareBp: number;
    amount: Centimes;
    trigger: string;
    months: number | null;
    milestoneName: string | null;
  }[];
  /** Floor plan image as a data URI (none for a PDF plan). */
  plan: string | null;
};

const CSS = `
@page{size:A4;margin:14mm}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:10pt}
.title h1{font-size:15pt;margin:0}
.grid{display:flex;gap:12pt}
.grid > div{flex:1}
table{width:100%;border-collapse:collapse;margin:4pt 0 8pt}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:3.5pt 6pt;text-align:start}
th{font-size:8.5pt;color:#525252;font-weight:600;width:42%}
td.num,th.num{text-align:end;white-space:nowrap}
.price{font-size:16pt;font-weight:700}
.plan{max-width:100%;max-height:300pt;display:block;margin:6pt auto;border:0.75pt solid #d4d4d4}
h2{font-size:11pt;margin:10pt 0 4pt}
.note{font-size:8pt;color:#525252}
`;

const typeLabel: Record<UnitType, [string, string]> = {
  apartment: ["Appartement", "شقة"],
  commercial: ["Local commercial", "محل تجاري"],
  office: ["Bureau", "مكتب"],
  parking: ["Place de parking", "موقف سيارة"],
  storage: ["Cave", "مخزن"],
  villa: ["Villa", "فيلا"],
};
const statusLabel: Record<UnitStatus, [string, string]> = {
  available: ["Disponible", "متاحة"],
  optioned: ["En option", "قيد الخيار"],
  reserved: ["Réservé", "محجوزة"],
  sold: ["Vendu", "مباعة"],
  delivered: ["Livré", "مسلَّمة"],
  rented: ["Loué", "مؤجرة"],
  blocked: ["Non commercialisé", "غير معروضة"],
};

function due(line: UnitSheetData["lines"][number]) {
  if (line.trigger === "signing") return "À la signature · عند التوقيع";
  if (line.trigger === "months_after_signing") {
    return `${line.months ?? 0} mois après la signature · ${line.months ?? 0} شهر بعد التوقيع`;
  }
  return `${line.milestoneName ?? "—"} · عند إنجاز المرحلة`;
}

const area = (v: string | null) => (v === null ? "—" : `${v.replace(".", ",")} m²`);

/** Bilingual fiche du lot handed to a prospect (CLAUDE.md §7 Inventory). */
export function UnitSheetTemplate({
  data,
  company,
}: {
  data: UnitSheetData;
  company: CompanyIdentity;
}) {
  const money = (v: Centimes) => formatDZD(v, "fr");
  const surface = data.livingArea ?? data.usableArea;
  const perSqm =
    data.listPrice !== null && surface !== null && Number(surface) > 0
      ? (data.listPrice * 100n) / BigInt(Math.round(Number(surface) * 100))
      : null;
  const [typeFr, typeAr] = typeLabel[data.type];
  const [statusFr, statusAr] = statusLabel[data.status];
  return (
    <PdfDocument title={`Fiche ${data.code}`} css={CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>
          FICHE DU LOT <bdi dir="ltr">{data.code}</bdi>
        </h1>
        <div className="muted">Le {formatDate(data.issuedOn)}</div>
        <h1 dir="rtl" lang="ar">
          بطاقة الوحدة <bdi dir="ltr">{data.code}</bdi>
        </h1>
      </div>

      <div className="grid">
        <div>
          <table>
            <tbody>
              <tr>
                <th>Projet · المشروع</th>
                <td>
                  <bdi>{data.projectName}</bdi>
                  {data.projectAddress ? (
                    <div className="note">
                      <bdi>{data.projectAddress}</bdi>
                    </div>
                  ) : null}
                </td>
              </tr>
              <tr>
                <th>Bâtiment · العمارة</th>
                <td>
                  <bdi>{data.buildingName}</bdi>
                </td>
              </tr>
              <tr>
                <th>Type · النوع</th>
                <td>
                  {typeFr}
                  {data.typology ? ` ${data.typology}` : ""}
                  {data.isDuplex ? " duplex" : ""} · <span lang="ar">{typeAr}</span>
                </td>
              </tr>
              <tr>
                <th>Étage · الطابق</th>
                <td>{data.floor === 0 ? "RDC · الطابق الأرضي" : data.floor}</td>
              </tr>
              <tr>
                <th>Surface habitable · المساحة السكنية</th>
                <td dir="ltr">{area(data.livingArea)}</td>
              </tr>
              <tr>
                <th>Surface utile · المساحة النافعة</th>
                <td dir="ltr">{area(data.usableArea)}</td>
              </tr>
              {data.outdoorArea ? (
                <tr>
                  <th>Terrasse, balcon · الشرفة</th>
                  <td dir="ltr">{area(data.outdoorArea)}</td>
                </tr>
              ) : null}
              {data.orientations.length > 0 ? (
                <tr>
                  <th>Orientation · الاتجاه</th>
                  <td dir="ltr">{data.orientations.join(" · ")}</td>
                </tr>
              ) : null}
              {data.plannedDeliveryOn ? (
                <tr>
                  <th>Livraison prévue · التسليم المرتقب</th>
                  <td>{formatDate(data.plannedDeliveryOn)}</td>
                </tr>
              ) : null}
              <tr>
                <th>Disponibilité · التوفر</th>
                <td>
                  {statusFr} · <span lang="ar">{statusAr}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <p>Prix · السعر</p>
          <p className="price" dir="ltr">
            {data.listPrice === null ? "—" : money(data.listPrice)}
          </p>
          {perSqm !== null ? (
            <p className="note" dir="ltr">
              {money(perSqm)} / m²
            </p>
          ) : null}
          {data.plan ? (
            // Static HTML printed by Chromium (no Next.js image pipeline).
            // eslint-disable-next-line @next/next/no-img-element
            <img className="plan" src={data.plan} alt={data.code} />
          ) : null}
        </div>
      </div>

      {data.lines.length > 0 && data.listPrice !== null ? (
        <>
          <h2>
            Échéancier proposé · جدول الدفع المقترح
            {data.planName ? (
              <>
                {" — "}
                <bdi>{data.planName}</bdi>
              </>
            ) : null}
          </h2>
          <table>
            <thead>
              <tr>
                <th>Échéance · الدفعة</th>
                <th>Exigible · الاستحقاق</th>
                <th className="num">Part · النسبة</th>
                <th className="num">Montant · المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={`${index}-${line.label}`}>
                  <td>
                    <bdi>{line.label}</bdi>
                  </td>
                  <td>
                    <bdi>{due(line)}</bdi>
                  </td>
                  <td className="num" dir="ltr">
                    {formatShare(line.shareBp)}
                  </td>
                  <td className="num" dir="ltr">
                    {money(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <p className="note">
        Document d&apos;information, sans valeur contractuelle : prix et disponibilité au{" "}
        {formatDate(data.issuedOn)}, sous réserve de vente entre-temps.
      </p>
      <p className="note" dir="rtl" lang="ar">
        وثيقة إعلامية دون قيمة تعاقدية: السعر والتوفر بتاريخ {formatDate(data.issuedOn)}، مع مراعاة
        البيع في الأثناء.
      </p>
    </PdfDocument>
  );
}
