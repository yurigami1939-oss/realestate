import "server-only";

import { formatDate } from "@/lib/dates";
import type { PrintedReserve, PunchTrade } from "@/lib/handovers";
import { formatDZD } from "@/lib/money";
import type { CompanyIdentity } from "@/server/organizations/settings";

import { PdfDocument } from "../document";

import { Letterhead } from "./letterhead";

/** The handed-over unit and its buyers, shared by both delivery documents. */
export type DeliveredUnit = {
  projectName: string;
  projectAddress: string;
  buildingName: string;
  unitCode: string;
  unitTypology: string | null;
  area: string | null;
  saleNumber: string | null;
  saleSignedOn: string | null;
  saleNotary: string | null;
  buyers: {
    lastName: string;
    firstName: string;
    lastNameAr: string | null;
    firstNameAr: string | null;
    nin: string | null;
  }[];
};

/** Everything printed on a PV de remise des clés, already resolved. */
export type HandoverPvData = DeliveredUnit & {
  number: string;
  signedOn: string;
  receivedBy: string;
  keysCount: number;
  electricityMeter: string | null;
  gasMeter: string | null;
  waterMeter: string | null;
  observations: string | null;
  outstanding: bigint;
  reserves: PrintedReserve[];
  signedByName: string | null;
};

export const punchTradeLabels: Record<PunchTrade, { fr: string; ar: string }> = {
  masonry: { fr: "Maçonnerie", ar: "البناء" },
  plumbing: { fr: "Plomberie", ar: "الترصيص الصحي" },
  electrical: { fr: "Électricité", ar: "الكهرباء" },
  joinery: { fr: "Menuiserie", ar: "النجارة" },
  painting: { fr: "Peinture", ar: "الطلاء" },
  tiling: { fr: "Carrelage", ar: "التبليط" },
  waterproofing: { fr: "Étanchéité", ar: "العزل المائي" },
  other: { fr: "Autre", ar: "أخرى" },
};

export const DELIVERY_CSS = `
@page{size:A4;margin:14mm}
.title{display:flex;justify-content:space-between;align-items:center;border-block:1pt solid #171717;padding:6pt 0;margin-bottom:10pt}
.title h1{font-size:14pt;margin:0}
.box{border:1pt solid #d4d4d4;border-radius:4pt;padding:7pt;margin-bottom:8pt}
.box h2{font-size:10pt;margin:0 0 4pt;display:flex;justify-content:space-between}
.kv{display:flex;justify-content:space-between;gap:8pt}
.buyers{display:grid;grid-template-columns:1fr 1fr;gap:8pt}
b{font-weight:600}
p{margin:0 0 6pt}
table{width:100%;border-collapse:collapse;margin:4pt 0}
th,td{border-bottom:0.75pt solid #d4d4d4;padding:3.5pt 5pt;text-align:start;vertical-align:top}
th{font-size:8.5pt;color:#525252;font-weight:600}
td.num{white-space:nowrap}
.warning{border-color:#d97706;background:#fffbeb}
.signatures{display:flex;justify-content:space-between;margin-top:26pt}
.signatures>div{width:45%;border-top:1pt solid #a3a3a3;padding-top:4pt}
`;

/** Unit and buyers boxes, shared by the PV de remise and the PV de levée des réserves. */
export function DeliveredUnitBoxes({ data }: { data: DeliveredUnit }) {
  return (
    <>
      <div className="box">
        <h2>
          <span>Bien</span>
          <span dir="rtl" lang="ar">
            العقار
          </span>
        </h2>
        <div>
          <b>{data.projectName}</b>
          {data.projectAddress ? <span className="muted"> · {data.projectAddress}</span> : null}
        </div>
        <div>
          {data.buildingName} · Lot <b dir="ltr">{data.unitCode}</b>
          {data.unitTypology ? ` · ${data.unitTypology}` : ""}
          {data.area ? ` · ${data.area.replace(".", ",")} m²` : ""}
        </div>
        {data.saleNumber && data.saleSignedOn ? (
          <div className="muted">
            Vente sur plans <bdi dir="ltr">{data.saleNumber}</bdi> du{" "}
            {formatDate(data.saleSignedOn)}
            {data.saleNotary ? ` (${data.saleNotary})` : ""} ·{" "}
            <span lang="ar">البيع على التصاميم</span>
          </div>
        ) : null}
      </div>

      <div className="box">
        <h2>
          <span>{data.buyers.length > 1 ? "Acquéreurs" : "Acquéreur"}</span>
          <span dir="rtl" lang="ar">
            {data.buyers.length > 1 ? "المقتنون" : "المقتني"}
          </span>
        </h2>
        <div className="buyers">
          {data.buyers.map((b, index) => (
            <div key={index}>
              <b>
                {b.lastName} {b.firstName}
              </b>
              {b.lastNameAr || b.firstNameAr ? (
                <>
                  {" · "}
                  <bdi dir="rtl" lang="ar">
                    {[b.lastNameAr, b.firstNameAr].filter(Boolean).join(" ")}
                  </bdi>
                </>
              ) : null}
              {b.nin ? <div className="muted">NIN {b.nin}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Bilingual PV de remise des clés, rendered once at signing. */
export function HandoverPvTemplate({
  data,
  company,
}: {
  data: HandoverPvData;
  company: CompanyIdentity;
}) {
  const companyName = company.legalName ?? company.name;
  const meters: [string, string, string | null][] = [
    ["Compteur d'électricité", "عداد الكهرباء", data.electricityMeter],
    ["Compteur de gaz", "عداد الغاز", data.gasMeter],
    ["Compteur d'eau", "عداد الماء", data.waterMeter],
  ];
  return (
    <PdfDocument title={data.number} css={DELIVERY_CSS}>
      <Letterhead company={company} />

      <div className="title">
        <h1>PROCÈS-VERBAL DE REMISE DES CLÉS</h1>
        <div style={{ textAlign: "center" }}>
          <b dir="ltr">N° {data.number}</b>
          <div className="muted">du {formatDate(data.signedOn)}</div>
        </div>
        <h1 dir="rtl" lang="ar">
          محضر تسليم المفاتيح
        </h1>
      </div>

      <DeliveredUnitBoxes data={data} />

      <p>
        Ce jour, {companyName} a remis à l&apos;acquéreur, qui le reconnaît, les clés du bien
        désigné ci-dessus. Elles ont été reçues par <b>{data.receivedBy}</b>.
      </p>
      <p dir="rtl" lang="ar">
        في هذا اليوم، سلّمت <bdi>{companyName}</bdi> إلى المقتني، الذي يُقرّ بذلك، مفاتيح العقار
        المعيّن أعلاه، وقد استلمها <bdi>{data.receivedBy}</bdi>.
      </p>

      <div className="box">
        <h2>
          <span>Remise</span>
          <span dir="rtl" lang="ar">
            التسليم
          </span>
        </h2>
        <div className="kv">
          <span>
            Nombre de clés · <span lang="ar">عدد المفاتيح</span>
          </span>
          <b>{data.keysCount}</b>
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

      <div className="box">
        <h2>
          <span>Réserves</span>
          <span dir="rtl" lang="ar">
            التحفظات
          </span>
        </h2>
        {data.reserves.length === 0 ? (
          <p>
            Bien remis sans réserve. · <span lang="ar">تم تسليم العقار دون تحفظ.</span>
          </p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>N°</th>
                  <th>
                    Localisation · <span lang="ar">المكان</span>
                  </th>
                  <th>
                    Description · <span lang="ar">الوصف</span>
                  </th>
                  <th>
                    Corps d&apos;état · <span lang="ar">الاختصاص</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.reserves.map((r) => (
                  <tr key={r.position}>
                    <td className="num">{r.position}</td>
                    <td>{r.location}</td>
                    <td>{r.description}</td>
                    <td>
                      {punchTradeLabels[r.trade].fr} ·{" "}
                      <span lang="ar">{punchTradeLabels[r.trade].ar}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Le promoteur s&apos;engage à lever ces réserves ; leur levée sera constatée par un
              procès-verbal de levée des réserves.
            </p>
            <p dir="rtl" lang="ar">
              يلتزم المرقّي برفع هذه التحفظات، ويُثبَت رفعها بمحضر رفع التحفظات.
            </p>
          </>
        )}
      </div>

      {data.outstanding > 0n ? (
        <div className="box warning">
          <div className="kv">
            <span>
              Reste à payer sur le prix à la date de remise ·{" "}
              <span lang="ar">المتبقي من الثمن في تاريخ التسليم</span>
            </span>
            <b dir="ltr">{formatDZD(data.outstanding, "fr")}</b>
          </div>
        </div>
      ) : null}

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
          Pour le promoteur · <span lang="ar">عن المرقّي</span>
          {data.signedByName ? <div className="muted">{data.signedByName}</div> : null}
        </div>
        <div>
          L&apos;acquéreur · <span lang="ar">المقتني</span>
          <div className="muted">
            Lu et approuvé · <span lang="ar">قُرئ وصودق عليه</span>
          </div>
        </div>
      </div>
    </PdfDocument>
  );
}
